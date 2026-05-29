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
    .replace(/-/g, ', ')
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

function wantsEmailContext(prompt = '', projectId = null) {
  if (projectId) return true;
  const lower = String(prompt).toLowerCase();
  return lower.includes('email') || lower.includes('thread') || lower.includes('inbox');
}

async function buildScopedEmailContext({ prompt, projectId }) {
  const sb = getSupabase();
  if (!sb || !wantsEmailContext(prompt, projectId)) return [];

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
    return [];
  }

  const emails = data || [];
  const threadIds = [...new Set(emails.map(e => e.thread_id).filter(Boolean))].slice(0, 12);

  if (!projectId || threadIds.length === 0) return emails;

  try {
    const { data: threadEmails, error: threadError } = await sb
      .from('emails')
      .select('*')
      .eq('project_id', projectId)
      .in('thread_id', threadIds)
      .order('received_at', { ascending: true })
      .limit(120);

    if (!threadError && threadEmails?.length) {
      const byId = new Map();
      [...emails, ...threadEmails].forEach(e => byId.set(e.id, e));
      return Array.from(byId.values()).sort((a, b) => {
        const at = new Date(a.received_at || a.created_at || 0).getTime();
        const bt = new Date(b.received_at || b.created_at || 0).getTime();
        return bt - at;
      });
    }
  } catch (err) {
    console.warn('[ely-smart] thread expansion skipped:', err.message);
  }

  return emails;
}

