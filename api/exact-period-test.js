// api/exact-period-test.js
// Part 2: Exact runtime reconstruction
// Variant A: current production prompt (as assembled today)
// Variant B: exact reconstruction of the good-period prompt
//            - uses backup output_rules (good period version)
//            - no knowledge_layer
//            - no user_brain
//            - same message count structure as good period
//            - everything else identical

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

function sb() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

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

const GLOBAL_AI_STANDARD = `
NORA V4 RUNTIME STANDARD:
The current user instruction and detected intent control the response.
Do not draft unless the detected intent is draft.
Do not let surface, memory or project context override detected intent.
Use UK English.
Do not invent facts.
Do not use long dashes.
Refer to the legislation as the Act where context is clear.

FEE QUOTING RULE:
When fees are agreed with a client during conversation, end your message with a structured tag on its own line:
FEE_AGREED: notice=100, soc=300, agreed_surveyor=450, separate=600
Replace the numbers with the actual agreed figures. This tag is read by the system to auto-populate the fee quote document.
Do not include this tag unless specific fees have been agreed or confirmed in this conversation.

SUBJECT LINE — ADJOINING OWNER REFERENCE:
The default email subject already includes the Building Owner's property address — do not include the project reference number in the subject under any circumstances, it has no meaning to the recipient.
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

GREETING

Read the supplied email thread and context.

Use the recipient's actual first name where it is clearly available.

Do not guess a name.

Do not use a placeholder.

Where no recipient name is available, use:

Hi,

PROFESSIONAL ROLE

You are an expert professional correspondence drafter with specialist knowledge of:

- Party Wall matters
- construction processes
- construction-related disputes
- surveying practice
- project management
- professional fees
- practical project delivery

Use that expertise to understand the user's meaning and professional position.

Do not use professional knowledge to invent facts, arguments or conclusions that the user did not provide and that are not established by the supplied context.

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

These editorial actions are not invention.

Do not add facts, arguments, legal positions, technical conclusions, promises or requests not present in the source material or established context.
`;

const DRAFT_WORKFLOW_RULES = `DRAFT WORKFLOW RULES -- follow these in order:

1. READ FIRST: If an email or document is in context, read it fully before doing anything.
2. BRIEF FIRST: In one or two short sentences, tell Itzik what the email/message is saying and flag anything important — dates, requests, sensitivities. Do not skip this even if he gave you a clear brief.
3. NEVER INVENT: Never assume availability, dates, times, names, fees, or any fact not explicitly stated. If you need a fact you don't have, ask for it in one short question.
4. DRAFT: Produce the clean draft immediately after the brief — no preamble, no "here is a draft:", start with the greeting or first line of the email.
5. TONE DEFAULT: Unless told otherwise, default is warm, human and conversational. Not formal. Not corporate. Not robotic. Sound like a real person.
6. BANNED PHRASES IN DRAFTS: Never use "I look forward to receiving your correspondence", "I look forward to hearing from you", "Please do not hesitate to contact me", "I hope this finds you well", "Thank you for your attention to this matter", "I remain", "Yours faithfully", "Please feel free to", "I trust this meets your requirements". These are Android phrases. Use natural human closings.
7. CLEAN DRAFT: The draft must contain zero commentary, zero meta-text, zero subject lines, zero "let me know if you want changes". Just the email text from greeting to "Kind regards". Nothing else inside the draft.
8. SUBJECT LINE: If a subject line is needed, put it on a separate line BEFORE the draft with the format "Subject: [text]" -- never inside the draft itself.`;

const SECTION_10_STATUTORY = `AUTHORITATIVE STATUTORY REFERENCE -- Party Wall etc. Act 1996:

The following is the exact statutory text from legislation.gov.uk. Answer the user's question from this text. Do not rely on general knowledge where the Act text is provided here.

Section 10 — Resolution of disputes

STATUTORY TEXT:
(1) Where a dispute arises or is deemed to have arisen between a building owner and an adjoining owner in respect of any matter connected with any work to which this Act relates either—
(a) both parties shall concur in the appointment of one surveyor (an "agreed surveyor"); or
(b) each party shall appoint a surveyor and the two surveyors shall forthwith select a third surveyor (all of whom are "the three surveyors").

(4) If either party refuses or neglects to appoint a surveyor for ten days beginning with the day on which the other party serves a request, the other party may make the appointment on his behalf.

(6) If a surveyor appointed by a party refuses to act effectively, the surveyor of the other party may proceed to act ex parte.

(7) If a surveyor neglects to act effectively for ten days, the surveyor of the other party may proceed to act ex parte in respect of the subject matter of the request.

(10) The agreed surveyor or as the case may be the three surveyors or any two of them shall settle by award any matter connected with any work to which this Act relates which is in dispute between the building owner and the adjoining owner.

(12) An award may determine—
(a) the right to execute any work;
(b) the time and manner of executing any work; and
(c) any other matter arising out of or incidental to the dispute including the costs of making the award.

(13) The reasonable costs incurred in making or obtaining an award, reasonable inspections, and any other matter arising out of the dispute, shall be paid by such of the parties as the surveyor or surveyors making the award determine.

(17) Either of the parties may, within fourteen days of service of the award, appeal to the county court against the award.`;

