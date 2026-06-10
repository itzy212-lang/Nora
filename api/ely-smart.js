// api/ely-smart.js
// Ely/Nora smart route - project-hydrated collaboration version
// Global behaviour: analyse first, draft only when clearly requested.

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
  let value = String(text || '');

  value = value
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/^[ \t]*[-*•][ \t]+/gm, '')
    .replace(/^[ \t]*[-]{3,}[ \t]*$/gm, '')
    .replace(/^[ \t]*[_]{3,}[ \t]*$/gm, '')
    .replace(/^[ \t]*[=]{3,}[ \t]*$/gm, '')
    .replace(/–/g, '-')
    .replace(/—/g, '-')
    .replace(/--+/g, ', ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return value;
}

function inferProjectId(body = {}) {
  return (
    body.project_id ||
    body.projectId ||
    body.currentProject?.id ||
    body.emailContext?.project_id ||
    body.emailContext?.projectId ||
    body.context?.activeProjectId ||
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

function compactJson(value, limit = 16000) {
  try {
    return JSON.stringify(value, null, 2).slice(0, limit);
  } catch {
    return '';
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function stripHtml(value = '') {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const GLOBAL_AI_STANDARD = `
GLOBAL AI STANDARD:
LANGUAGE: Always write in UK English. Use British spelling: colour not color, favour not favor, realise not realize, organise not organize, programme not program, behaviour not behavior, analyse not analyze, recognise not recognize, defence not defense, offence not offense, judgement not judgment. This applies to every response without exception.

Ely is an advisor and case analyst first, and a drafting assistant second.

This standard applies across the main chat, project chat, email chat, Draft with Ely, document review, award review, notice review, incoming email analysis and general conversation.

CRITICAL — EMAILS, CALENDAR AND APPOINTMENTS:
- NEVER guess, invent, or infer information about emails, appointments, meetings, or calendar events unless that information has been explicitly provided in the context of this conversation.
- If asked about emails or appointments and no email search results have been provided in this conversation, say: "I searched your inbox but couldn't find anything matching that — try checking Outlook directly."
- Never apologise for "confusion" about invented information — simply clarify and ask the user to provide more detail.

DEFAULT BEHAVIOUR:
- Assume Itzik wants analysis, discussion and strategic thinking unless he clearly asks for drafting.
- Do not draft correspondence merely because correspondence has been uploaded, opened or selected.
- Do not jump straight to an email, letter, response or draft unless drafting is explicitly requested by the user's words.
- If the user is exploring, questioning, challenging, thinking aloud, asking for a view or asking to chat through points, stay in analysis mode.
- If unsure, choose analysis mode and explain the issue rather than producing a draft.

ANALYSIS MODE TRIGGERS:
Treat the following as analysis requests unless they also contain a clear drafting instruction:
- what do you think
- can he do that
- is that right
- is that a breach
- talk me through this
- let's discuss this
- am I missing something
- what's your view
- what's his angle
- why is he saying this
- how would a judge view this
- how would a third surveyor view this
- I am not looking for a draft
- chat through the points first
- help me form a response

IN ANALYSIS MODE:
- Discuss the issue like an experienced surveyor colleague sitting opposite Itzik.
- Identify the real issue, not just the surface wording.
- Challenge assumptions and push back where appropriate.
- Identify missing facts before reaching firm conclusions.
- Separate strong points from weak points.
- Identify tactical, legal, evidential, practical and commercial risk.
- Ask one focused question only if needed.
- Do not produce a draft email or letter.

DRAFTING MODE:
Only enter drafting mode when Itzik clearly asks for drafting, for example:
- draft this
- write this
- write an email
- write a letter
- prepare an email
- prepare a letter
- let's draft
- draft a response
- reply saying
- respond by saying

DICTATION OVERRIDE:
If Itzik is clearly providing content to be turned into correspondence, switch to drafting/editor mode immediately. This includes:
- Starting with a greeting: Dear, Hi, Hello, Good morning, Thank you for your email, Further to, Following our, I refer to, etc.
- Giving a direction: tell them, say that, change it to, update the, amend it, add in, just say, basically say, etc.
- Providing a spoken brief or raw content that is clearly meant to become an email or letter, even if not starting with a greeting.
Do not treat these as analysis requests. Structure and polish the content into professional correspondence.

THREAD AND DISPUTE REVIEW:
When correspondence, an email thread, a chain of messages or a dispute history is available, review the whole context before responding.
Do not analyse only the latest email.
Always consider:
- the timeline of correspondence
- how each party's position has developed
- whether the latest email is part of a wider narrative
- whether a party is building a case for non-compliance
- contradictions or changes in position
- what is actually being sought
- what is missing or unsupported
- what is within the Act or Award and what is outside it

PARTY WALL ANALYSIS RULE:
Before discussing remedies or response strategy, separate issues into:
- notifiable works matters
- Award compliance matters
- Act matters
- surveyor jurisdiction matters
- damage or compensation claims
- general neighbour disputes
- matters outside the surveyors' jurisdiction

WHEN REVIEWING DISPUTES, IDENTIFY:
- Surface issue: what is being argued on the face of it.
- Underlying issue: what is really driving the dispute.
- Strongest point: the most persuasive point or risk.
- Weakest point: the least persuasive or most overreaching point.
- Missing information: facts needed before a conclusion can be reached.
- Jurisdiction: whether it falls within the Act, the Award, surveyor jurisdiction or outside them.
- Strategy: what Itzik should actually be worried about before drafting.

DEFAULT DISCUSSION STRUCTURE:
For uploaded correspondence or selected email threads, start with concise analysis. Use headings only when useful, such as Initial observations, What stands out, Strongest point, Weakest point, Missing information and Before drafting. Do not use markdown decoration or make the response look like a report.
`;

function normaliseProject(project = {}) {
  if (!project) return null;

  return {
    id: project.id,
    ref: project.ref || project.reference || '',
    name: project.name || project.title || '',
    role: project.role || project.appointment_role || project.surveyor_role || '',
    status: project.status || '',
    works: project.works || project.description || project.scope || '',
    address: firstNonEmpty(project.address, project.bo_premise_address, project.premise_address, project.site_address),
    bo: {
      name: firstNonEmpty(project.bo, project.bo_name, project.bo_1_name, project.building_owner_name),
      name2: firstNonEmpty(project.bo_2_name, project.building_owner_2_name),
      email: firstNonEmpty(project.bo_email, project.bo_1_email, project.building_owner_email),
      phone: firstNonEmpty(project.bo_phone, project.bo_1_phone),
      premise: firstNonEmpty(project.bo_premise_address, project.address, project.premise_address),
      service_address: firstNonEmpty(project.bo_service_address, project.bo_1_service_address, project.bo_address),
    },
    ao_from_project: {
      name: firstNonEmpty(project.ao, project.ao_name, project.ao_1_name, project.adjoining_owner_name),
      name2: firstNonEmpty(project.ao_2_name, project.adjoining_owner_2_name),
      email: firstNonEmpty(project.ao_email, project.ao_1_email, project.adjoining_owner_email),
      phone: firstNonEmpty(project.ao_phone, project.ao_1_phone),
      premise: firstNonEmpty(project.ao_premise_address, project.ao_address, project.adjoining_owner_address),
      service_address: firstNonEmpty(project.ao_service_address, project.ao_1_service_address),
    },
  };
}

function normaliseEmailRecord(email = {}) {
  if (!email) return null;

  const body = firstNonEmpty(
    email.body_text,
    email.text_body,
    email.body,
    email.html_body,
    email.body_html,
    email.content,
    email.preview,
    email.body_preview,
    email.snippet
  );

  return {
    id: firstNonEmpty(email.id, email.email_id, email.message_id, email.external_id, email.outlook_id, email.internet_message_id),
    thread_id: firstNonEmpty(email.thread_id, email.conversation_id, email.conversationId, email.graph_conversation_id, email.internet_thread_id),
    project_id: firstNonEmpty(email.project_id, email.projectId),
    folder: firstNonEmpty(email.folder, email.mail_folder, email.direction),
    from: firstNonEmpty(email.from, email.from_name, email.sender_name, email.from_email, email.sender_email, email.email_from),
    from_email: firstNonEmpty(email.from_email, email.sender_email, email.email_from),
    to: email.to || email.to_email || email.recipients || email.to_recipients || '',
    cc: email.cc || email.cc_email || email.cc_recipients || '',
    subject: firstNonEmpty(email.subject, email.title),
    date: firstNonEmpty(email.received_at, email.sent_at, email.date, email.created_at, email.updated_at),
    body: stripHtml(body).slice(0, 1000),
  };
}

function buildSuppliedEmailContext(body = {}) {
  const supplied = body.emailContext || body.context?.selectedEmailContext || null;
  if (!supplied) return null;

  return normaliseEmailRecord({
    ...supplied,
    id: firstNonEmpty(supplied.id, supplied.emailId, body.emailId),
    thread_id: firstNonEmpty(supplied.threadId, supplied.thread_id, supplied.conversationId, body.threadId),
    project_id: firstNonEmpty(supplied.projectId, supplied.project_id, body.projectId, body.project_id),
  });
}

async function safeSelect(table, select, buildQuery) {
  const sb = getSupabase();
  if (!sb) return [];

  try {
    let query = sb.from(table).select(select);
    query = buildQuery ? buildQuery(query) : query;
    const { data, error } = await query;
    if (error) {
      console.warn(`[ely-smart] ${table} select skipped:`, error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn(`[ely-smart] ${table} select failed:`, err.message);
    return [];
  }
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
    .select('*')
    .or([
      `name.ilike.%${search}%`,
      `ref.ilike.%${search}%`,
      `address.ilike.%${search}%`,
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

async function loadProjectBundle(projectId) {
  const sb = getSupabase();
  if (!sb || !projectId) return null;

  const { data: project, error } = await sb
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .maybeSingle();

  if (error) {
    console.warn('[ely-smart] full project load failed:', error.message);
  }

  const adjoiningOwners = await safeSelect('adjoining_owners', '*', q =>
    q.eq('project_id', projectId).limit(20)
  );

  const legacyAos = adjoiningOwners.length ? [] : await safeSelect('aos', '*', q =>
    q.eq('project_id', projectId).limit(20)
  );

  const notices = await safeSelect('notices', '*', q =>
    q.eq('project_id', projectId).order('created_at', { ascending: false }).limit(20)
  );

  const documents = await safeSelect('documents', 'id, project_id, title, name, file_name, category, section_type, created_at, updated_at, metadata', q =>
    q.eq('project_id', projectId).order('created_at', { ascending: false }).limit(30)
  );

  const projectMemory = await safeSelect('project_memory', '*', q =>
    q.eq('project_id', projectId).order('created_at', { ascending: false }).limit(30)
  );

  // Load SOC reports for this project (all AOs)
  const socReports = await safeSelect(
    'soc_reports',
    'id, ao_id, ao_names, ao_address, bo_address, inspection_date, raw_notes, structured_data, proposed_works, status, created_at',
    q => q.eq('project_id', projectId).order('created_at', { ascending: false }).limit(10)
  );

  return {
    project_raw: project || null,
    project: normaliseProject(project || {}),
    adjoining_owners: adjoiningOwners.length ? adjoiningOwners : legacyAos,
    notices,
    documents,
    project_memory: projectMemory,
    soc_reports: socReports,
  };
}

function wantsEmailContext(prompt = '', projectId = null, suppliedEmailContext = null, threadId = null, emailId = null) {
  if (suppliedEmailContext || threadId || emailId) return true;
  const lower = String(prompt || '').toLowerCase();
  return lower.includes('email') || lower.includes('thread') || lower.includes('inbox') || lower.includes('reply') || lower.includes('correspondence') || lower.includes('letter') || lower.includes('wrote') || lower.includes('received');
}

async function buildScopedEmailContext({ prompt, projectId, emailContext = null, threadId = null, emailId = null }) {
  const sb = getSupabase();
  const suppliedEmail = emailContext ? normaliseEmailRecord(emailContext) : null;

  if (!sb && suppliedEmail) return [suppliedEmail];
  if (!sb || !wantsEmailContext(prompt, projectId, suppliedEmail, threadId, emailId)) return suppliedEmail ? [suppliedEmail] : [];

  const directThreadId = firstNonEmpty(threadId, suppliedEmail?.thread_id);
  const directEmailId = firstNonEmpty(emailId, suppliedEmail?.id);

  if (directThreadId) {
    try {
      let threadQuery = sb
        .from('emails')
        .select('*')
        .eq('thread_id', directThreadId)
        .order('received_at', { ascending: true })
        .limit(80);

      if (projectId) threadQuery = threadQuery.eq('project_id', projectId);

      const { data, error } = await threadQuery;
      if (!error && data?.length) {
        const rows = data.map(normaliseEmailRecord).filter(Boolean);
        if (suppliedEmail && !rows.some(row => String(row.id) === String(suppliedEmail.id))) rows.push(suppliedEmail);
        return rows;
      }
    } catch (err) {
      console.warn('[ely-smart] direct thread context skipped:', err.message);
    }
  }

  if (directEmailId) {
    try {
      const { data, error } = await sb
        .from('emails')
        .select('*')
        .eq('id', directEmailId)
        .limit(1);

      if (!error && data?.length) return data.map(normaliseEmailRecord).filter(Boolean);
    } catch (err) {
      console.warn('[ely-smart] direct email context skipped:', err.message);
    }
  }

  let query = sb
    .from('emails')
    .select('*')
    .order('received_at', { ascending: false });

  if (projectId) {
    query = query.eq('project_id', projectId).limit(10);
  } else {
    query = query.in('folder', ['Inbox', 'Sent Items']).limit(20);
  }

  const { data, error } = await query;

  if (error) {
    console.warn('[ely-smart] email context error:', error.message);
    return suppliedEmail ? [suppliedEmail] : [];
  }

  const emails = (data || []).map(normaliseEmailRecord).filter(Boolean);
  if (suppliedEmail && !emails.some(row => String(row.id) === String(suppliedEmail.id))) emails.unshift(suppliedEmail);
  return emails;
}

function looksLikeDictation(prompt = '') {
  const p = String(prompt || '').trim();

  // Classic greeting-led dictation
  if (/^(dear|hi|hello|good morning|good afternoon|thank you for your email|thanks for your email|further to|following our|i refer to|i write|i am writing|please find|with reference to|just to confirm|just to let you know|as discussed|as agreed|following up|i wanted to|i would like to|please note|please be advised|we write|we refer|we are writing|we confirm|we note)[\s,]/i.test(p)) return true;

  // User giving direction to write or change something
  if (/^(tell them|let them know|say that|write to|respond to|reply to|send an email|draft something|i need to say|i want to say|i need to tell|can you write|can you draft|just say|basically say|change it to|change the|update it to|update the|amend it|amend the|replace|remove the|take out|add in|add to|insert)/i.test(p)) return true;

  // Long prompt with no analysis trigger — treat as a drafting brief
  const hasAnalysisTrigger = /(what do you think|can he do that|is that right|is that a breach|talk me through|let's discuss|am i missing|what's your view|what's his angle|why is he saying|how would a|chat through|help me form|not looking for a draft)/i.test(p);
  const wordCount = p.split(/\s+/).filter(Boolean).length;
  if (wordCount > 20 && !hasAnalysisTrigger) return true;

  return false;
}

function hasExplicitDraftRequest(prompt = '') {
  const p = String(prompt || '').toLowerCase();

  if (looksLikeDictation(prompt)) return true;

  return (
    p.includes('draft this') ||
    p.includes('draft a') ||
    p.includes('draft an') ||
    p.includes('draft the') ||
    p.includes("let's draft") ||
    p.includes('lets draft') ||
    p.includes('write an email') ||
    p.includes('write a letter') ||
    p.includes('write to') ||
    p.includes('prepare an email') ||
    p.includes('prepare a letter') ||
    p.includes('compose an email') ||
    p.includes('compose a letter') ||
    p.includes('draft a response') ||
    p.includes('draft a reply') ||
    p.includes('reply saying') ||
    p.includes('respond saying') ||
    p.includes('respond by saying') ||
    p.includes('send this') ||
    p.includes('create the email')
  );
}

function inferModeHint(surface, prompt = '', body = {}) {
  const explicitMode = String(body.mode || body.workflowStage || '').toLowerCase();

  if (explicitMode.includes('email_thread_summary') || explicitMode.includes('summary')) return 'email_summary';

  if (hasExplicitDraftRequest(prompt)) return 'draft';

  if (String(prompt || '').toLowerCase().includes('review') || String(prompt || '').toLowerCase().includes('compare')) return 'review';

  if (surface === 'email_composer' && (body.emailContext || body.emailId || body.threadId)) return 'email_summary';

  if ((explicitMode.includes('collaborative_reply') || explicitMode.includes('draft')) && !String(prompt || '').trim()) return 'email_summary';

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
    console.warn('[ely-smart] brain load failed:', error.message);
    return null;
  }

  return data || null;
}

function buildProjectFactsText(projectBundle) {
  if (!projectBundle) return '';

  const facts = [];
  const p = projectBundle.project || {};

  if (p.id) facts.push(`Project ID: ${p.id}`);
  if (p.ref) facts.push(`Reference: ${p.ref}`);
  if (p.address) facts.push(`Project address: ${p.address}`);
  if (p.bo?.name) facts.push(`Building Owner: ${[p.bo.name, p.bo.name2].filter(Boolean).join(' and ')}`);
  if (p.bo?.premise) facts.push(`Building Owner premise: ${p.bo.premise}`);
  if (p.ao_from_project?.name) facts.push(`Adjoining Owner from project record: ${[p.ao_from_project.name, p.ao_from_project.name2].filter(Boolean).join(' and ')}`);

  const aos = projectBundle.adjoining_owners || [];
  if (aos.length) {
    facts.push('Adjoining Owners loaded from structured records:');
    aos.slice(0, 12).forEach((ao, i) => {
      const name = [ao.name, ao.name2].filter(Boolean).join(' and ') || ao.owner_name || ao.ao_name || `AO ${i + 1}`;
      const address = ao.premise || ao.reg_addr || ao.address || ao.ao_premise_address || '';
      const email = ao.email || ao.ao_email || '';
      const surveyor = ao.surv_name || ao.surveyor_name || ao.surveyorName || '';
      facts.push(`${i + 1}. ${name}${address ? `, ${address}` : ''}${email ? `, ${email}` : ''}${surveyor ? `, surveyor: ${surveyor}` : ''}`);
    });
  }

  return facts.join('\n');
}

// Strip signatures, legal disclaimers, and repeated boilerplate from email bodies
function cleanEmailBody(text = '') {
  if (!text) return '';
  const lines = text.split('\n');
  const cleaned = [];
  for (const line of lines) {
    const l = line.trim();
    // Stop at signature / disclaimer markers
    if (/^(kind regards|regards|many thanks|thanks|best regards|yours sincerely|yours faithfully)/i.test(l)) break;
    if (/delva patman|limited liability partnership|registered in england|confidential and may be legally privileged|if you are not the intended recipient/i.test(l)) break;
    if (/^from:\s+/i.test(l) && cleaned.length > 3) break; // stop at quoted reply chain
    cleaned.push(line);
  }
  return cleaned.join('\n').trim().slice(0, 800);
}

function buildEmailContextText({ body = {}, scopedEmailContext = [] }) {
  const supplied = buildSuppliedEmailContext(body);
  const emails = [];

  if (supplied) emails.push(supplied);
  (scopedEmailContext || []).forEach(email => {
    const normalised = normaliseEmailRecord(email);
    if (!normalised) return;
    const key = normalised.id || `${normalised.thread_id}-${normalised.date}-${normalised.subject}`;
    if (!emails.some(existing => (existing.id || `${existing.thread_id}-${existing.date}-${existing.subject}`) === key)) emails.push(normalised);
  });

  if (!emails.length) return '';

  const selected = emails[0];
  const thread = emails.slice(0, 20);

  return `
ACTIVE SELECTED EMAIL CONTEXT:
The user is discussing, analysing, drafting or preparing a response in relation to the selected email/thread below. Treat this email/thread as primary context. Do not ignore it. Do not answer generically if this context is present.

Selected email:
From: ${selected.from || ''}
From email: ${selected.from_email || ''}
To: ${Array.isArray(selected.to) ? selected.to.join(', ') : selected.to || ''}
Cc: ${Array.isArray(selected.cc) ? selected.cc.join(', ') : selected.cc || ''}
Subject: ${selected.subject || ''}
Date: ${selected.date || ''}
Thread ID: ${selected.thread_id || ''}
Email ID: ${selected.id || ''}

Selected email body:
${cleanEmailBody(selected.body || '')}

Available thread context (${thread.length} message${thread.length === 1 ? '' : 's'}):
${thread.map((email, index) => `
Message ${index + 1}
From: ${email.from || ''}
Subject: ${email.subject || ''}
Date: ${email.date || ''}
Body:
${cleanEmailBody(email.body || '')}
`).join('\n')}
`.trim().slice(0, 8000);
}

function buildSystemPrompt({ brain, projectId, resolvedProject, projectBundle, scopedEmailContext, modeHint, draftingExamples = [] }) {
  let prompt = brain?.instruction_set?.system_prompt || 'You are Ely, an AI assistant for a Party Wall surveying practice. Always use British English spelling and terminology.';

  prompt += `

${GLOBAL_AI_STANDARD}
`;

  if (modeHint === 'email_summary') {
    prompt += `

ACTIVE MODE: email_thread_summary

YOUR TASK:
You are reading an email thread on behalf of Itzik Darel / Square One Consulting. Produce a clean, focused summary and strategic first view. Do not draft correspondence.

Structure your response in plain text like this:

From:
[sender name and firm]

Latest email is asking for:
[concise points from the latest email]

Context from the thread:
[relevant earlier history, changes of position, pattern or narrative]

What stands out:
[the issue beneath the surface, including whether the points appear to be Award matters, Act matters, damage claims, neighbour disputes or outside jurisdiction]

Suggested approach:
[1 to 3 plain sentences on what to think through before drafting]

RULES:
- Do not focus only on the latest email if earlier messages change the meaning.
- Do not invent anything not stated in the emails.
- Do not produce a full draft at this stage.
- Do not use markdown, asterisks, hashtags or bold text.
- Treat Square One Consulting, Itzik and help@sq1consulting.co.uk as us.
`;
  } else {
    prompt += `

ACTIVE MODE:
${modeHint || 'discuss'}

HARD RUNTIME RULES:
Project facts loaded below are authoritative. Use the party names, addresses and roles from the project facts before asking the user for them.
If a project is active, answer from the active project context first.
Never invent party names, meetings, inspections, instructions or actions.
Do not fixate on one issue. Before responding, consider the legal, procedural, evidential, engineering, strategic, practical and correspondence angles, then answer naturally.
In discussion mode, do not draft correspondence unless explicitly asked.
In review mode, review and analyse before suggesting changes. Do not rewrite unless explicitly asked.
In drafting mode, produce natural professional correspondence, not reports, templates, educational notes or explanatory guides.

EMAIL CONTEXT RULE:
If selected email context is provided, it is authoritative. Read the whole available thread before responding. For Draft With Ely and email composer workflows, do not assume the user wants an email drafted simply because the selected context is an email. If the user prompt is blank, summarise the selected email/thread and suggest the response strategy. If the user asks to talk it through, analyse. Draft only when the user clearly asks for drafting.

When drafting emails or letters, never use hashtags, markdown headings, asterisks, bold formatting, consultant formatting, horizontal separators, excessive bullet points or long dashes.
When drafting emails or letters, use ordinary paragraphs and natural human structure. Numbered points are allowed only when the subject matter genuinely requires numbered options or steps.
The finished draft must look like a real manually written professional email or letter, not ChatGPT output.
Refer to the legislation as the Act.
Treat Square One Consulting, Itzik, outgoing emails from help@sq1consulting.co.uk, I and we as Itzik/Square One unless context clearly says otherwise.
`;
  }

  prompt += `

PROJECT ID:
${projectId || 'none'}
`;

  const projectFacts = buildProjectFactsText(projectBundle);
  if (projectFacts) prompt += `

AUTHORITATIVE PROJECT FACTS:
${projectFacts}
`;

  if (projectBundle) {
    prompt += `

PROJECT BUNDLE:
${compactJson(projectBundle, 14000)}
`;
  } else if (resolvedProject) {
    prompt += `

RESOLVED PROJECT:
${compactJson(resolvedProject)}
`;
  }

  // Inject SOC reports if available
  const socReports = projectBundle?.soc_reports || [];
  if (socReports.length > 0) {
    const aoCount = (projectBundle?.adjoining_owners || []).length || 1;

    let socBlock = `

SCHEDULE OF CONDITION REPORTS (${socReports.length} report${socReports.length > 1 ? 's' : ''}):
`;

    if (aoCount > 1 || socReports.length > 1) {
      socBlock += `This project has multiple adjoining owners. There is a separate Schedule of Condition for each AO.
`;
      socBlock += `When the user refers to a schedule of conditions, ask which adjoining owner they mean if it is not clear from context.
`;
      socBlock += `Match by AO name or address — do not mix up observations from different AOs.

`;
    }

    socReports.forEach((soc, i) => {
      const aoLabel = soc.ao_names || soc.ao_address || `AO ${i + 1}`;
      socBlock += `--- SOC ${i + 1}: ${aoLabel} ---
`;
      socBlock += `Adjoining Owner: ${soc.ao_names || 'Unknown'}
`;
      socBlock += `AO Property: ${soc.ao_address || 'Unknown'}
`;
      socBlock += `Inspection Date: ${soc.inspection_date || 'Unknown'}
`;
      socBlock += `Status: ${soc.status || 'draft'}
`;

      if (soc.raw_notes) {
        socBlock += `
Raw Dictated Notes:
${soc.raw_notes.slice(0, 4000)}
`;
      }

      if (soc.structured_data) {
        const sd = typeof soc.structured_data === 'string' ? JSON.parse(soc.structured_data) : soc.structured_data;

        // Sections / observations
        if (sd.sections?.length) {
          socBlock += `
Condition Observations by Section:
`;
          sd.sections.forEach(sec => {
            socBlock += `  ${sec.title || 'Section'}:
`;
            (sec.rows || []).forEach(row => {
              socBlock += `    - [${row.ref || ''}] ${row.observation || ''}
`;
            });
          });
        }

        // Award notes
        if (sd.award_notes?.length) {
          socBlock += `
Award Notes (matters for the Party Wall Award):
`;
          sd.award_notes.forEach(n => {
            socBlock += `  [${n.topic || 'note'}] ${n.description || ''}
`;
          });
        }

        // Actions
        if (sd.actions?.length) {
          socBlock += `
Actions Required:
`;
          sd.actions.forEach(a => {
            socBlock += `  [${a.party || ''}] ${a.description || ''}
`;
          });
        }

        // Emails required
        if (sd.emails_required?.length) {
          socBlock += `
Emails Required:
`;
          sd.emails_required.forEach(e => {
            socBlock += `  To: ${e.recipient_type || ''} — ${e.subject || ''}: ${e.reason || ''}
`;
          });
        }
      }

      socBlock += `
`;
    });

    prompt += socBlock;
  }

  if (scopedEmailContext?.length) {
    prompt += `

SCOPED EMAIL CONTEXT:
${compactJson(scopedEmailContext.slice(0, 40), 12000)}
`;
  }

  if (draftingExamples?.length && modeHint === 'draft') {
    prompt += `

GOLD STANDARD DRAFTING EXAMPLES:
${JSON.stringify(draftingExamples, null, 2)}
`;
  }

  return prompt;
}

function buildMessages({ body, systemPrompt, scopedEmailContext = [] }) {
  const { prompt, chatHistory = [], brainContext = [] } = body;
  const messages = [{ role: 'system', content: systemPrompt }];

  const emailContextText = buildEmailContextText({ body, scopedEmailContext });
  if (emailContextText) messages.push({ role: 'system', content: emailContextText });

  // Inject project brain — persistent memory from previous sessions
  // Cap at ~4000 chars per entry and ~8000 chars total to stay within token budget
  const BRAIN_ENTRY_CAP = 4000;
  const BRAIN_TOTAL_CAP = 8000;

  if (brainContext?.length) {
    const summaryEntry = brainContext.find(m => m.is_summary);
    const regularEntries = brainContext.filter(m => !m.is_summary);

    let brainText = '';

    if (summaryEntry) {
      const summaryTrimmed = String(summaryEntry.content || '').slice(0, BRAIN_ENTRY_CAP);
      brainText += `SUMMARY OF EARLIER PROJECT HISTORY:\n${summaryTrimmed}\n\nRECENT ENTRIES:\n`;
    }

    brainText += regularEntries.map(m => {
      const label = m.role === 'user' ? 'Surveyor' :
        m.content_type === 'email_received' ? 'Received email' :
        m.content_type === 'email_sent' ? 'Sent email' : 'Ely';
      const prefix = m.content_type === 'upload' ? `[Uploaded: ${m.file_name || 'file'}] ` : '';
      const date = m.created_at ? new Date(m.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      const content = String(m.content || '').slice(0, BRAIN_ENTRY_CAP);
      return `${label}${date ? ` (${date})` : ''}: ${prefix}${content}`;
    }).join('\n\n');

    // Hard cap total brain text
    const brainTextFinal = brainText.slice(0, BRAIN_TOTAL_CAP);

    if (brainTextFinal.trim()) {
      messages.push({
        role: 'system',
        content: `PROJECT BRAIN — persistent memory for this project (use this to answer questions about status, timeline, correspondence history):\n\n${brainTextFinal}`,
      });
    }
  }

  if (chatHistory?.length) {
    chatHistory.slice(-24).forEach((msg) => {
      if (msg?.role === 'user' || msg?.role === 'assistant') messages.push({ role: msg.role, content: String(msg.content || '') });
    });
  }

  if (prompt?.trim()) {
    messages.push({ role: 'user', content: prompt.trim() });
  } else if (emailContextText) {
    const mode = String(body.mode || body.workflowStage || '').toLowerCase();
    const instruction = mode.includes('email_thread_summary') || mode.includes('summary')
      ? 'Read the selected email/thread above and summarise what it is asking for. Then identify the wider context, the real issue, and the most sensible response strategy. Do not draft.'
      : 'Read the selected email/thread above. Start by analysing and discussing the issue, the wider context, the real risk, missing information and response strategy. Do not draft unless the user explicitly asks for a draft.';
    messages.push({ role: 'user', content: instruction });
  }

  return messages;
}

// ── Full-text email search ─────────────────────────────────────────────────
// Called when GPT-4o detects a specific email lookup request
async function searchProjectEmails({ projectId, query, sender, limit = 5 }) {
  const sb = getSupabase();
  if (!sb || !projectId) return [];

  try {
    // Build base query
    let q = sb
      .from('emails')
      .select('id, subject, from_address, from_name, received_at, body_text, folder')
      .eq('project_id', projectId)
      .order('received_at', { ascending: false })
      .limit(limit);

    // Filter by sender if provided
    if (sender) {
      q = q.or(`from_address.ilike.%${sender}%,from_name.ilike.%${sender}%`);
    }

    // Full-text search on subject + body if query provided
    if (query) {
      q = q.textSearch('fts', query, { type: 'plain', config: 'english' });
    }

    const { data, error } = await q;
    if (error) {
      // Fallback: ilike search if fts column not available
      let fallback = sb
        .from('emails')
        .select('id, subject, from_address, from_name, received_at, body_text, folder')
        .eq('project_id', projectId)
        .order('received_at', { ascending: false })
        .limit(limit);

      if (sender) fallback = fallback.or(`from_address.ilike.%${sender}%,from_name.ilike.%${sender}%`);
      if (query) fallback = fallback.or(`subject.ilike.%${query}%,body_text.ilike.%${query}%`);

      const { data: fbData } = await fallback;
      return (fbData || []).map(normaliseEmailRecord).filter(Boolean);
    }

    return (data || []).map(normaliseEmailRecord).filter(Boolean);
  } catch (err) {
    console.warn('[ely-smart] searchProjectEmails error:', err.message);
    return [];
  }
}

// ── Case review detection ─────────────────────────────────────────────────
function detectsCaseReview(prompt = '') {
  const lower = prompt.toLowerCase();
  return lower.includes('case review') || lower.includes('full review') || lower.includes('full case');
}

function needsProjectContext(prompt = '') {
  const lower = String(prompt || '').toLowerCase();
  return lower.includes('notice') || lower.includes('award') || lower.includes('adjoining owner') ||
    lower.includes('building owner') || lower.includes('surveyor') || lower.includes('party wall') ||
    lower.includes('project') || lower.includes('fee') || lower.includes('schedule') ||
    lower.includes('soc') || lower.includes('who is') || lower.includes('what is the') ||
    lower.includes('address') || lower.includes('owner') || lower.includes('ref');
}

// ── Claude case review ────────────────────────────────────────────────────
async function runCaseReview({ projectId, topic, projectBundle }) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

  const sb = getSupabase();

  // Load ALL emails for this project — no limit
  let allEmails = [];
  if (sb && projectId) {
    try {
      const { data } = await sb
        .from('emails')
        .select('subject, from_address, from_name, received_at, body_text, folder')
        .eq('project_id', projectId)
        .order('received_at', { ascending: true });
      allEmails = (data || []).map(e => ({
        date: e.received_at ? new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
        direction: (e.folder || '').toLowerCase().includes('sent') ? 'Sent' : 'Received',
        from: e.from_name || e.from_address || '',
        subject: e.subject || '',
        body: (e.body_text || '').slice(0, 3000), // generous per-email cap for Claude
      }));
    } catch (err) {
      console.warn('[ely-smart] case review email load error:', err.message);
    }
  }

  // Load all brain entries — no limit
  let allBrain = [];
  if (sb && projectId) {
    try {
      const { data } = await sb
        .from('project_brain')
        .select('role, content, content_type, created_at, file_name')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      allBrain = (data || []).map(m => ({
        date: m.created_at ? new Date(m.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
        type: m.content_type || m.role || 'note',
        content: (m.content || '').slice(0, 2000),
      }));
    } catch (err) {
      console.warn('[ely-smart] case review brain load error:', err.message);
    }
  }

  const emailsText = allEmails.length
    ? allEmails.map(e => `[${e.date}] ${e.direction} — From: ${e.from}\nSubject: ${e.subject}\n${e.body}`).join('\n\n---\n\n')
    : 'No emails found.';

  const brainText = allBrain.length
    ? allBrain.map(m => `[${m.date}] ${m.type}: ${m.content}`).join('\n\n')
    : 'No notes or chat history found.';

  const projectAddress = projectBundle?.project_raw?.bo_premise_address || projectBundle?.project_raw?.address || '';

  const prompt = `You are assisting a party wall surveyor called Itzik (Square One Consulting) with a case review.

Project: ${projectAddress}
Topic to investigate: ${topic}

Your task:
1. Read ALL the correspondence and notes below chronologically
2. Build a structured timeline of key events relevant to the topic
3. Identify patterns — delays, contradictions, jurisdictional overreach, billing anomalies, position changes
4. Extract verbatim quotes from emails that are most relevant — include the date, sender, and exact words
5. Summarise the strongest arguments Itzik can make based on the evidence
6. Flag anything that weakens Itzik's position so he is prepared

Be thorough. This is for use in a professional dispute. Accuracy and evidence matter.

--- ALL EMAILS (chronological) ---
${emailsText}

--- PROJECT NOTES & CHAT HISTORY ---
${brainText}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 8000,
      system: 'You are an expert party wall surveyor assistant helping build evidence-based case files. Be precise, factual, and thorough. Use British English.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Claude case review failed');

  return payload.content?.[0]?.text || 'No findings returned.';
}

// ── Claude fallback for oversized requests ────────────────────────────────
async function callClaude(messages = []) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

  // Convert OpenAI message format to Anthropic format
  const systemMsg = messages.find(m => m.role === 'system')?.content || 'You are Ely, an AI assistant for a Party Wall surveying practice. Use British English.';
  const userMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  // Prepend the handoff message as a system note
  const systemWithHandoff = `You are Ely, an AI assistant for a Party Wall surveying practice. Use British English.\n\n${systemMsg}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 3500,
      system: systemWithHandoff,
      messages: userMessages.length ? userMessages : [{ role: 'user', content: 'Please help.' }],
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Claude fallback failed');

  const raw = payload.content?.[0]?.text || '';
  return cleanOutput(`*This is a bit too large for me — let me get our admin team on that for you right away.* 📋\n\n${raw}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!OPENAI_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });

  try {
    const body = req.body || {};
    let projectId = inferProjectId(body);

    const resolvedProject = !projectId ? await resolveProjectFromPrompt(body.prompt) : null;
    if (resolvedProject?.id) projectId = resolvedProject.id;

    const userId = inferUserId(body);
    const modeHint = inferModeHint(body.surface, body.prompt, body);
    const prompt = String(body.prompt || '').trim();

    // ── Case review confirmation ──────────────────────────────────────────
    // If user has already confirmed a case review (flagged by frontend)
    if (body.case_review_confirmed && body.case_review_topic && projectId) {
      const projectBundle = await loadProjectBundle(projectId);

      // Tell GPT-4o to acknowledge the handoff first
      const handoffMsg = `Perfect — leave it with me. I'm passing this to our research department now. They're very thorough and will go through everything on this project. Back with you shortly. 🔍`;

      // Run Claude case review
      let findings;
      try {
        findings = await runCaseReview({ projectId, topic: body.case_review_topic, projectBundle });
      } catch (err) {
        findings = `Case review encountered an error: ${err.message}`;
      }

      // Return findings to GPT-4o to present
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 3500,
          temperature: 0.3,
          messages: [
            { role: 'system', content: 'You are Ely, a party wall surveyor assistant. Present the case review findings clearly and offer to discuss specific aspects or help draft a response.' },
            { role: 'user', content: `Here are Claude\'s findings from the full case review on "${body.case_review_topic}":\n\n${findings}\n\nPresent these findings to the surveyor clearly. Offer to help them work with any part of it — drafting arguments, letters, or further analysis.` },
          ],
        }),
      });

      const data = await response.json();
      const reply = cleanOutput(data.choices?.[0]?.message?.content || findings);

      return res.status(200).json({
        reply,
        case_review: true,
        resolvedProject,
      });
    }

    // ── Case review detection — ask clarifying question ───────────────────
    if (detectsCaseReview(prompt) && projectId) {
      return res.status(200).json({
        reply: `Ooh, a case review — now we're talking. 🕵️\n\nBefore I get the research department involved: are you looking to review a specific email or document, or do you want a full case file review across all correspondence, emails, notes and chat history on this project?\n\nIf it's the full works, tell me what you want me to focus on and I'll get them on it straight away.`,
        case_review_prompt: true,
        project_id: projectId,
      });
    }

    // ── Email search tool ─────────────────────────────────────────────────
    // If GPT-4o needs to find a specific email, handle it here
    if (body.email_search && projectId) {
      const results = await searchProjectEmails({
        projectId,
        query: body.email_search.query || '',
        sender: body.email_search.sender || '',
        limit: body.email_search.limit || 5,
      });

      return res.status(200).json({
        email_search_results: results,
        count: results.length,
      });
    }

    console.log('[ely-smart] DEBUG body.mode=', body.mode, 'body.workflowStage=', body.workflowStage, 'modeHint=', modeHint);
    const suppliedEmailContext = buildSuppliedEmailContext(body);

    // ── General inbox search for main chat ────────────────────────────────
    // When user asks about appointments, meetings, or specific people in main
    // chat with no email selected — search inbox automatically, no linking needed
    let generalInboxResults = [];
    const isMainChat = body.surface === 'main_chat';
    const asksAboutInbox = isMainChat && !suppliedEmailContext && !body.emailId && !body.threadId && (
      /appointment|meeting|booked|confirmed|friday|monday|tuesday|wednesday|thursday|saturday|sunday|this week|next week|schedule|diary|calendar|check my email|search my email|have i.*email|did i.*email|who (is|are|did|confirmed|booked|sent)|any.*appointment|any.*meeting/i.test(prompt)
    );

    if (asksAboutInbox) {
      try {
        const sb = getSupabase();
        if (sb) {
          // Extract specific day and topic keywords from the prompt
          const dayMatch = prompt.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|this week|next week)\b/i);
          const topicMatch = prompt.match(/\b(appointment|meeting|inspection|soc|survey|visit|site|confirmed)\b/i);

          const dayTerm = dayMatch ? dayMatch[0].toLowerCase() : '';
          const topicTerm = topicMatch ? topicMatch[0].toLowerCase() : 'appointment';
          const searchTerm = dayTerm || topicTerm;

          const { data } = await sb
            .from('emails')
            .select('subject, from_name, from_address, received_at, body_text, folder')
            .or(`subject.ilike.%${searchTerm}%,body_text.ilike.%${searchTerm}%`)
            .order('received_at', { ascending: false })
            .limit(8);

          generalInboxResults = (data || []).map(e => ({
            from: e.from_name || e.from_address || '',
            subject: e.subject || '',
            date: e.received_at ? new Date(e.received_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }) : '',
            body: cleanEmailBody(e.body_text || '').slice(0, 400),
          }));
        }
      } catch (err) {
        console.warn('[ely-smart] general inbox search failed:', err.message);
      }
    }

    // ── On-demand loading — fetch only what this request actually needs ──
    // Never load everything on every call. Fetch each piece only if relevant.

    const hasSuppliedEmail = !!suppliedEmailContext || !!body.threadId || !!body.emailId;
    const needsEmails = hasSuppliedEmail || wantsEmailContext(prompt, projectId, suppliedEmailContext, body.threadId, body.emailId);
    const needsProject = needsProjectContext(prompt);
    const needsBrain = !!projectId; // always load brain summary if in a project — but keep it short

    const [projectBundle, scopedEmailContext, brain] = await Promise.all([
      needsProject ? loadProjectBundle(projectId) : Promise.resolve(null),
      needsEmails ? buildScopedEmailContext({
        prompt: body.prompt,
        projectId,
        emailContext: suppliedEmailContext,
        threadId: body.threadId || body.emailContext?.threadId || body.emailContext?.thread_id,
        emailId: body.emailId || body.emailContext?.emailId || body.emailContext?.id,
      }) : Promise.resolve(suppliedEmailContext ? [suppliedEmailContext] : []),
      needsBrain ? loadBrain({ userId, projectId, surface: body.surface, modeHint }) : Promise.resolve(null),
    ]);

    let draftingExamples = [];

    try {
      const { data } = await getSupabase()
        .from('ai_drafting_examples')
        .select('*')
        .eq('active', true)
        .limit(3);

      draftingExamples = data || [];
    } catch (err) {
      console.warn('[ely-smart] drafting examples load failed:', err.message);
    }

    const systemPrompt = buildSystemPrompt({
      brain,
      projectId,
      resolvedProject,
      projectBundle,
      scopedEmailContext,
      modeHint,
      draftingExamples,
    });

    const messages = buildMessages({ body, systemPrompt, scopedEmailContext });

    // Inject general inbox search results if we ran one
    if (generalInboxResults.length > 0) {
      const inboxText = generalInboxResults.map(e =>
        `From: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\n${e.body}`
      ).join('\n\n---\n\n');
      messages.splice(1, 0, {
        role: 'system',
        content: `INBOX SEARCH RESULTS — emails matching the user's query:\n\n${inboxText}\n\nUse these to answer the user's question accurately. Do not guess or invent anything not shown above.`,
      });
    } else if (asksAboutInbox) {
      // No results found — tell Ely so she doesn't hallucinate
      messages.splice(1, 0, {
        role: 'system',
        content: `INBOX SEARCH: A search of the inbox was performed for this query but no matching emails were found. Tell the user honestly that you searched but couldn't find anything matching their query.`,
      });
    }

    console.log(
      `[ely-smart] project=${projectId || 'none'} emails=${scopedEmailContext?.length || 0} suppliedEmail=${suppliedEmailContext ? 'yes' : 'no'} aos=${projectBundle?.adjoining_owners?.length || 0} mode=${modeHint}`
    );

    const temperature = modeHint === 'draft' ? 0.62 : 0.35;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 3500,
        temperature,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const errMsg = err.error?.message || `OpenAI error ${response.status}`;

      // TPM limit hit — pass to Claude instead
      if (errMsg.toLowerCase().includes('tokens per min') || errMsg.toLowerCase().includes('tpm') || errMsg.includes('Request too large')) {
        console.log('[ely-smart] TPM limit hit — falling back to Claude');
        const claudeReply = await callClaude(messages);
        return res.status(200).json({
          reply: claudeReply,
          resolvedProject,
          model: 'claude',
          sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });
      }

      throw new Error(errMsg);
    }

    const data = await response.json();
    const fullReply = cleanOutput(data.choices?.[0]?.message?.content || '');

    return res.status(200).json({
      reply: fullReply,
      resolvedProject,
      scopedEmailCount: scopedEmailContext?.length || 0,
      selectedEmailContextLoaded: !!suppliedEmailContext,
      projectContextLoaded: !!projectBundle?.project_raw,
      adjoiningOwnerCount: projectBundle?.adjoining_owners?.length || 0,
      brainLoaded: !!brain,
      sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  } catch (err) {
    console.error('[ely-smart] error:', err);
    return res.status(500).json({ error: err.message });
  }
}