function inferModeHint(surface, prompt = '') {
  const p = String(prompt || '').toLowerCase();

  const explicitDraft =
    p.includes('draft') ||
    p.includes('write a letter') ||
    p.includes('write an email') ||
    p.includes('prepare a letter') ||
    p.includes('prepare an email') ||
    p.includes('compose') ||
    p.includes('respond to');

  if (explicitDraft) return 'draft';

  if (p.includes('review') || p.includes('compare')) return 'review';

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

function buildSystemPrompt({ brain, projectId, resolvedProject, projectBundle, scopedEmailContext, modeHint, draftingExamples = [] }) {
  let prompt =
    brain?.instruction_set?.system_prompt ||
    'You are Ely, an AI assistant for a Party Wall surveying practice.';

  prompt += `

ACTIVE MODE:
${modeHint || 'discuss'}

HARD RUNTIME RULES:
Project facts loaded below are authoritative. Use the party names, addresses and roles from the project facts before asking the user for them.
If a project is active, answer from the active project context first.
Never invent party names, meetings, inspections, instructions or actions.
Do not fixate on one issue. Before responding, consider the legal, procedural, evidential, engineering, strategic, practical and correspondence angles, then answer naturally.
In discussion mode, do not draft correspondence unless explicitly asked.
In drafting mode, produce natural professional correspondence, not reports, templates, educational notes or explanatory guides.

REASONING BEFORE DRAFTING:
When drafting correspondence, do not simply convert the user's words into an email or letter. First identify the professional objective, the audience, the desired outcome, and the strongest reasonable argument supporting that outcome.
Before drafting any email, letter, message or formal response:
1. Identify what the user is trying to achieve.
2. Identify who the correspondence is being sent to and what that recipient is likely to resist or misunderstand.
3. Identify the desired practical outcome.
4. Identify the strongest reasonable argument for that outcome.
5. Identify what concerns, assumptions, implications or strategic points are present but not expressly stated.
6. Construct the reasoning before drafting the correspondence.
The finished draft should reflect the reasoning behind the position, not merely repeat the facts provided. It should explain why the proposed position is reasonable, why the requested action is justified, why any alternative approach may be premature or inadequate, and how the proposal assists fair resolution.
When appropriate, persuade rather than merely inform. Build the argument progressively. Distinguish between confirmed facts, concerns, conclusions and proposals. Anticipate likely objections without becoming defensive. Draft as an experienced professional advocate for the client's position while remaining accurate, restrained and reasonable.
For contentious correspondence, avoid generic phrases such as "we hope you understand our position", "thank you for your attention to this matter", "fair and equitable", or formulaic AI-style closing language unless the context genuinely calls for it. The draft should sound like a real professional wrote it for a real dispute.
Where the user dictates rough facts, do not simply tidy the wording. Infer the sensible structure of the argument. For example, if a party proposes mediation but the current evidence is unilateral, explain that meaningful mediation is more likely to be productive once both parties have had the opportunity to consider a neutral expert assessment.

When drafting emails or letters, never use hashtags, markdown headings, asterisks, bold formatting, consultant formatting, horizontal separators, excessive bullet points or long dashes.
When drafting emails or letters, use ordinary paragraphs and natural human structure. Numbered points are allowed only when the subject matter genuinely requires numbered options or steps.
The finished draft must look like a real manually written professional email or letter, not ChatGPT output.
Refer to the legislation as the Act.
Treat Square One Consulting, Itzik, outgoing emails from help@sq1consulting.co.uk, I and we as Itzik/Square One unless context clearly says otherwise.
`;

  prompt += `

PROJECT ID:
${projectId || 'none'}
`;

  const projectFacts = buildProjectFactsText(projectBundle);
  if (projectFacts) {
    prompt += `

AUTHORITATIVE PROJECT FACTS:
${projectFacts}
`;
  }

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

WHEN DRAFTING:
- mirror the tone, pacing and paragraph structure of the examples
- write like genuine manually written professional correspondence
- use natural prose and realistic sentence flow
- maintain measured escalation and professional caution

DO NOT USE:
- markdown headings
- hashtags
- stars/asterisks
- bold formatting
- AI assistant formatting
- consultant report formatting
- excessive structuring
- unnecessary bullet points
- overexplaining
- exaggerated escalation
- robotic transitions
- generic consultant phrasing
- artificial summaries

CORRESPONDENCE SHOULD:
- escalate concerns progressively and proportionately
- distinguish clearly between confirmed facts, concerns and implications
- sound calm, measured and professional
- avoid jumping immediately to legal conclusions
- read like genuine manually written correspondence between professionals
- use implied structure rather than visible structure
- prioritise realism over comprehensiveness
- maintain strategic caution in contentious matters

If discussing possible legal action or injunctions:
- do not present litigation as a foregone conclusion
- build the reasoning progressively from the evidence
- explain why confidence or trust has reduced
- explain why further oversight or enforcement may now be reasonable
- maintain professional restraint and caution
`;
  }

  return prompt;
}

function buildMessages({ body, systemPrompt }) {
  const { prompt, chatHistory = [] } = body;

  const messages = [{ role: 'system', content: systemPrompt }];

  if (chatHistory?.length) {
    chatHistory.slice(-24).forEach((msg) => {
      if (msg?.role === 'user' || msg?.role === 'assistant') {
        messages.push({ role: msg.role, content: String(msg.content || '') });
      }
    });
  }

  if (prompt?.trim()) {
    messages.push({ role: 'user', content: prompt.trim() });
  }

  return messages;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!OPENAI_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY missing' });
  }

  try {
    const body = req.body || {};
    let projectId = inferProjectId(body);

    const resolvedProject = !projectId ? await resolveProjectFromPrompt(body.prompt) : null;
    if (resolvedProject?.id) projectId = resolvedProject.id;

    const userId = inferUserId(body);
    const modeHint = inferModeHint(body.surface, body.prompt);

    const [projectBundle, scopedEmailContext, brain] = await Promise.all([
      loadProjectBundle(projectId),
      buildScopedEmailContext({ prompt: body.prompt, projectId }),
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

    const messages = buildMessages({ body, systemPrompt });

    console.log(
      `[ely-smart] project=${projectId || 'none'} emails=${scopedEmailContext?.length || 0} aos=${projectBundle?.adjoining_owners?.length || 0} mode=${modeHint}`
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