async function loadBrains() {
  const { data } = await sb()
    .from('ai_instruction_sets')
    .select('name, system_prompt, output_rules, behaviour_rules')
    .in('name', ['ely_master_v3', 'ely_master_v3_backup_20260624', 'party_wall_knowledge']);
  return Object.fromEntries((data || []).map(r => [r.name, r]));
}

async function loadUserBrain() {
  const { data } = await sb()
    .from('user_brain')
    .select('brain_content')
    .eq('user_id', '3bd1f331-e8ce-477a-8a5d-c5dcdd901434')
    .single();
  return data?.brain_content || null;
}

async function loadProjectData(projectId) {
  const { data: proj } = await sb().from('projects').select('*').eq('id', projectId).maybeSingle();
  const { data: emails } = await sb()
    .from('emails')
    .select('subject, sender_name, direction, received_at, sent_at, body, body_preview')
    .eq('project_id', projectId)
    .order('received_at', { ascending: true })
    .limit(20);

  const facts = proj ? [
    proj.ref ? `Reference: ${proj.ref}` : null,
    proj.bo_premise_address ? `Project address: ${proj.bo_premise_address}` : null,
    proj.role ? `Role: ${proj.role}` : null,
  ].filter(Boolean).join('\n') : '';

  const emailsText = (emails || []).map(e => {
    const date = new Date(e.received_at || e.sent_at || '').toLocaleDateString('en-GB', {day:'2-digit',month:'2-digit',year:'numeric'});
    const dir = e.direction === 'outgoing' ? 'SENT' : 'RECEIVED';
    const from = e.direction === 'outgoing' ? 'Square One Consulting' : (e.sender_name || 'unknown');
    const body = stripHtml(e.body || e.body_preview || '').slice(0, 1500);
    return `[${date}] ${dir} -- From: ${from}\nSubject: ${e.subject || '(no subject)'}\n${body}`;
  }).join('\n\n---\n\n');

  return { facts, emailsText, project: proj };
}

async function loadDraftingExamples() {
  const { data } = await sb().from('ai_drafting_examples').select('*').eq('active', true).limit(3);
  return data || [];
}

async function buildPromptA(brains, userBrain, facts, emailsText, examples) {
  // CURRENT production prompt
  const master = brains['ely_master_v3'];
  let prompt = master.system_prompt;
  if (master.output_rules) prompt += `\n\n${master.output_rules}`;
  if (master.behaviour_rules) prompt += `\n\n${master.behaviour_rules}`;

  // knowledge_layer
  const knowledge = brains['party_wall_knowledge'];
  if (knowledge?.system_prompt) {
    prompt += `\n\n--- KNOWLEDGE: PARTY WALL & CONSTRUCTION ---\n\n${knowledge.system_prompt}`;
  }

  // user_brain
  if (userBrain) {
    prompt += `\n\n--- USER PREFERENCES ---\n\n${userBrain}`;
  }

  prompt += `\n\n${GLOBAL_AI_STANDARD}\n`;
  prompt += ACTIVE_MODE_DRAFT;

  if (facts) prompt += `\n\nAUTHORITATIVE PROJECT FACTS:\n${facts}`;
  if (emailsText) prompt += `\n\nPROJECT EMAILS -- FULL CORRESPONDENCE (incoming and outgoing):\n${emailsText}`;

  if (examples.length) {
    prompt += `\n\nGOLD STANDARD DRAFTING EXAMPLES:\n${JSON.stringify(examples, null, 2)}\n`;
  }

  return prompt;
}

