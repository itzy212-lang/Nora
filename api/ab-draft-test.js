// api/ab-draft-test.js
// Controlled A/B comparison: full current prompt vs pre-brain-split prompt
// Variant A: current runtime (knowledge_layer + user_brain included)
// Variant B: layers removed (ely_master_v3 only — matches pre-2-Jul state)
// Everything else identical: model, temperature, email context, project context,
// DRAFT block, output_rules, messages array structure.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function loadBrainLayers() {
  const sb = getSupabase();
  if (!sb) return {};

  const { data, error } = await sb
    .from('ai_instruction_sets')
    .select('name, system_prompt, output_rules, behaviour_rules, active')
    .in('name', ['ely_master_v3', 'party_wall_knowledge', 'drafting_rules']);

  if (error || !data) return {};
  return Object.fromEntries(data.map(r => [r.name, r]));
}

async function loadUserBrain() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('user_brain')
    .select('brain_content')
    .eq('user_id', '3bd1f331-e8ce-477a-8a5d-c5dcdd901434')
    .single();
  return data?.brain_content || null;
}

const GLOBAL_AI_STANDARD = `
NORA V4 RUNTIME STANDARD:
The current user instruction and detected intent control the response.
Do not draft unless the detected intent is draft.
Do not let surface, memory or project context override detected intent.
Use UK English.
Do not invent facts.
Do not use long dashes.
Refer to the legislation as the Act where context is clear.
`;

const ACTIVE_MODE_DRAFT = `

ACTIVE MODE: DRAFT

OUTPUT ONLY THE COMPLETED CORRESPONDENCE.

Do not provide:

- analysis
- explanation
- commentary
- notes
- options
- a preamble
- a summary
- drafting advice

Begin with the greeting.

End with:

Kind regards,

Nothing may appear after the sign-off.

EDITORIAL TASK

Convert the user's source material into a professionally written email or letter.

Do not transcribe the dictation.

Do not merely correct grammar while retaining spoken sentence structure.

The finished correspondence must read as though it was written carefully by an experienced professional.

Preserve:

- the user's meaning
- the user's intended outcome
- the user's reasoning
- genuinely distinct arguments
- distinctions between issues
- qualifications
- caveats
- questions
- requests
- material emphasis

You may:

- rewrite rough speech
- consolidate repeated points
- combine overlapping fragments
- split run-on thoughts
- reorder material into a logical sequence
- remove filler and false starts
- remove abandoned wording
- improve paragraph structure

Do not add facts, arguments, legal positions, technical conclusions, promises or requests not present in the source material or established context.
`;

const DRAFT_WORKFLOW_RULES = `DRAFT WORKFLOW RULES — follow these in order:

1. READ FIRST: If an email or document is in context, read it fully before doing anything.
2. BRIEF FIRST: In one or two short sentences, tell Itzik what the email/message is saying and flag anything important — dates, requests, sensitivities. Do not skip this even if he gave you a clear brief.
3. NEVER INVENT: Never assume availability, dates, times, names, fees, or any fact not explicitly stated. If you need a fact you don't have, ask for it in one short question.
4. DRAFT: Produce the clean draft immediately after the brief — no preamble, no "here is a draft:", start with the greeting or first line of the email.
5. TONE DEFAULT: Unless told otherwise, default is warm, human and conversational. Not formal. Not corporate. Not robotic. Sound like a real person.
6. BANNED PHRASES IN DRAFTS: Never use "I look forward to receiving your correspondence", "I look forward to hearing from you", "Please do not hesitate to contact me", "I hope this finds you well", "Thank you for your attention to this matter", "I remain", "Yours faithfully", "Please feel free to", "I trust this meets your requirements". These are Android phrases. Use natural human closings.
7. CLEAN DRAFT: The draft must contain zero commentary, zero meta-text, zero subject lines, zero "let me know if you want changes". Just the email text from greeting to "Kind regards". Nothing else inside the draft.
8. SUBJECT LINE: If a subject line is needed, put it on a separate line BEFORE the draft with the format "Subject: [text]" — never inside the draft itself.`;

async function buildPromptVariant(layers, userBrain, emailContext, projectFacts, variant) {
  const master = layers['ely_master_v3'];
  if (!master) throw new Error('ely_master_v3 not found');

  let prompt = master.system_prompt || '';
  if (master.output_rules) prompt += `\n\n${master.output_rules}`;
  if (master.behaviour_rules) prompt += `\n\n${master.behaviour_rules}`;

  if (variant === 'A') {
    // Variant A: current full prompt — include knowledge_layer and user_brain
    const knowledge = layers['party_wall_knowledge'];
    if (knowledge?.system_prompt) {
      prompt += `\n\n--- KNOWLEDGE: PARTY WALL & CONSTRUCTION ---\n\n${knowledge.system_prompt}`;
    }
    // drafting_rules is active=false so does not load — consistent with production
    if (userBrain) {
      prompt += `\n\n--- USER PREFERENCES ---\n\n${userBrain}`;
    }
    console.log(`[ab-test] Variant A: knowledge_layer=${knowledge?.system_prompt?.length || 0} user_brain=${userBrain?.length || 0}`);
  } else {
    // Variant B: pre-2-Jul state — ely_master_v3 only, no added layers
    console.log(`[ab-test] Variant B: no knowledge_layer, no user_brain`);
  }

  // Everything below is IDENTICAL in both variants
  prompt += `\n\n${GLOBAL_AI_STANDARD}\n`;
  prompt += ACTIVE_MODE_DRAFT;

  if (projectFacts) {
    prompt += `\n\nPROJECT ID:\n${projectFacts.id}\n\nAUTHORITATIVE PROJECT FACTS:\n${projectFacts.facts}`;
  }

  if (emailContext) {
    prompt += `\n\nPROJECT EMAILS — FULL CORRESPONDENCE (incoming and outgoing):\n${emailContext}`;
  }

  return prompt;
}

