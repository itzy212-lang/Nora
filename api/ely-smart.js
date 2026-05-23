// api/ely-smart.js
// Ely/Nora smart route — loads the unified Supabase brain via get_ely_brain_v2
// and preserves the existing frontend response shape.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function cleanOutput(text = '') {
  return String(text || '')
    .replace(/—/g, ' - ')
    .replace(/–/g, '-')
    .replace(/--/g, '-')
    .replace(/pre-existing/gi, 'preexisting')
    .replace(/co-ordinate/gi, 'coordinate')
    .replace(/e-mail/gi, 'email');
}

function inferProjectId(body = {}) {
  return (
    body.project_id ||
    body.projectId ||
    body.currentProject?.id ||
    body.emailContext?.project_id ||
    body.emailContext?.projectId ||
    null
  );
}

function inferUserId(body = {}) {
  return (
    body.user_id ||
    body.userId ||
    body.currentUser?.id ||
    body.currentUser?.email ||
    body.emailContext?.user_id ||
    'itzy212@gmail.com'
  );
}

function inferModeHint(surface, prompt = '') {
  const p = String(prompt || '').toLowerCase();

  if (
    p.includes("don't do anything") ||
    p.includes('do not do anything') ||
    p.includes('just having a conversation') ||
    p.includes('hold off')
  ) return 'discuss';

  if (
    p.includes('draft') ||
    p.includes('write') ||
    p.includes('reply') ||
    p.includes('wording') ||
    p.includes('clause')
  ) return 'draft';

  if (
    p.includes('review') ||
    p.includes('compare') ||
    p.includes('missing') ||
    p.includes('does it include') ||
    p.includes('does it say')
  ) return 'review';

  if (
    p.includes('fix') ||
    p.includes('upload') ||
    p.includes('commit') ||
    p.includes('replace') ||
    p.includes('deploy')
  ) return 'execute';

  if (surface === 'award_review') return 'review';
  if (surface === 'email_composer' || surface === 'inbox_draft' || surface === 'email_reply') return 'draft';
  if (surface === 'soc' || surface === 'document') return 'draft';

  return 'discuss';
}

async function loadBrain({ userId, projectId, surface, modeHint }) {
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb.rpc('get_ely_brain_v2', {
    p_user_id: userId || null,
    p_project_id: projectId || null,
    p_surface: surface || null,
    p_mode: modeHint || null,
  });

  if (error) {
    console.warn('[ely-smart] get_ely_brain_v2 failed:', error.message);
    return null;
  }

  return data || null;
}

function compactJson(value, fallback = '') {
  try {
    if (!value) return fallback;
    return JSON.stringify(value, null, 2).slice(0, 12000);
  } catch {
    return fallback;
  }
}

function buildSystemPrompt({ brain, body, surface, modeHint, projectId }) {
  const instruction = brain?.instruction_set || {};
  const memories = Array.isArray(brain?.standing_memory) ? brain.standing_memory : [];
  const projectFromBrain = brain?.project && Object.keys(brain.project || {}).length ? brain.project : null;
  const workingContext = Array.isArray(brain?.working_context) ? brain.working_context : [];

  const memoryText = memories
    .slice(0, 30)
    .map(m => `- ${m.title || m.key || m.type}: ${m.content || ''}`)
    .join('\n');

  let prompt = '';

  if (instruction.system_prompt) prompt += instruction.system_prompt;
  if (instruction.behaviour_rules) prompt += `\n\nBEHAVIOUR RULES:\n${instruction.behaviour_rules}`;
  if (instruction.output_rules) prompt += `\n\nOUTPUT RULES:\n${instruction.output_rules}`;

  prompt += `\n\nLIVE REQUEST CONTEXT:
Surface: ${surface || 'main_chat'}
Mode hint: ${modeHint || 'discuss'}
Project ID: ${projectId || 'none'}`;

  if (memoryText) {
    prompt += `\n\nSTANDING MEMORY AND USER PREFERENCES:\n${memoryText}`;
  }

  const project = body.currentProject || projectFromBrain;

  if (project) {
    prompt += `\n\nCURRENT PROJECT CONTEXT:\n${compactJson(project)}`;
  }

  if (body.projectsContext?.length) {
    prompt += `\n\nOTHER ACTIVE PROJECT CONTEXT:\n${compactJson(body.projectsContext.slice(0, 8))}`;
  }

  if (workingContext.length) {
    prompt += `\n\nRECENT WORKING CONTEXT:\n${compactJson(workingContext.slice(0, 5))}`;
  }

  if (body.emailContext) {
    const e = body.emailContext;

    prompt += `\n\nEMAIL CONTEXT SUMMARY:
From: ${e.from || e.sender_email || e.sender_name || 'unknown'}
Subject: ${e.subject || 'unknown'}
Thread/message id: ${e.thread_id || e.external_id || e.id || 'unknown'}`;
  }

  prompt += `\n\nIMPORTANT ROUTING INSTRUCTIONS:
- Use the master brain and standing memory as the authority.
- If the user is asking about a live document, answer about that document rather than giving generic examples.
- In award review, be collaborative: state what is missing or weak and provide copy-ready clauses where helpful.
- If user is discussing only, do not execute.
- If drafting, produce usable drafting in Itzik's voice.
- Do not claim any file, database, email, deployment, or code action was done unless it was actually done.`;

  return prompt;
}