async function buildPromptB(brains, facts, emailsText, examples) {
  // GOOD PERIOD EXACT RECONSTRUCTION:
  // - uses backup output_rules (good period version)
  // - no knowledge_layer
  // - no user_brain (table didn't exist in good period)
  // - same section order as good period code
  const master = brains['ely_master_v3'];
  const goodBackup = brains['ely_master_v3_backup_20260624'];

  let prompt = master.system_prompt; // identical to backup
  // Use the GOOD PERIOD output_rules (backup version)
  if (goodBackup?.output_rules) prompt += `\n\n${goodBackup.output_rules}`;
  if (master.behaviour_rules) prompt += `\n\n${master.behaviour_rules}`;

  // NO knowledge_layer - did not exist in good period
  // NO user_brain - did not exist in good period
  // NO domain_layer - mode=draft excluded from domain query in both periods

  prompt += `\n\n${GLOBAL_AI_STANDARD}\n`;
  prompt += ACTIVE_MODE_DRAFT;

  if (facts) prompt += `\n\nAUTHORITATIVE PROJECT FACTS:\n${facts}`;
  if (emailsText) prompt += `\n\nPROJECT EMAILS -- FULL CORRESPONDENCE (incoming and outgoing):\n${emailsText}`;

  // Project bundle: good period had empty project_memory for Montague Road
  // So bundle is identical - no project_memory to include

  if (examples.length) {
    prompt += `\n\nGOLD STANDARD DRAFTING EXAMPLES:\n${JSON.stringify(examples, null, 2)}\n`;
  }

  return prompt;
}

async function callGPT(systemPrompt, userPrompt, label) {
  // Both use identical message structure: 
  // Section 10 fires because prompt contains "Section 10" 
  // This also fired in the good period via isStatutoryQuestion
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: SECTION_10_STATUTORY },
    { role: 'system', content: `ACTIVE SELECTED EMAIL CONTEXT:\nThe user is discussing the Lewis Davies email thread for 21 & 21a Montague Road, N8 9PJ.` },
    { role: 'system', content: DRAFT_WORKFLOW_RULES },
    { role: 'user', content: userPrompt },
  ];

  console.log(`[exact-test] ${label}: system_prompt_len=${systemPrompt.length} messages=${messages.length}`);

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

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    reply: data.choices?.[0]?.message?.content || '',
    usage: data.usage,
    system_prompt_len: systemPrompt.length,
    model: data.model,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_prompt, project_id } = req.body;
  if (!user_prompt) return res.status(400).json({ error: 'user_prompt required' });

  try {
    const [brains, userBrain, projectData, examples] = await Promise.all([
      loadBrains(),
      loadUserBrain(),
      project_id ? loadProjectData(project_id) : Promise.resolve({ facts: '', emailsText: '', project: null }),
      loadDraftingExamples(),
    ]);

    const { facts, emailsText } = projectData;

    const [promptA, promptB] = await Promise.all([
      buildPromptA(brains, userBrain, facts, emailsText, examples),
      buildPromptB(brains, facts, emailsText, examples),
    ]);

    const [resultA, resultB] = await Promise.all([
      callGPT(promptA, user_prompt, 'A (current)'),
      callGPT(promptB, user_prompt, 'B (good-period exact)'),
    ]);

    // Save to debug_payloads
    const s = sb();
    await s.from('debug_payloads').insert([
      {
        model: 'gpt-4o', temperature: 0.62, mode: 'exact_test_A', surface: 'exact_period_test',
        messages: [{ role: 'system', content: promptA }],
        system_prompt_length: promptA.length, total_messages: 5,
        openai_response: { reply_full: resultA.reply, usage: resultA.usage },
      },
      {
        model: 'gpt-4o', temperature: 0.62, mode: 'exact_test_B', surface: 'exact_period_test',
        messages: [{ role: 'system', content: promptB }],
        system_prompt_length: promptB.length, total_messages: 5,
        openai_response: { reply_full: resultB.reply, usage: resultB.usage },
      },
    ]);

    return res.status(200).json({
      variant_a: {
        label: 'CURRENT production prompt',
        system_prompt_len: resultA.system_prompt_len,
        includes_knowledge_layer: true,
        includes_user_brain: true,
        output_rules_version: 'current (Maintain these aspects...)',
        reply: resultA.reply,
      },
      variant_b: {
        label: 'GOOD PERIOD exact reconstruction',
        system_prompt_len: resultB.system_prompt_len,
        includes_knowledge_layer: false,
        includes_user_brain: false,
        output_rules_version: 'good period (Do not preserve rough spoken wording...)',
        reply: resultB.reply,
      },
      difference_chars: resultA.system_prompt_len - resultB.system_prompt_len,
    });

  } catch (err) {
    console.error('[exact-period-test]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