async function callGPT(systemPrompt, userPrompt, variantLabel) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: DRAFT_WORKFLOW_RULES },
    { role: 'user', content: userPrompt },
  ];

  console.log(`[ab-test] ${variantLabel}: system_prompt_len=${systemPrompt.length} total_messages=${messages.length}`);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.62,
      max_tokens: 1500,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${err}`);
  }

  const data = await res.json();
  return {
    reply: data.choices?.[0]?.message?.content || '',
    usage: data.usage,
    system_prompt_len: systemPrompt.length,
    message_count: messages.length,
    model: data.model,
  };
}

async function loadProjectEmailsForTest(projectId) {
  const sb = getSupabase();
  if (!sb || !projectId) return '';

  const { data } = await sb
    .from('emails')
    .select('subject, sender_name, direction, received_at, sent_at, body, body_preview')
    .eq('project_id', projectId)
    .order('received_at', { ascending: true })
    .limit(20);

  if (!data?.length) return '';

  function stripHtml(t = '') {
    return String(t || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#\d+;/gi, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return data.map(e => {
    const date = new Date(e.received_at || e.sent_at || '').toLocaleDateString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric'});
    const dir = e.direction === 'outgoing' ? 'SENT' : 'RECEIVED';
    const from = e.direction === 'outgoing' ? 'Square One Consulting' : (e.sender_name || 'unknown');
    const body = stripHtml(e.body || e.body_preview || '').slice(0, 1500);
    return `[${date}] ${dir} — From: ${from}\nSubject: ${e.subject || '(no subject)'}\n${body}`;
  }).join('\n\n---\n\n');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_prompt, project_id } = req.body;

  if (!user_prompt) {
    return res.status(400).json({ error: 'user_prompt required' });
  }

  try {
    // Load all ingredients in parallel
    const [layers, userBrain, emailContext] = await Promise.all([
      loadBrainLayers(),
      loadUserBrain(),
      project_id ? loadProjectEmailsForTest(project_id) : Promise.resolve(''),
    ]);

    // Project facts
    let projectFacts = null;
    if (project_id) {
      const sb = getSupabase();
      const { data: proj } = await sb.from('projects').select('*').eq('id', project_id).maybeSingle();
      if (proj) {
        projectFacts = {
          id: project_id,
          facts: [
            proj.ref ? `Reference: ${proj.ref}` : null,
            proj.bo_premise_address ? `Project address: ${proj.bo_premise_address}` : null,
            proj.role ? `Role: ${proj.role}` : null,
          ].filter(Boolean).join('\n'),
        };
      }
    }

    // Build both variants
    const [promptA, promptB] = await Promise.all([
      buildPromptVariant(layers, userBrain, emailContext, projectFacts, 'A'),
      buildPromptVariant(layers, userBrain, emailContext, projectFacts, 'B'),
    ]);

    // Run both against GPT-4o with identical temperature, model, messages structure
    const [resultA, resultB] = await Promise.all([
      callGPT(promptA, user_prompt, 'A (full — knowledge+user_brain)'),
      callGPT(promptB, user_prompt, 'B (slim — ely_master_v3 only)'),
    ]);

    // Save results to Supabase for inspection
    const sb = getSupabase();
    if (sb) {
      await sb.from('debug_payloads').insert([{
        model: 'gpt-4o',
        temperature: 0.62,
        mode: 'ab_test_A',
        surface: 'ab_draft_test',
        messages: [{ role: 'system', content: promptA }, { role: 'system', content: DRAFT_WORKFLOW_RULES }, { role: 'user', content: user_prompt }],
        system_prompt_length: promptA.length,
        total_messages: 3,
        openai_response: { reply_full: resultA.reply, usage: resultA.usage },
      }, {
        model: 'gpt-4o',
        temperature: 0.62,
        mode: 'ab_test_B',
        surface: 'ab_draft_test',
        messages: [{ role: 'system', content: promptB }, { role: 'system', content: DRAFT_WORKFLOW_RULES }, { role: 'user', content: user_prompt }],
        system_prompt_length: promptB.length,
        total_messages: 3,
        openai_response: { reply_full: resultB.reply, usage: resultB.usage },
      }]);
    }

    return res.status(200).json({
      variant_a: {
        label: 'Current (knowledge_layer + user_brain included)',
        system_prompt_len: resultA.system_prompt_len,
        knowledge_layer_len: layers['party_wall_knowledge']?.system_prompt?.length || 0,
        user_brain_len: userBrain?.length || 0,
        reply: resultA.reply,
        tokens: resultA.usage,
      },
      variant_b: {
        label: 'Pre-2-Jul (ely_master_v3 only — no added layers)',
        system_prompt_len: resultB.system_prompt_len,
        knowledge_layer_len: 0,
        user_brain_len: 0,
        reply: resultB.reply,
        tokens: resultB.usage,
      },
    });

  } catch (err) {
    console.error('[ab-draft-test] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
