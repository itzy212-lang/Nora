// api/ely-smart.js
// Ely/Nora smart route - project-hydrated collaboration version

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
    body: stripHtml(body).slice(0, 12000),
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

  return {
    project_raw: project || null,
    project: normaliseProject(project || {}),
    adjoining_owners: adjoiningOwners.length ? adjoiningOwners : legacyAos,
    notices,
    documents,
    project_memory: projectMemory,
  };
}

function wantsEmailContext(prompt = '', projectId = null, suppliedEmailContext = null, threadId = null, emailId = null) {
  if (suppliedEmailContext || threadId || emailId) return true;
  if (projectId) return true;
  const lower = String(prompt || '').toLowerCase();
  return lower.includes('email') || lower.includes('thread') || lower.includes('inbox') || lower.includes('reply');
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
    query = query.eq('project_id', projectId).limit(40);
  } else {
    query = query.in('folder', ['Inbox', 'Sent Items']).limit(100);
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

function inferModeHint(surface, prompt = '', body = {}) {
  const explicitMode = String(body.mode || body.workflowStage || '').toLowerCase();
  if (explicitMode.includes('email_thread_summary')) return 'email_summary';
  if (explicitMode.includes('collaborative_reply') || explicitMode.includes('draft')) return 'draft';

  const p = String(prompt || '').toLowerCase();
  const explicitDraft =
    p.includes('draft') ||
    p.includes('write a letter') ||
    p.includes('write an email') ||
    p.includes('prepare a letter') ||
    p.includes('prepare an email') ||
    p.includes('compose') ||
    p.includes('respond to') ||
    p.includes('reply');

  if (explicitDraft) return 'draft';
  if (p.includes('review') || p.includes('compare')) return 'review';
  if (surface === 'email_composer' && (body.emailContext || body.emailId || body.threadId)) return 'email_summary';
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
The user is drafting, discussing, or preparing a response in relation to the selected email/thread below. Treat this email/thread as primary context. Do not ignore it. Do not answer generically if this context is present.

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
${selected.body || ''}

Available thread context (${thread.length} message${thread.length === 1 ? '' : 's'}):
${thread.map((email, index) => `
Message ${index + 1}
From: ${email.from || ''}
Subject: ${email.subject || ''}
Date: ${email.date || ''}
Body:
${email.body || ''}
`).join('\n')}
`.trim();
}

function buildSystemPrompt({ brain, projectId, resolvedProject, projectBundle, scopedEmailContext, modeHint, draftingExamples = [] }) {
  // For email summary mode, bypass the brain system prompt entirely - it overrides the structure
  let prompt = modeHint === 'email_summary'
    ? 'You are Ely, an AI assistant for Itzik Darel at Square One Consulting, a Party Wall surveying practice. Always use British English spelling and terminology.'
    : (brain?.instruction_set?.system_prompt || 'You are Ely, an AI assistant for a Party Wall surveying practice. Always use British English spelling and terminology.');

  if (modeHint === 'email_summary') {
    prompt += `

ACTIVE MODE: email_thread_summary

YOUR TASK:
You are reading an email thread on behalf of Itzik Darel / Square One Consulting. Produce a clean, focused summary. Structure your response EXACTLY like this (plain text only, no markdown, no asterisks, no hashtags):

From:
[sender name and firm]

Latest email is asking for:
[bullet points - what they are specifically requesting, taken directly from the latest email]

Context from thread:
[bullet points of relevant background from earlier in the thread that affects the response - skip if not relevant]

Suggested approach:
[1-2 plain sentences on how best to respond]

RULES:
- Focus on the LATEST email first
- Keep it under 150 words total
- Do not invent anything not stated in the emails
- Do not produce a full draft at this stage
- Do not use markdown, asterisks, hashtags or bold text
- Treat Square One Consulting, Itzik, help@sq1consulting.co.uk as us
`;
  } else {
    prompt += `

ACTIVE MODE:
\${modeHint || 'discuss'}

HARD RUNTIME RULES:
Project facts loaded below are authoritative. Use the party names, addresses and roles from the project facts before asking the user for them.
If a project is active, answer from the active project context first.
Never invent party names, meetings, inspections, instructions or actions.
Do not fixate on one issue. Before responding, consider the legal, procedural, evidential, engineering, strategic, practical and correspondence angles, then answer naturally.
In discussion mode, do not draft correspondence unless explicitly asked.
In drafting mode, produce natural professional correspondence, not reports, templates, educational notes or explanatory guides.

EMAIL CONTEXT RULE:
If selected email context is provided, it is authoritative. Read it before responding. For Draft With Ely and email composer workflows, base the opening response and any draft on the selected email/thread. If the user prompt is blank, summarise the selected email/thread and ask what response they would like to send, or provide a sensible first draft if the workflow asks for one.

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
${compactJson(projectBundle, 22000)}
`;
  } else if (resolvedProject) {
    prompt += `

RESOLVED PROJECT:
${compactJson(resolvedProject)}
`;
  }

  if (scopedEmailContext?.length) {
    prompt += `

SCOPED EMAIL CONTEXT:
${compactJson(scopedEmailContext.slice(0, 40), 24000)}
`;
  }

  if (draftingExamples?.length) {
    prompt += `

GOLD STANDARD DRAFTING EXAMPLES:
${JSON.stringify(draftingExamples, null, 2)}
`;
  }

  return prompt;
}

function buildMessages({ body, systemPrompt, scopedEmailContext = [] }) {
  const { prompt, chatHistory = [] } = body;
  const messages = [{ role: 'system', content: systemPrompt }];

  const emailContextText = buildEmailContextText({ body, scopedEmailContext });
  if (emailContextText) messages.push({ role: 'system', content: emailContextText });

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
      ? 'Read the selected email/thread above and summarise what it is asking for. Then suggest the most likely response strategy in plain professional language.'
      : 'Use the selected email/thread above as the context for this email drafting workflow.';
    messages.push({ role: 'user', content: instruction });
  }

  return messages;
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
    console.log('[ely-smart] DEBUG body.mode=', body.mode, 'body.workflowStage=', body.workflowStage, 'modeHint=', modeHint);
    const suppliedEmailContext = buildSuppliedEmailContext(body);

    const [projectBundle, scopedEmailContext, brain] = await Promise.all([
      loadProjectBundle(projectId),
      buildScopedEmailContext({
        prompt: body.prompt,
        projectId,
        emailContext: suppliedEmailContext,
        threadId: body.threadId || body.emailContext?.threadId || body.emailContext?.thread_id,
        emailId: body.emailId || body.emailContext?.emailId || body.emailContext?.id,
      }),
      loadBrain({ userId, projectId, surface: body.surface, modeHint }),
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
      throw new Error(err.error?.message || `OpenAI error ${response.status}`);
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