function buildMessages({ body, systemPrompt }) {
  const {
    prompt,
    chatHistory = [],
    emailContext = null,
    surface = 'main_chat',
  } = body;

  const messages = [{ role: 'system', content: systemPrompt }];

  if (chatHistory?.length) {
    chatHistory.slice(-18).forEach(msg => {
      if (msg?.role === 'user' || msg?.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: String(msg.content || ''),
        });
      }
    });
  }

  let userContent = String(prompt || '');

  if (
    emailContext &&
    ['email_composer', 'inbox_draft', 'email_reply'].includes(surface)
  ) {
    const emailText =
      emailContext.threadText ||
      emailContext.body ||
      emailContext.body_preview ||
      '';

    if (emailText && !chatHistory?.length) {
      userContent += `\n\nEMAIL/THREAD TO READ:\n${emailText}`;
    }
  }

  if (body.documentContext) {
    userContent += `\n\nDOCUMENT CONTEXT TO USE:\n${
      typeof body.documentContext === 'string'
        ? body.documentContext
        : compactJson(body.documentContext)
    }`;
  }

  if (body.awardContext) {
    userContent += `\n\nAWARD CONTEXT TO USE:\n${
      typeof body.awardContext === 'string'
        ? body.awardContext
        : compactJson(body.awardContext)
    }`;
  }

  if (userContent.trim()) {
    messages.push({
      role: 'user',
      content: userContent.trim(),
    });
  }

  return messages;
}

function splitDocumentReply(fullReply) {
  let replyText = fullReply;
  let documentText = null;

  const docMatch = fullReply.match(/---\s*\n([\s\S]+?)\n\s*---/);

  if (docMatch) {
    documentText = docMatch[1].trim();
    replyText = fullReply.replace(/---[\s\S]*?---/, '').trim();
  }

  return { replyText, documentText };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  if (!OPENAI_KEY) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY not configured',
    });
  }

  const body = req.body || {};

  const {
    prompt,
    surface = 'main_chat',
    emailContext = null,
  } = body;

  if (!prompt && !emailContext) {
    return res.status(400).json({
      error: 'No prompt provided',
    });
  }

  try {
    const projectId = inferProjectId(body);
    const userId = inferUserId(body);
    const modeHint = inferModeHint(surface, prompt);

    const brain = await loadBrain({
      userId,
      projectId,
      surface,
      modeHint,
    });

    const systemPrompt = buildSystemPrompt({
      brain,
      body,
      surface,
      modeHint,
      projectId,
    });

    const messages = buildMessages({
      body: {
        ...body,
        surface,
      },
      systemPrompt,
    });

    console.log(
      `[ely-smart] surface=${surface} mode=${modeHint} brain=${brain?.instruction_set?.name || 'fallback'} project=${projectId || 'none'}`
    );

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 3500,
        temperature: 0.65,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));

      throw new Error(
        err.error?.message ||
        `OpenAI error ${response.status}`
      );
    }

    const data = await response.json();
    const fullReply = cleanOutput(
      data.choices?.[0]?.message?.content || ''
    );

    const {
      replyText,
      documentText,
    } = splitDocumentReply(fullReply);

    return res.status(200).json({
      reply: fullReply,
      replyText,
      documentText,
      instructionSet: brain?.instruction_set?.name || 'ely_master_v2_fallback',
      mode: modeHint,
      brainLoaded: !!brain,
      sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  } catch (err) {
    console.error('[ely-smart] error:', err);

    return res.status(500).json({
      error: err.message,
    });
  }
}
