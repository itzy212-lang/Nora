// api/ely-smart.js
// Ely's brain — pulls ALL instruction sets from Supabase ai_instruction_sets
// so behaviour can be tuned in Supabase without code deployments

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;

// ── Core Ely identity — always prepended to every surface ─────────────────────
const ELY_CORE_IDENTITY = `You are Ely — the expert AI assistant to Itzik Darel MIPWS ACIArb, a professional party wall surveyor at Square One Consulting, Suite 28, 708A High Road, London N12 9QL.

WHO YOU ARE:
- A party wall expert with deep knowledge of the Party Wall etc. Act 1996
- An expert email drafter who writes in Itzik's voice — direct, warm where appropriate, authoritative
- A trusted colleague who knows the cases, the law, the practice, and the people
- You do not waffle. You do not use filler. You get to the point.

PARTY WALL EXPERTISE:
- Full knowledge of S1, S2, S3, S6, S7, S8, S10, S11, S12 of the Act
- Award drafting, consent/dissent procedures, third surveyor appointments
- Security for expenses, schedule of condition, access rights
- S10(17) appeal rights — always 14 days to County Court
- CDM 2015, JCT contracts, NEC contracts
- Common disputes, damage claims, escalation procedures

ITZIK'S STYLE:
- Direct and purposeful — says what needs to be said, nothing more
- Warm when the situation calls for it, firm when it does not
- Professional but human — never cold, never robotic, never bureaucratic
- Short sentences, plain English, confident tone
- Writes as a person, not as a department

ABSOLUTE BANS — never appear in any output:
- Em dashes (—)
- "I hope this email finds you well"
- "I am writing to"
- "please be aware that"
- "please do not hesitate to"
- "as per our previous correspondence"
- "it is essential that"
- "I trust this clarifies"
- "kind regards" or any sign-off (signature is handled separately)`;

// ── Fetch instruction set from Supabase ───────────────────────────────────────
async function fetchInstructionSet(name) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data } = await sb
      .from('ai_instruction_sets')
      .select('system_prompt, behaviour_rules, output_rules')
      .eq('name', name)
      .eq('active', true)
      .single();
    return data || null;
  } catch {
    return null;
  }
}

// ── Map surface to instruction set name ───────────────────────────────────────
function surfaceToInstructionSet(surface) {
  const map = {
    inbox_draft:     'inbox_draft',
    email_composer:  'email_composer',
    email_reply:     'email_composer',
    project_chat:    'party_wall_discussion',
    main_chat:       'party_wall_default',
    soc:             'party_wall_drafting',
    award_review:    'award_review',
    document:        'document_finaliser',
  };
  return map[surface] || 'party_wall_default';
}

// ── Build system prompt from Supabase instruction set ─────────────────────────
function buildSystemPromptFromInstructions(instructions, context = {}) {
  let prompt = ELY_CORE_IDENTITY;

  if (instructions) {
    if (instructions.system_prompt) {
      prompt += `\n\n${instructions.system_prompt}`;
    }
    if (instructions.behaviour_rules) {
      prompt += `\n\nBEHAVIOUR RULES:\n${instructions.behaviour_rules}`;
    }
    if (instructions.output_rules) {
      prompt += `\n\nOUTPUT RULES:\n${instructions.output_rules}`;
    }
  }

  // Inject live project context if provided
  if (context.currentProject) {
    const p = context.currentProject;
    prompt += `\n\nCURRENT PROJECT CONTEXT:
Ref: ${p.ref || 'unknown'}
Role: ${p.role || 'BO'} Surveyor
Address: ${p.bo_premise_address || p.address || 'unknown'}
Building Owner: ${p.bo_1_name || p.bo || 'unknown'}
Status: ${p.status || 'active'}
Works: ${p.works || 'not specified'}`;
  }

  if (context.projectsContext?.length) {
    const summary = context.projectsContext.slice(0, 5).map(p =>
      `${p.ref}: ${p.bo_premise_address || p.address || 'unknown'} (${p.status || 'active'})`
    ).join('\n');
    prompt += `\n\nACTIVE PROJECTS:\n${summary}`;
  }

  if (context.emailContext) {
    const e = context.emailContext;
    prompt += `\n\nEMAIL CONTEXT:
From: ${e.from || 'unknown'}
Subject: ${e.subject || 'unknown'}`;
  }

  return prompt;
}

// ── Build messages array for OpenAI ──────────────────────────────────────────
function buildMessages({ chatHistory, prompt, emailContext, surface, systemPrompt }) {
  const messages = [{ role: 'system', content: systemPrompt }];

  // Add chat history
  if (chatHistory?.length) {
    chatHistory.slice(-16).forEach(msg => {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: String(msg.content || '') });
      }
    });
  }

  // Build user message
  let userContent = prompt || '';

  // For email surfaces, inject the email context as part of the message
  if (emailContext && (surface === 'email_composer' || surface === 'inbox_draft' || surface === 'email_reply')) {
    const emailText = emailContext.threadText || emailContext.body || '';
    if (emailText && !chatHistory?.length) {
      // Only inject on first message — subsequent messages use chat history
      userContent = `${userContent}\n\nEMAIL/THREAD TO READ:\n${emailText}`;
    }
  }

  if (userContent) {
    messages.push({ role: 'user', content: userContent });
  }

  return messages;
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!OPENAI_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const {
    prompt,
    surface = 'main_chat',
    chatHistory = [],
    projectsContext = [],
    currentProject = null,
    recentEmails = [],
    emailContext = null,
  } = req.body;

  if (!prompt && !emailContext) return res.status(400).json({ error: 'No prompt provided' });

  try {
    // Fetch instruction set from Supabase
    const instructionSetName = surfaceToInstructionSet(surface);
    const instructions = await fetchInstructionSet(instructionSetName);

    console.log(`[ely-smart] surface=${surface} → instruction_set=${instructionSetName} → found=${!!instructions}`);

    // Build system prompt from Supabase instructions + context
    const systemPrompt = buildSystemPromptFromInstructions(instructions, {
      currentProject,
      projectsContext,
      recentEmails,
      emailContext,
    });

    // Build messages
    const messages = buildMessages({
      chatHistory,
      prompt,
      emailContext,
      surface,
      systemPrompt,
    });

    // Call OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 3000,
        temperature: 0.7,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `OpenAI error ${response.status}`);
    }

    const data = await response.json();
    // Strip em dashes regardless of whether GPT followed the instruction
    const rawReply = data.choices?.[0]?.message?.content || '';
    const fullReply = rawReply
      .replace(/—/g, ' - ')    // em dash → spaced hyphen
      .replace(/–/g, '-')       // en dash → hyphen
      .replace(/--/g, '-')           // double hyphen → single
      .replace(/pre-existing/gi, 'preexisting')  // common hyphenation fix
      .replace(/co-ordinate/gi, 'coordinate')
      .replace(/e-mail/gi, 'email');

    // Parse replyText and documentText if the response contains them
    let replyText = fullReply;
    let documentText = null;

    // Look for document between --- markers
    const docMatch = fullReply.match(/---\s*\n([\s\S]+?)\n\s*---/);
    if (docMatch) {
      documentText = docMatch[1].trim();
      replyText = fullReply.replace(/---[\s\S]*?---/, '').trim();
    }

    return res.status(200).json({
      reply: fullReply,
      replyText,
      documentText,
      instructionSet: instructionSetName,
      sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

  } catch (err) {
    console.error('[ely-smart] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
