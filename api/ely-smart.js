// api/ely-smart.js
// Ely/Nora smart route — scoped project + safe email context version

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
    .replace(/--/g, '-');
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
    'itzy212@gmail.com'
  );
}

async function resolveProjectFromPrompt(prompt) {
  const sb = getSupabase();

  if (!sb || !prompt) return null;

  const search = String(prompt)
    .replace(/project/gi, '')
    .replace(/open/gi, '')
    .replace(/load/gi, '')
    .trim();

  if (search.length < 3) return null;

  const { data, error } = await sb
    .from('projects')
    .select(`
      id,
      name,
      ref,
      bo_premise_address,
      ao_premise_address
    `)
    .or([
      `name.ilike.%${search}%`,
      `ref.ilike.%${search}%`,
      `bo_premise_address.ilike.%${search}%`,
      `ao_premise_address.ilike.%${search}%`
    ].join(','))
    .limit(5);

  if (error) {
    console.warn('[ely-smart] project resolver error:', error.message);
    return null;
  }

  return data?.[0] || null;
}

async function buildScopedEmailContext({
  prompt,
  projectId,
}) {
  const sb = getSupabase();

  if (!sb || !prompt) return null;

  const lower = String(prompt).toLowerCase();

  const wantsEmail =
    lower.includes('email') ||
    lower.includes('thread') ||
    lower.includes('inbox');

  if (!wantsEmail) return null;

  let query = sb
    .from('emails')
    .select(`
      id,
      subject,
      sender_name,
      sender_email,
      body_preview,
      received_at,
      project_id,
      thread_id,
      folder
    `)
    .order('received_at', {
      ascending: false,
    });

  if (projectId) {
    query = query
      .eq('project_id', projectId)
      .limit(20);
  } else {
    query = query
      .in('folder', ['Inbox', 'Sent Items'])
      .limit(100);
  }

  const { data, error } = await query;

  if (error) {
    console.warn('[ely-smart] email context error:', error.message);
    return [];
  }

  return data || [];
}

function inferModeHint(surface, prompt = '') {
  const p = String(prompt || '').toLowerCase();

  if (
    p.includes('draft') ||
    p.includes('write') ||
    p.includes('reply')
  ) {
    return 'draft';
  }

  if (
    p.includes('review') ||
    p.includes('compare')
  ) {
    return 'review';
  }

  return 'discuss';
}

async function loadBrain({
  userId,
  projectId,
  surface,
  modeHint,
}) {
  const sb = getSupabase();

  if (!sb) return null;

  const { data, error } = await sb.rpc(
    'get_ely_brain_v2',
    {
      p_user_id: userId || null,
      p_project_id: projectId || null,
      p_surface: surface || null,
      p_mode: modeHint || null,
    }
  );

  if (error) {
    console.warn('[ely-smart] brain load failed:', error.message);
    return null;
  }

  return data || null;
}

function compactJson(value) {
  try {
    return JSON.stringify(value, null, 2).slice(0, 12000);
  } catch {
    return '';
  }
}

function buildSystemPrompt({
  brain,
  projectId,
  resolvedProject,
  scopedEmailContext,
}) {
  let prompt =
    brain?.instruction_set?.system_prompt ||
    'You are Ely, an AI assistant for a Party Wall surveying practice.';

  prompt += `

RULES:
- When a project is active, searches must remain inside that project first.
- Never perform unrestricted global email hydration.
- Global searches must remain capped.
- Use metadata-first email searching only.
- Do not mix unrelated project context.
`;

  prompt += `

PROJECT ID:
${projectId || 'none'}
`;

  if (resolvedProject) {
    prompt += `

RESOLVED PROJECT:
${compactJson(resolvedProject)}
`;
  }

  if (scopedEmailContext?.length) {
    prompt += `

SCOPED EMAIL CONTEXT:
${compactJson(scopedEmailContext.slice(0, 20))}
`;
  }

  return prompt;
}

function buildMessages({
  body,
  systemPrompt,
}) {
  const {
    prompt,
    chatHistory = [],
  } = body;

  const messages = [
    {
      role: 'system',
      content: systemPrompt,
    },
  ];

  if (chatHistory?.length) {
    chatHistory
      .slice(-18)
      .forEach((msg) => {
        if (
          msg?.role === 'user' ||
          msg?.role === 'assistant'
        ) {
          messages.push({
            role: msg.role,
            content: String(msg.content || ''),
          });
        }
      });
  }

  if (prompt?.trim()) {
    messages.push({
      role: 'user',
      content: prompt.trim(),
    });
  }

  return messages;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  if (!OPENAI_KEY) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY missing',
    });
  }

  try {
    const body = req.body || {};

    let projectId = inferProjectId(body);

    const resolvedProject =
      !projectId
        ? await resolveProjectFromPrompt(body.prompt)
        : null;

    if (resolvedProject?.id) {
      projectId = resolvedProject.id;
    }

    const scopedEmailContext =
      await buildScopedEmailContext({
        prompt: body.prompt,
        projectId,
      });

    const userId = inferUserId(body);

    const modeHint = inferModeHint(
      body.surface,
      body.prompt
    );

    const brain = await loadBrain({
      userId,
      projectId,
      surface: body.surface,
      modeHint,
    });

    const systemPrompt = buildSystemPrompt({
      brain,
      projectId,
      resolvedProject,
      scopedEmailContext,
    });

    const messages = buildMessages({
      body,
      systemPrompt,
    });

    console.log(
      `[ely-smart] project=${projectId || 'none'} emails=${scopedEmailContext?.length || 0}`
    );

    const response = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
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
      }
    );

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

    return res.status(200).json({
      reply: fullReply,
      resolvedProject,
      scopedEmailCount:
        scopedEmailContext?.length || 0,
      brainLoaded: !!brain,
      sessionId: `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`,
    });
  } catch (err) {
    console.error('[ely-smart] error:', err);

    return res.status(500).json({
      error: err.message,
    });
  }
}
