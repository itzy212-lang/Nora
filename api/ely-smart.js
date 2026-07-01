// api/ely-smart.js
// Ely/Nora smart route - project-hydrated collaboration version
// Global behaviour: analyse first, draft only when clearly requested.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

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
    // Remove markdown headings
    .replace(/#{1,6}\s*/g, '')
    // Remove bold/italic markdown markers
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    // Keep bullet points — they improve readability in discussion responses
    // Only remove markdown-style horizontal separators (3+ dashes/underscores/equals on own line)
    .replace(/^[ \t]*[-]{3,}[ \t]*$/gm, '')
    .replace(/^[ \t]*[_]{3,}[ \t]*$/gm, '')
    .replace(/^[ \t]*[=]{3,}[ \t]*$/gm, '')
    // Replace em/en dashes
    .replace(/–/g, '-')
    .replace(/—/g, '-')
    .replace(/--+/g, ', ')
    // Collapse excessive blank lines but preserve paragraph breaks
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
NORA V4 RUNTIME STANDARD:
The current user instruction and detected intent control the response.
Do not draft unless the detected intent is draft.
Do not let surface, memory or project context override detected intent.
Use UK English.
Do not invent facts.
Do not use long dashes.
Refer to the legislation as the Act where context is clear.
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
    body: stripHtml(body).slice(0, 4000),
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

  // Load ALL emails linked to this project — both incoming and outgoing
  const projectEmails = await safeSelect(
    'emails',
    'id, subject, sender_name, sender_email, to_email, direction, received_at, sent_at, body, body_preview, raw_recipients',
    q => q
      .eq('project_id', projectId)
      .order('received_at', { ascending: true })
      .limit(100)
  );

  // Load ALL project chat messages across all sessions — no session boundary
  const projectChatMessages = await safeSelect(
    'ai_messages',
    'id, role, content, created_at, session_id',
    q => q
      .eq('project_id', projectId)
      .eq('surface', 'project_chat')
      .eq('role', 'user')
      .order('created_at', { ascending: true })
      .limit(50)
  );

  return {
    project_raw: project || null,
    project: normaliseProject(project || {}),
    adjoining_owners: adjoiningOwners.length ? adjoiningOwners : legacyAos,
    notices,
    documents,
    project_memory: projectMemory,
    soc_reports: socReports,
    project_chat_notes: projectChatMessages,
    project_emails: projectEmails,
  };
}

// ── Semantic search across all project content ───────────────────────────
async function semanticSearchProject(projectId, userPrompt, limit = 20) {
  if (!sb || !projectId || !userPrompt) return null;
  try {
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) return null;

    // Generate embedding for the user's question
    const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: userPrompt.slice(0, 8000), dimensions: 1536 }),
    });
    if (!embedRes.ok) return null;
    const embedData = await embedRes.json();
    const queryEmbedding = embedData.data[0].embedding;

    // Search across all project content
    const { data: results, error } = await sb.rpc('search_project_content', {
      p_project_id: projectId,
      query_embedding: queryEmbedding,
      match_limit: limit,
    });

    if (error || !results?.length) return null;
    return results;
  } catch (err) {
    console.warn('[ely-smart] semantic search failed:', err.message);
    return null;
  }
}

function wantsEmailContext(prompt = '', projectId = null, suppliedEmailContext = null, threadId = null, emailId = null) {
  if (suppliedEmailContext || threadId || emailId) return true;

  // v4: Do not load all project emails merely because a project is active.
  // Only load when the prompt clearly refers to emails/correspondence.
  const lower = String(prompt || '').toLowerCase();

  return (
    lower.includes('email') ||
    lower.includes('thread') ||
    lower.includes('inbox') ||
    lower.includes('reply') ||
    lower.includes('correspondence') ||
    lower.includes('letter') ||
    lower.includes('wrote') ||
    lower.includes('received') ||
    lower.includes('sent') ||
    lower.includes('response') ||
    lower.includes('respond') ||
    lower.includes('draft') ||
    lower.includes('what do you think about this email') ||
    lower.includes('what did they say') ||
    lower.includes('what is he asking') ||
    lower.includes('what is she asking') ||
    lower.includes('what are they asking')
  );
}

async function buildScopedEmailContext({ prompt, projectId, emailContext = null, threadId = null, emailId = null }) {
  const sb = getSupabase();
  const suppliedEmail = emailContext ? normaliseEmailRecord(emailContext) : null;

  if (!sb && suppliedEmail) return [suppliedEmail];
  if (!sb || !wantsEmailContext(prompt, projectId, suppliedEmail, threadId, emailId)) return suppliedEmail ? [suppliedEmail] : [];

  // Auto-search: detect "open email from [name]" in prompt
  if (!suppliedEmail && !emailId && !threadId) {
    const senderName = extractEmailSenderFromPrompt(prompt);
    if (senderName) {
      const found = await searchEmailsBySender(senderName, 3);
      if (found.length) {
        // Return the most recent matching email as context
        return found;
      }
    }
  }

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
    query = query.eq('project_id', projectId).order('received_at', { ascending: true });
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


// ================================================================
// NORA V4 INTENT CLASSIFIER
// Build Package 1 — June 2026
// Replaces: looksLikeDictation(), hasExplicitDraftRequest(), inferModeHint()
// Removed: 20-word drafting trigger
// Added: normalisePromptForIntent(), hasDiscussionIntent(),
//        looksLikeEmailDictation(), hasExplicitReviewRequest(),
//        hasExecuteIntent(), inferIntent()
// ================================================================

function normalisePromptForIntent(prompt = '') {
  return String(prompt || '')
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ');
}

function hasDiscussionIntent(prompt = '') {
  const p = normalisePromptForIntent(prompt).toLowerCase();

  if (!p) return false;

  return (
    /what do you think/i.test(p) ||
    /what's your view/i.test(p) ||
    /whats your view/i.test(p) ||
    /what's your read/i.test(p) ||
    /whats your read/i.test(p) ||
    /thoughts\??/i.test(p) ||
    /can (he|she|they|we|i) do that/i.test(p) ||
    /is that right/i.test(p) ||
    /is that correct/i.test(p) ||
    /is that a breach/i.test(p) ||
    /talk me through/i.test(p) ||
    /(let'?s|let us) discuss/i.test(p) ||
    /chat through/i.test(p) ||
    /am i missing/i.test(p) ||
    /what('?s| is) his angle/i.test(p) ||
    /what('?s| is) her angle/i.test(p) ||
    /what('?s| is) their angle/i.test(p) ||
    /why is (he|she|they) saying this/i.test(p) ||
    /how would a judge view this/i.test(p) ||
    /how would a third surveyor view this/i.test(p) ||
    /help me form a response/i.test(p) ||
    /we need to discuss/i.test(p) ||
    /i think/i.test(p) ||
    /i am concerned/i.test(p) ||
    /i'm concerned/i.test(p) ||
    /the issue is/i.test(p) ||
    /the risk is/i.test(p) ||
    /the difficulty is/i.test(p) ||
    /i'?ve reviewed the thread and i think/i.test(p) ||
    /i'?ve read the thread and i think/i.test(p)
  );
}

function looksLikeEmailDictation(prompt = '') {
  const p = normalisePromptForIntent(prompt);

  if (!p) return false;

  // Greeting starters — clearly dictating an email
  if (/^(dear|hi|hello|good morning|good afternoon|good evening)\s+[a-z]/i.test(p)) return true;

  // Thread continuation / follow-up starters
  if (/^(thank you for your email|thanks for your email|thanks for (confirming|coming back|sending|your)|further to|following our|i refer to|with reference to|just to follow|just following|following up)\b/i.test(p)) return true;

  // Instruction starters — user telling Ely what to say
  if (/^(tell (them|him|her)|let (them|him|her) know|say that|just say|basically say|write to|reply to|respond to|send an email to|i need to say|i want to say|i need to tell|can you write|can you draft)\b/i.test(p)) return true;

  // Amendment starters — editing an existing draft
  if (/^(change it to|change the|update it to|update the|amend it|amend the|replace|remove the|take out|add in|add to|insert)\b/i.test(p)) return true;

  return false;
}


function hasExplicitDraftRequest(prompt = '') {
  const p = normalisePromptForIntent(prompt).toLowerCase();

  if (!p) return false;

  // Explicit draft/write/prepare/compose patterns
  const expressDraft =
    /\bdraft\b/i.test(p) ||
    /\bwrite (an?|the|a) (email|letter|reply|response)\b/i.test(p) ||
    /\bwrite to\b/i.test(p) ||
    /\bprepare (a|an) (response|reply|email|letter)\b/i.test(p) ||
    /\bcompose (an?|the) (email|letter)\b/i.test(p) ||
    /\breply saying\b/i.test(p) ||
    /\brespond saying\b/i.test(p) ||
    /\brespond by saying\b/i.test(p) ||
    /\bcreate the email\b/i.test(p) ||
    /\bsend an email\b/i.test(p) ||
    /\bi want to draft\b/i.test(p) ||
    /\bcan (you|we) draft\b/i.test(p) ||
    /\blet'?s (draft|write|prepare|compose)\b/i.test(p) ||
    /\bjust (draft|write|give me a draft)\b/i.test(p) ||
    /\bgive me (a |the )?(draft|email)\b/i.test(p) ||
    /\bproduce (a |the )?(draft|email|letter)\b/i.test(p);

  if (expressDraft) return true;

  // Recipient-change patterns — treat as draft amendment when user redirects an existing draft
  // "address it to", "send it to", "rewrite it for" etc
  // Carefully scoped to avoid catching "how should we address this issue?" style discussion
  const recipientChange =
    /\baddress (it|this|the (letter|email|draft)) to\b/i.test(p) ||
    /\blet'?s address (it|this) to\b/i.test(p) ||
    /\bchange the recipient to\b/i.test(p) ||
    /\bmake it to\b/i.test(p) ||
    /\brewrite it for\b/i.test(p) ||
    /\brewrite (the )?(letter|email|draft) for\b/i.test(p) ||
    /\bsend (it|this) to\b(?!.*\b(actually|please|can you|go ahead|now)\b)/i.test(p) ||
    /\bsend (the )?(letter|email|draft) to\b/i.test(p);

  if (recipientChange) return true;

  if (looksLikeEmailDictation(prompt)) return true;

  return false;
}

function hasExplicitReviewRequest(prompt = '') {
  const p = normalisePromptForIntent(prompt).toLowerCase();

  if (!p) return false;

  return (
    /review this (award|notice|document|draft|email|letter|clause|schedule|soc)/i.test(p) ||
    /review the (award|notice|document|draft|email|letter|clause|schedule|soc)/i.test(p) ||
    /look over this (award|notice|document|draft|email|letter|clause|schedule|soc)/i.test(p) ||
    /check this against/i.test(p) ||
    /compare these two/i.test(p) ||
    /compare this (award|notice|document|draft|email|letter|clause)/i.test(p)
  );
}

function hasExecuteIntent(prompt = '', body = {}) {
  const p = normalisePromptForIntent(prompt).toLowerCase();

  if (body?.pending_booking_confirm || body?.case_review_confirmed || body?.email_search) return true;

  return (
    (
      /(book|schedule|set|add|create|put in|diary|remind|reminder|block out)/i.test(p) &&
      /(appointment|inspection|soc|survey|visit|call|meeting|deadline|reminder)/i.test(p)
    ) ||
    (
      /(send|save|delete|remove|archive|update|create|generate|download|export)/i.test(p) &&
      /(email|draft|document|pdf|invoice|task|calendar|appointment|notice|award|report)/i.test(p)
    )
  );
}

function inferIntent({ surface = '', prompt = '', body = {} } = {}) {
  const explicitMode = String(body.mode || body.workflowStage || '').toLowerCase();
  const p = normalisePromptForIntent(prompt);

  if (hasExecuteIntent(p, body)) return 'execute';

  if (!p && (body.emailContext || body.emailId || body.threadId)) return 'discuss';

  if (explicitMode.includes('email_thread_summary') || explicitMode.includes('summary')) return 'discuss';

  if (hasExplicitDraftRequest(p)) return 'draft';

  if (hasExplicitReviewRequest(p)) return 'review';

  if (hasDiscussionIntent(p)) return 'discuss';

  return 'discuss';
}

function inferModeHint(surface, prompt = '', body = {}) {
  const explicitMode = String(body.mode || body.workflowStage || '').toLowerCase();

  // Draft With Ely surface — intent order:
  // 1. Explicit discussion/analysis request -> DISCUSS
  // 2. Recipient-facing wording or drafting trigger -> DRAFT
  // 3. No substantive prompt -> EMAIL_SUMMARY
  if (explicitMode.includes('draft_with_ely')) {
    const p = String(prompt || '').trim();
    if (!p) return 'email_summary';
    // Discussion wins if the user clearly asks for analysis
    if (hasDiscussionIntent(p)) return 'discuss';
    // Otherwise treat any content as a draft request — this surface exists for drafting
    // looksLikeEmailDictation catches recipient-facing wording
    // hasExplicitDraftRequest catches "respond saying", "reply saying" etc
    // For anything else on this surface that isn't discussion, default to draft
    return 'draft';
  }

  const intent = inferIntent({ surface, prompt, body });

  if (intent === 'execute') return 'execute';
  if (intent === 'draft') return 'draft';
  if (intent === 'review') return 'review';

  if (!String(prompt || '').trim() && (body.emailContext || body.emailId || body.threadId)) {
    return 'email_summary';
  }

  if (explicitMode.includes('email_thread_summary') || explicitMode.includes('summary')) {
    return 'email_summary';
  }

  if (surface === 'email_composer' && (body.emailContext || body.emailId || body.threadId) && !hasExplicitDraftRequest(prompt)) {
    return 'email_summary';
  }

  return 'discuss';
}

// ================================================================
// NORA V4 DOMAIN LAYER
// Build Package 2 — June 2026
// ================================================================

function inferDomain({ prompt = '', body = {}, projectBundle = null, scopedEmailContext = [] } = {}) {
  const p = String(prompt || '').toLowerCase();
  const surface = String(body.surface || '').toLowerCase();

  // SOC question via askEly
  if (surface === 'soc_chat' || /soc|schedule of condition/.test(p)) return 'soc_question';

  // Award review
  if (/review (this |the )?(award|draft award)/i.test(p) ||
      /award review/i.test(p) ||
      surface === 'award_review') return 'award_review';

  // Notice review
  if (/review (this |the )?(notice|section [136])/i.test(p) ||
      /notice review/i.test(p) ||
      surface === 'notice_review') return 'notice_review';

  // Document review
  if (/review (this |the )?(document|clause|schedule|draft|report)/i.test(p) ||
      surface === 'document_review') return 'document_review';

  // Email thread context
  if (scopedEmailContext?.length > 0 ||
      body.emailId || body.threadId || body.emailContext) return 'email_thread';

  // Party wall — broad match
  if (/(party wall|the act|section [1-9]|award|notice|adjoining owner|building owner|surveyor|excavat|notifiable|dissent|consent|security for expenses|third surveyor|agreed surveyor)/i.test(p)) return 'party_wall';

  // Project workflow
  if (projectBundle) return 'project_workflow';

  return 'general';
}

const DOMAIN_PROMPTS = {
  party_wall: `ACTIVE DOMAIN GUIDANCE: Party Wall
Analyse under the Act and practical surveying procedure.
Identify whether the issue concerns notifiable works, Award compliance, Act procedure, jurisdiction, damage or compensation, neighbour dispute, or matters outside surveyor jurisdiction.
Do not invent statutory requirements.`,

  award_review: `ACTIVE DOMAIN GUIDANCE: Award Review
Be role-aware: BO surveyor, AO surveyor, agreed surveyor or third surveyor.
Review for validity, scope, protections, access, method statement, drawings, SOC, damage procedure, Security for Expenses, costs and appeal rights.
Do not rewrite the whole award unless asked.`,

  notice_review: `ACTIVE DOMAIN GUIDANCE: Notice Review
Check the relevant notice against applicable statutory requirements.
Identify missing names, addresses, dates, sections, drawings, excavation details, safeguards, service issues and response periods.
Do not assume a notice is invalid without explaining the defect.`,

  email_thread: `ACTIVE DOMAIN GUIDANCE: Email Thread
Read the whole available thread.
Identify what is being asked, the underlying issue, tone, position changes and response strategy.
Do not draft unless intent is draft.`,

  document_review: `ACTIVE DOMAIN GUIDANCE: Document Review
Identify defects, risks, omissions, inconsistencies and practical implications.
Be role-aware.
Do not rewrite the whole document unless asked.`,

  soc_question: `ACTIVE DOMAIN GUIDANCE: SOC Inspection Question
Answer as a practical surveying colleague during an inspection.
Keep answers concise and practical.
Do not interfere with SOC generation.
Do not produce SOC JSON.`,

  project_workflow: `ACTIVE DOMAIN GUIDANCE: Project Workflow
Help progress the matter practically.
Consider what has happened, what is missing and what the next step should be.`,

  general: '',
};


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

async function buildSystemPrompt({ brain, projectId, resolvedProject, projectBundle, scopedEmailContext, modeHint, draftingExamples = [], userPrompt = '' }) {
  // ── NORA V4 INSTRUCTION HIERARCHY ─────────────────────────────────────────
  // When instructions conflict, apply this order:
  // 1. Current user instruction
  // 2. Detected intent (modeHint from classifier)
  // 3. Active mode rules (injected below based on modeHint)
  // 4. Domain rules (party wall, award review etc.)
  // 5. Supplied project/email/document context
  // 6. User preferences and standing memory
  // 7. General style preferences
  //
  // Memory must NEVER override the current user instruction or detected intent.
  // Surface must NEVER override detected intent.
  // Draft With Ely is a context surface, not a command to draft.
  //
  // Build Package 2: Memory filtering implemented in buildMessages() via isMemoryExcluded().
  // Excluded from runtime: preserve_working_features, soc_template, email_style, assistant_role.
  // ──────────────────────────────────────────────────────────────────────────
  let prompt = brain?.instruction_set?.system_prompt || 'You are Ely, an AI assistant for a Party Wall surveying practice. Always use British English spelling and terminology.';

  // Append output rules if present
  if (brain?.instruction_set?.output_rules) {
    prompt += `\n\n${brain.instruction_set.output_rules}`;

  }

  // Append behaviour rules if present
  if (brain?.instruction_set?.behaviour_rules) {
    prompt += `\n\n${brain.instruction_set.behaviour_rules}`;
  }

  // ── DOMAIN LAYER — injected when a specific mode is active ────────────
  // This is the second instruction set loaded from the layered brain loader.
  // It adds mode-specific rules on top of the global layer without replacing it.
  if (brain?.domain_layer) {
    const dl = brain.domain_layer;
    const parts = [dl.system_prompt, dl.output_rules, dl.behaviour_rules].filter(Boolean);
    if (parts.length) {
      prompt += `\n\n--- DOMAIN LAYER: ${dl.name || dl.layer_type || 'specialist'} ---\n\n${parts.join('\n\n')}`;
    }
  }

  prompt += `\n\n${GLOBAL_AI_STANDARD}\n`;

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
    } else if (modeHint === 'draft') {
    prompt += `

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

Do not add:

- facts
- arguments
- legal positions
- technical conclusions
- promises
- requests
- explanations
- strategic reasoning

that are not present in the source material or established context.

SOURCE PROCESSING

Before drafting, silently classify the source into:

1. RECIPIENT CONTENT

Information, reasoning, wording, questions and requests intended for the recipient.

2. CONTROL INSTRUCTIONS

Directions to Nora concerning:

- paragraphing
- wording
- tone
- emphasis
- inclusion
- deletion
- exact wording
- structure

3. DISCARDED SPEECH

Filler, false starts, hesitation, repetition, self-correction, verbal padding, incomplete abandoned wording and thoughts spoken aloud.

Use recipient content.

Apply control instructions silently and remove them.

Remove discarded speech.

CONTROL INSTRUCTION RULES

"New paragraph", "next paragraph", "start a new paragraph"

Start a new paragraph.

Do not include the instruction.

"Word for word", "include this exactly", "verbatim"

Remove the instruction itself.

Reproduce the immediately governed clause, sentence or quoted passage exactly.

Do not paraphrase the governed wording.

"Make sure you include this", "this is important", "do not leave this out"

Preserve the substance carefully.

Do not include the instruction itself.

Do not treat the wording as verbatim unless the user also requests exact wording.

"Scratch that", "ignore that", "forget the last bit"

Remove the immediately preceding or identified abandoned material.

"Finish that sentence", "full stop"

End the sentence at that point.

Do not include the instruction.

"Keep this short", "make it formal", "make it casual", "soften this", "make this stronger"

Apply the requested style.

Do not include the instruction.

SILENT EDITING SEQUENCE

Before writing:

1. Identify what the recipient needs to understand.
2. Identify what the user wants the recipient to confirm, decide, accept or do.
3. Identify the user's conclusion or intended outcome.
4. Extract recipient-facing content.
5. Remove control instructions.
6. Remove filler, false starts and abandoned speech.
7. Group repeated fragments that express the same point.
8. Identify each genuinely distinct argument, distinction, qualification, question and request.
9. Arrange the material into the clearest professional sequence.
10. Plan the paragraph structure.
11. Draft in natural UK English.
12. Rewrite any sentence that still sounds spoken.
13. Check that nothing new has been invented.

PARAGRAPH STRUCTURE

Plan paragraphs according to communicative purpose, not sentence count.

Each paragraph must have one main purpose.

Create a new paragraph when the correspondence moves to:

- a different issue
- a different stage of reasoning
- a separate qualification
- a separate question
- a separate request
- a conclusion
- a decision
- a next step

Keep closely related explanation and its associated question or request together where they form one coherent point.

Do not combine unrelated points.

Do not create a separate paragraph for every sentence.

Use one blank line:

- after the greeting
- between paragraphs
- before the sign-off

STYLE

Write as a natural, experienced professional surveyor and project adviser.

Use conversational professional UK English.

Use:

- plain English
- direct wording
- active voice
- natural sentence structure
- concise but complete explanations

Do not use:

- corporate filler
- legalistic padding
- academic wording
- robotic language
- generic AI phrasing
- long dashes
- HTML
- markdown formatting

THREAD TONE

Where replying to an existing thread:

- match the established tone
- do not become unnecessarily formal
- use the established factual context
- avoid repeating information the recipient already knows unless repetition is necessary
- preserve the user's authority and professional position

FINAL CHECK

Do not return the draft until all answers are yes:

- Does it read as written professional correspondence rather than transcribed speech?
- Has rough spoken wording been rewritten?
- Has repetition been consolidated?
- Has the material been reordered where the spoken order was unclear?
- Is every genuinely distinct substantive point retained?
- Are distinctions and qualifications preserved?
- Does each paragraph have one coherent purpose?
- Have all inline drafting instructions been removed?
- Has expressly verbatim wording been preserved exactly?
- Has nothing been invented?
- Is the tone natural and professionally appropriate?
- Does the correspondence end with "Kind regards," and nothing after it?
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

INVOICE MODE:
When the user asks to raise, create, generate or send an invoice, switch into invoice mode.
Extract line items from their dictation. Each item needs: description and amount (£).
Format amounts as numbers without currency symbols in the structured data.
Respond with a clean summary card showing the line items and total.
Ask the user to confirm or amend.
When the user says "generate it", "looks good", "confirm", "yes" or similar — indicate you are ready to generate.
Always bill to the Building Owner from the project data.
Never suggest or invent fee amounts — use only amounts the user states.

INVOICE JSON FORMAT — when returning invoice data, include it as a JSON block at the end of your reply:
<invoice_data>
{
  "items": [{"description": "...", "total": 350, "qty": 1, "unitPrice": "350"}],
  "bill_to_name": "...",
  "bill_to_address": "...",
  "property_address": "...",
  "bo_email": "..."
}
</invoice_data>

EMAIL CONTEXT RULE:
If selected email context is provided, it is authoritative. Read the whole available thread before responding. For Draft With Ely and email composer workflows, do not assume the user wants an email drafted simply because the selected context is an email. If the user prompt is blank, summarise the selected email/thread and suggest the response strategy. If the user asks to talk it through, analyse. Draft only when the user clearly asks for drafting.

When drafting emails or letters, never use hashtags, markdown headings, asterisks, bold formatting, consultant formatting, horizontal separators, excessive bullet points or long dashes.
When drafting emails or letters, use ordinary paragraphs and natural human structure. Numbered points are allowed only when the subject matter genuinely requires numbered options or steps.
The finished draft must look like a real manually written professional email or letter, not ChatGPT output.
Refer to the legislation as the Act.
Treat Square One Consulting, Itzik, outgoing emails from help@sq1consulting.co.uk, I and we as Itzik/Square One unless context clearly says otherwise.
`;

  }

  // Inject domain guidance block (Part 5/6 Build Package 2)
  const domain = inferDomain({ prompt: userPrompt, body: {}, projectBundle, scopedEmailContext });
  const domainBlock = DOMAIN_PROMPTS[domain] || '';
  if (domainBlock) {
    prompt += `

${domainBlock}
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

  // ── Semantic search across ALL project content ───────────────────────────
  // Uses vector embeddings — no limit, finds relevant content regardless of volume
  let semanticResults = null;
  try {
    if (projectBundle?.project?.id) {
      semanticResults = await semanticSearchProject(projectBundle.project.id || projectId, userPrompt, 25);
    }
  } catch (semErr) {
    console.warn('[ely-smart] semantic search failed silently:', semErr.message);
    semanticResults = null;
  }

  if (semanticResults?.length) {
    // Semantic search succeeded — use it for emails, chat, memory
    const byType = { email: [], chat: [], memory: [] };
    for (const r of semanticResults) {
      if (byType[r.content_type]) byType[r.content_type].push(r);
    }

    if (byType.email.length) {
      const emailsText = byType.email.map(r => {
        const m = r.metadata || {};
        const date = new Date(m.received_at || m.sent_at || '').toLocaleDateString('en-GB');
        const dirLabel = m.direction === 'outgoing' ? 'SENT' : 'RECEIVED';
        const fromTo = m.direction === 'outgoing'
          ? `To: ${m.to_email || 'unknown'}`
          : `From: ${m.sender_name || m.sender_email || 'unknown'}`;
        return `[${date}] ${dirLabel} — ${fromTo}\nSubject: ${r.subject || '(no subject)'}\n${r.content}`;
      }).join('\n\n---\n\n');
      prompt += `\n\nPROJECT EMAILS — SEMANTICALLY RELEVANT (searched all correspondence):\n${emailsText}\n`;
    }

    if (byType.chat.length) {
      const chatText = byType.chat.map(r => {
        const date = new Date(r.metadata?.created_at || '').toLocaleDateString('en-GB');
        return `[${date}] ${r.content}`;
      }).join('\n');
      prompt += `\n\nRELEVANT PROJECT CHAT NOTES:\n${chatText}\n`;
    }

    if (byType.memory.length) {
      const memText = byType.memory.map(r =>
        `[${r.subject || 'Note'}] ${r.content}`
      ).join('\n\n---\n\n');
      prompt += `\n\nRELEVANT PROJECT DOCUMENTS & NOTES:\n${memText}\n`;
    }

  } else if (projectBundle?.project_emails?.length) {
    // Fallback — embeddings not yet generated, use keyword-scored emails
    const promptLower = (userPrompt || '').toLowerCase();
    const topicWords = promptLower.split(/\s+/).filter(w => w.length > 3);
    let relevantEmails = projectBundle.project_emails;
    if (topicWords.length > 0) {
      const scored = relevantEmails.map(e => {
        const text = ((e.subject || '') + ' ' + (e.body || '') + ' ' + (e.sender_name || '')).toLowerCase();
        const score = topicWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
        return { ...e, _score: score };
      }).sort((a, b) => b._score - a._score);
      relevantEmails = scored.slice(0, 30);
    }
    const emailsText = relevantEmails
      .map(e => {
        const date = new Date(e.received_at || e.sent_at || '').toLocaleDateString('en-GB');
        const isOutgoing = e.direction === 'outgoing';
        const dirLabel = isOutgoing ? 'SENT' : 'RECEIVED';
        const fromTo = isOutgoing
          ? `To: ${e.to_email || 'unknown'}`
          : `From: ${e.sender_name || e.raw_recipients?.from?.name || e.sender_email || 'unknown'}`;
        const bodyText = (e.body || e.body_preview || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return `[${date}] ${dirLabel} — ${fromTo}\nSubject: ${e.subject || '(no subject)'}\n${bodyText.slice(0, 1500)}`;
      })
      .join('\n\n---\n\n');
    prompt += `\n\nPROJECT EMAILS — FULL CORRESPONDENCE (incoming and outgoing):\n${emailsText.slice(0, 15000)}\n`;
  }

  // Inject ALL project chat notes across all sessions — no session boundary
  if (projectBundle?.project_chat_notes?.length) {
    const notesText = projectBundle.project_chat_notes
      .map(m => `[${new Date(m.created_at).toLocaleDateString('en-GB')}] ${m.content}`)
      .join('\n\n---\n\n');
    prompt += `\n\nALL PROJECT NOTES & CHAT (every message from this project across all sessions):\n${notesText.slice(0, 8000)}\n`;
  }

  if (projectBundle) {
    const { project_chat_notes: _notes, project_emails: _emails, ...bundleWithoutNotes } = projectBundle;
    prompt += `\n\nPROJECT BUNDLE:\n${compactJson(bundleWithoutNotes, 14000)}\n`;
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

SCOPED EMAIL CONTEXT — ALL PROJECT EMAILS (${scopedEmailContext.length} total, chronological):
${compactJson(scopedEmailContext, 20000)}
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

async function buildMessages({ body, systemPrompt, scopedEmailContext = [], modeHint = 'discuss' }) {
  const { prompt, chatHistory = [], brainContext = [] } = body;
  const messages = [{ role: 'system', content: systemPrompt }];

  const emailContextText = buildEmailContextText({ body, scopedEmailContext });
  if (emailContextText) messages.push({ role: 'system', content: emailContextText });

  // Auto-fetch attachments from the loaded email if it has them
  if (scopedEmailContext?.length > 0) {
    const primaryEmail = scopedEmailContext[0];
    const emailDbId = primaryEmail?.id;

    // Always try to fetch attachments — the function checks DB and returns empty if none
    console.log('[ely-smart] checking attachments for email:', emailDbId);
    if (emailDbId) {
      try {
        const attachments = await fetchEmailAttachments(emailDbId);
        console.log('[ely-smart] attachments found:', attachments?.length || 0);
        if (attachments?.length > 0) {
          const attachText = attachments
            .filter(a => a.text || a.extracted_text || a.content_text)
            .map(a => `ATTACHMENT: ${a.filename || a.name || 'file'}\n\n${(a.text || a.extracted_text || a.content_text || '').slice(0, 8000)}`)
            .join('\n\n---\n\n');
          if (attachText.trim()) {
            messages.push({
              role: 'system',
              content: `The following attachment contents have been extracted from the email above using Claude Vision. This IS the actual content of the PDF files — you have full access to this information. Do not say you cannot see attachments. Analyse this content and answer questions about it directly.\n\n${attachText}`
            });
          }
        }
      } catch (attachErr) {
        console.warn('[ely-smart] attachment fetch skipped:', attachErr.message);
      }
    }
  }

  // ── Inject uploaded document text ────────────────────────────────────────
  const uploadedFiles = body.context?.uploadedExtractedText || body.uploadContext || [];
  if (uploadedFiles?.length) {
    const docBlocks = uploadedFiles
      .filter(f => f.extracted_text && String(f.extracted_text).trim().length > 20)
      .map(f => `UPLOADED DOCUMENT: ${f.file_name || 'file'}\n\n${String(f.extracted_text).slice(0, 6000)}`)
      .join('\n\n---\n\n');

    if (docBlocks) {
      messages.push({
        role: 'system',
        content: `The following document(s) have been uploaded by the user. Read them carefully and use them to answer any questions. If the document appears to be a Party Wall notice, automatically check it against the relevant statutory requirements (Section 1, 3, or 6) and report any deficiencies.\n\n${docBlocks}`,
      });
    }
  }

  // ── Land Registry document detection ────────────────────────────────────
  if (uploadedFiles?.length && body.surface === 'project_chat') {
    for (const f of uploadedFiles) {
      const text = String(f.extracted_text || '').trim();
      const isLandReg = (
        /title (number|register|absolute)/i.test(text) ||
        /HM Land Registry/i.test(text) ||
        /registered (proprietor|owner)/i.test(text) ||
        /proprietorship register/i.test(text) ||
        /(title plan|official copy)/i.test(text)
      );

      if (isLandReg && ANTHROPIC_KEY) {
        try {
          const lrPrompt = 'Extract the registered proprietor details from this Land Registry title register. Return ONLY a JSON object with no markdown:\n' +
            '{\n' +
            '  "proprietor_name": "full name(s) of registered proprietor(s)",\n' +
            '  "property_address": "full registered address of the property",\n' +
            '  "title_number": "title number if visible",\n' +
            '  "proprietor_address": "correspondence address if different from property address, otherwise null"\n' +
            '}\n\n' +
            'If multiple proprietors, put all names in proprietor_name separated by " and ".\n\n' +
            'TITLE REGISTER TEXT:\n' + text.slice(0, 8000);

          const lrRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-6', // Sonnet sufficient for drawing analysis, 40% cheaper than Opus
              max_tokens: 800,
              messages: [{ role: 'user', content: lrPrompt }],
            }),
          });

          if (lrRes.ok) {
            const lrData = await lrRes.json();
            const rawText = lrData?.content?.[0]?.text || '';
            try {
              const extracted = JSON.parse(rawText.replace(/```json|```/g, '').trim());
              if (extracted.proprietor_name && extracted.property_address) {
                return res.status(200).json({
                  reply: 'I can see this is a Land Registry title register for **' + extracted.property_address + '**.\n\nThe registered proprietor is **' + extracted.proprietor_name + (extracted.title_number ? ' (Title No. ' + extracted.title_number + ')' : '') + '.\n\nWould you like me to add them as an Adjoining Owner on this project?',
                  land_registry_ao: {
                    name: extracted.proprietor_name,
                    premise: extracted.property_address,
                    service_address: extracted.proprietor_address || extracted.property_address,
                    title_number: extracted.title_number || null,
                    source: 'land_registry',
                  },
                  sessionId: Date.now() + '-' + Math.random().toString(36).slice(2),
                });
              }
            } catch (e) { /* JSON parse failed — fall through */ }
          }
        } catch (lrErr) {
          console.warn('[ely-smart] Land Registry extraction failed:', lrErr.message);
        }
        break;
      }
    }
  }

  // Inject documents previously uploaded to this project (from project_memory chat_upload records)
  const memoryUploads = (body.context?.projectMemoryUploads || []);
  if (memoryUploads.length > 0) {
    const memoryDocBlocks = memoryUploads
      .filter(m => m.content && String(m.content).trim().length > 20)
      .map(m => `PREVIOUSLY UPLOADED DOCUMENT: ${m.title || 'file'}\n\n${String(m.content).slice(0, 6000)}`)
      .join('\n\n---\n\n');

    if (memoryDocBlocks) {
      messages.push({
        role: 'system',
        content: `The following document(s) were previously uploaded to this project and are available for reference:\n\n${memoryDocBlocks}`,
      });
    }
  }

  // Inject project brain — persistent memory from previous sessions
  // Cap at ~4000 chars per entry and ~8000 chars total to stay within token budget
  const BRAIN_ENTRY_CAP = 4000;
  const BRAIN_TOTAL_CAP = 8000;

  // v4 memory filter: exclude records flagged as v4_runtime_excluded
  // Also exclude by key/type for belt-and-braces safety
  const V4_EXCLUDED_KEYS = new Set(['preserve_working_features']);
  const V4_EXCLUDED_TYPES = new Set(['soc_template', 'email_style', 'assistant_role']);
  function isMemoryExcluded(m) {
    if (!m) return false;
    if (m?.metadata?.v4_runtime_excluded === true || m?.metadata?.v4_runtime_excluded === 'true') return true;
    if (V4_EXCLUDED_KEYS.has(m?.key)) return true;
    if (V4_EXCLUDED_TYPES.has(m?.type)) return true;
    return false;
  }

  const filteredBrainContext = (brainContext || []).filter(m => !isMemoryExcluded(m));

  if (filteredBrainContext?.length) {
    const summaryEntry = filteredBrainContext.find(m => m.is_summary);
    const regularEntries = filteredBrainContext.filter(m => !m.is_summary);

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

  // ── Inject project chat workflow instruction ─────────────────────────────
  const projectChatInstruction = body.context?.projectChatInstruction || body.projectChatInstruction || '';
  // v4: inject instruction only when it does not contain draft-forcing language
  // unless the classifier has already determined draft intent
  if (projectChatInstruction && (modeHint === 'draft' || !projectChatInstruction.toLowerCase().includes('draft'))) {
    messages.push({ role: 'system', content: projectChatInstruction });
  }

  // ── Draft mode collaboration rules ───────────────────────────────────────
  // When a draft is requested in project chat or main chat, enforce collaboration-first
  // v4: isDraftMode driven by classifier, not by workflow strings in body
  const isDraftMode = modeHint === 'draft';

  // ── Inline response mode ──────────────────────────────────────────────
  // Triggered when user wants to respond point-by-point inline in blue
  const isInlineResponseMode = /respond.*inline|inline.*respond|paste.*points|point.*by.*point|respond.*each|each.*point|reply.*inline|inline.*reply|respond.*line.*by.*line|line.*by.*line/i.test(prompt);

  if (isInlineResponseMode) {
    messages.push({
      role: 'system',
      content: `INLINE RESPONSE MODE — the user wants to respond to the other party's email points inline.

INSTRUCTIONS:
1. Extract all numbered or bulleted points from the email in context. If there are no clear points, extract each distinct sentence or paragraph as a separate item.
2. List them clearly and ask the user to give their response to each point — either one at a time or all at once (e.g. "Point 1 — yes confirmed. Point 2 — Stephen Cornish nominated.")
3. Once the user provides their responses, produce the formatted HTML email body with:
   - Each of the other party's original points in their original black text
   - Immediately after each point (no line break), the user's response in blue: <span style="color:#1d4ed8;font-weight:500"> [response]</span>
4. The output must be valid HTML that can be pasted directly into the email composer.
5. Do not add any commentary inside the HTML — just the formatted content.
6. Wrap the whole thing in a clean div with font-family: inherit; font-size: 13.5px; line-height: 1.7;`,
    });
  }

  if (isDraftMode) {
    messages.push({
      role: 'system',
      content: `DRAFT WORKFLOW RULES — follow these in order:

1. READ FIRST: If an email or document is in context, read it fully before doing anything.
2. BRIEF FIRST: In one or two short sentences, tell Itzik what the email/message is saying and flag anything important — dates, requests, sensitivities. Do not skip this even if he gave you a clear brief.
3. NEVER INVENT: Never assume availability, dates, times, names, fees, or any fact not explicitly stated. If you need a fact you don't have, ask for it in one short question.
4. DRAFT: Produce the clean draft immediately after the brief — no preamble, no "here is a draft:", start with the greeting or first line of the email.
5. TONE DEFAULT: Unless told otherwise, default is warm, human and conversational. Not formal. Not corporate. Not robotic. Sound like a real person.
6. BANNED PHRASES IN DRAFTS: Never use "I look forward to receiving your correspondence", "I look forward to hearing from you", "Please do not hesitate to contact me", "I hope this finds you well", "Thank you for your attention to this matter", "I remain", "Yours faithfully", "Please feel free to", "I trust this meets your requirements". These are Android phrases. Use natural human closings.
7. CLEAN DRAFT: The draft must contain zero commentary, zero meta-text, zero subject lines, zero "let me know if you want changes". Just the email text from greeting to "Kind regards". Nothing else inside the draft.
8. SUBJECT LINE: If a subject line is needed, put it on a separate line BEFORE the draft with the format "Subject: [text]" — never inside the draft itself.`,
    });
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
// Detect "open email from X" / "find email from X" in prompt
function extractEmailSenderFromPrompt(prompt = '') {
  const p = String(prompt || '').toLowerCase().trim();
  const patterns = [
    /(?:open|find|read|get|load|pull up|show me|look at)(?:\s+(?:an?|the))?\s+email\s+from\s+([a-z][a-z '\-]+?)(?:\s*[,\.!?]|$|\s+and\s|\s+then|\s+read|\s+attach|\s+draw)/i,
    /email\s+from\s+([a-z][a-z '\-]+?)(?:\s*[,\.!?]|$|\s+and\s|\s+then|\s+about)/i,
    /from\s+([a-z][a-z '\-]+?)\s*['']?s?\s+email/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m && m[1] && m[1].trim().length > 1) {
      return m[1].trim().replace(/\s+/g, ' ');
    }
  }
  return null;
}

// Search emails globally by sender name (no project required)
async function searchEmailsBySender(senderName, limit = 3) {
  const sb = getSupabase();
  if (!sb || !senderName) return [];
  try {
    const { data, error } = await sb
      .from('emails')
      .select('*')
      .or(`sender_name.ilike.%${senderName}%,sender_email.ilike.%${senderName}%`)
      .order('received_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(normaliseEmailRecord).filter(Boolean);
  } catch (err) {
    console.warn('[ely-smart] searchEmailsBySender error:', err.message);
    return [];
  }
}

// Fetch email attachments via Microsoft Graph API and extract text using Claude Vision
async function fetchEmailAttachments(emailId) {
  if (!emailId) return [];
  const sb = getSupabase();
  if (!sb) return [];
  try {
    // Get attachment records from DB
    // Prioritise structural drawings and floor plans — limit to 4 to avoid timeout
    const { data: allAtts, error } = await sb
      .from('email_attachments')
      .select('id, filename, content_type, storage_path, extracted_text')
      .eq('email_id', emailId)
      .limit(12);

    // Sort: cached first, then structural/survey docs, then floor plans, then others
    const attachments = (allAtts || []).sort((a, b) => {
      const score = (f) => {
        if (f.extracted_text) return 10; // already cached — always include
        const fn = (f.filename || '').toLowerCase();
        if (fn.includes('structural') || fn.includes('survey')) return 3;
        if (fn.includes('lower ground') || fn.includes('ground floor') || fn.includes('section')) return 2;
        if (fn.includes('floor') || fn.includes('elevation')) return 1;
        return 0;
      };
      return score(b) - score(a);
    }).slice(0, 4); // max 4 at a time — remaining can be fetched on subsequent messages

    console.log('[ely-smart] email_attachments query result:', { count: attachments?.length, error: error?.message });
    if (error) { console.warn('[ely-smart] email_attachments error:', error); return []; }
    if (!attachments?.length) return [];

    // Get the email's external_id (Microsoft Graph message ID) and access token
    const { data: emailRow } = await sb
      .from('emails')
      .select('external_id')
      .eq('id', emailId)
      .single();

    const { data: accountRow } = await sb
      .from('email_accounts')
      .select('access_token, refresh_token')
      .eq('provider', 'outlook')
      .limit(1)
      .single();

    const messageId = emailRow?.external_id;
    const accessToken = accountRow?.access_token;

    console.log('[ely-smart] graph fetch setup:', { messageId: !!messageId, accessToken: !!accessToken });

    const results = [];

    for (const att of attachments) {
      // Use cached extraction if available
      if (att.extracted_text && att.extracted_text.length > 20) {
        results.push({ filename: att.filename, text: att.extracted_text });
        continue;
      }

      const ct = att.content_type || '';
      const fname = att.filename || '';
      const isPdf = ct.includes('pdf') || fname.endsWith('.pdf');
      const isDocx = ct.includes('word') || ct.includes('docx') || fname.endsWith('.docx');

      if (!isPdf && !isDocx) continue;

      let buffer = null;

      // Try Microsoft Graph API first
      if (messageId && accessToken) {
        try {
          // Extract attachment ID from storage_path
          // Format: email@domain / messageId / attachmentId_filename
          const pathParts = (att.storage_path || '').split('/');
          const lastPart = pathParts[pathParts.length - 1] || '';
          // attachmentId is everything before the first underscore+filename
          const attachmentId = lastPart.includes('_' + fname) 
            ? lastPart.split('_' + fname)[0]
            : lastPart.split('_')[0]; // fallback: split on first underscore

          console.log('[ely-smart] attachment ID extracted:', attachmentId?.slice(0, 30));

          if (attachmentId) {
            const encodedId = encodeURIComponent(attachmentId);
            const graphUrl = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments/${encodedId}/$value`;
            const graphRes = await fetch(graphUrl, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            console.log('[ely-smart] graph attachment fetch:', fname, graphRes.status);
            if (graphRes.ok) {
              const arrayBuf = await graphRes.arrayBuffer();
              buffer = Buffer.from(arrayBuf);
            }
          }
        } catch (graphErr) {
          console.warn('[ely-smart] graph fetch failed:', fname, graphErr.message);
        }
      }

      // If graph failed, try listing attachments and find by name
      if (!buffer && messageId && accessToken) {
        try {
          const listUrl = `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments`;
          const listRes = await fetch(listUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (listRes.ok) {
            const listData = await listRes.json();
            const match = listData.value?.find(a => a.name === fname);
            if (match?.contentBytes) {
              buffer = Buffer.from(match.contentBytes, 'base64');
              console.log('[ely-smart] got attachment via list:', fname);
            }
          }
        } catch (listErr) {
          console.warn('[ely-smart] attachment list failed:', listErr.message);
        }
      }

      if (!buffer) {
        console.warn('[ely-smart] could not get buffer for:', fname);
        continue;
      }

      let extractedText = '';

      if (isPdf) {
        try {
          const base64 = buffer.toString('base64');
          const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'anthropic-beta': 'pdfs-2024-09-25',
            },
            body: JSON.stringify({
              model: 'claude-opus-4-6',
              max_tokens: 2000,
              messages: [{
                role: 'user',
                content: [
                  { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
                  { type: 'text', text: 'This is an architectural drawing or construction document for a party wall survey. Please extract and describe: (1) What type of document is this? (2) What floor/area does it cover? (3) Key dimensions, room names, spaces shown. (4) Any party walls, shared walls, or boundary walls marked. (5) Any proposed structural works — excavations, underpinning, beams, extensions. (6) Symbol legend if present. (7) Any written notes or specifications. Be concise but thorough.' }
                ]
              }]
            })
          });
          if (claudeRes.ok) {
            const claudeData = await claudeRes.json();
            extractedText = claudeData?.content?.[0]?.text || '';
            console.log('[ely-smart] Claude Vision extracted:', fname, extractedText.length, 'chars');
          }
        } catch (visionErr) {
          console.warn('[ely-smart] Claude Vision failed:', fname, visionErr.message);
        }
      } else if (isDocx) {
        try {
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ buffer });
          extractedText = (result.value || '').slice(0, 8000);
        } catch (e) {}
      }

      if (extractedText && extractedText.length > 10) {
        try {
          await sb.from('email_attachments')
            .update({ extracted_text: extractedText })
            .eq('id', att.id);
        } catch (_) {}
        results.push({ filename: att.filename, text: extractedText });
      }
    }

    console.log('[ely-smart] attachments found:', results.length);
    return results;
  } catch (err) {
    console.warn('[ely-smart] fetchEmailAttachments error:', err.message);
    return [];
  }
}

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
  // Only trigger for explicit full case review requests
  // Simple "read my notes" or "check the project notes" no longer needs case review
  // because project notes and emails are now loaded automatically into every project chat
  return lower.includes('case review') ||
    lower.includes('full review') ||
    lower.includes('full case') ||
    lower.includes('full case file') ||
    lower.includes('go through everything') ||
    lower.includes('review everything on this project') ||
    lower.includes('review all the correspondence') ||
    lower.includes('review all correspondence');
}

// ── Invoice intent detection ──────────────────────────────────────────────
function detectsInvoiceIntent(prompt = '') {
  const p = prompt.toLowerCase();
  return (
    /(raise|create|generate|send|prepare|draft|do|write)/i.test(p) &&
    /(invoice|bill|fee|charge|payment)/i.test(p)
  ) ||
  /(invoice for|bill (them|him|her|the building owner)|invoice (the |)building owner)/i.test(p) ||
  /(raise an invoice|raise invoice|generate (an |the |)invoice)/i.test(p);
}

function detectsInvoiceGenerate(prompt = '') {
  const p = prompt.toLowerCase();
  return /(generate it|generate the invoice|send it|create it|produce it|go ahead|confirm it|looks good|that'?s (right|correct|good|fine)|yes (please|send|generate)|ok (send|generate))/i.test(p);
}

function parseInvoiceItems(prompt = '') {
  // Extract line items from dictation like "consultation £350, two site visits £400 each"
  const items = [];
  const p = prompt;

  // Pattern: description + £amount or amount + description
  const linePatterns = [
    // "description £amount" or "description £amount each"
    /([a-z][^,\n£]{3,40}?)\s+£\s*(\d+(?:\.\d{2})?)/gi,
    // "description - £amount"
    /([a-z][^,\n£]{3,40}?)\s*[-–]\s*£\s*(\d+(?:\.\d{2})?)/gi,
  ];

  for (const pattern of linePatterns) {
    let match;
    while ((match = pattern.exec(p)) !== null) {
      const description = match[1].trim()
        .replace(/^(and|,)\s*/i, '')
        .replace(/\s+/g, ' ');
      const amount = parseFloat(match[2]);
      if (description.length > 3 && amount > 0) {
        items.push({ description, amount });
      }
    }
  }

  return items;
}

function parseInvoiceItemsFromChat(prompt = '') {
  return parseInvoiceItems(prompt);
}

function parseBookingIntent(prompt = '') {
  const lower = prompt.toLowerCase();
  const isBooking = /\b(book|schedule|set|add|create|put in|diary|remind|reminder|block out)\b/i.test(lower) &&
    /\b(in|a|an|me|reminder|appointment|inspection|soc|survey|visit|call|meeting|deadline)\b/i.test(lower);
  if (!isBooking) return null;

  // Extract task type
  let taskType = 'appointment';
  if (/schedule of condition|soc|inspection/i.test(lower)) taskType = 'soc';
  else if (/remind|reminder|call/i.test(lower)) taskType = 'reminder';
  else if (/deadline|due/i.test(lower)) taskType = 'deadline';
  else if (/site visit|visit/i.test(lower)) taskType = 'site_visit';
  else if (/meeting/i.test(lower)) taskType = 'meeting';

  // Extract date
  const dateMatch = prompt.match(/\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{4})?|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\b/i);
  const dayMatch = prompt.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);

  // Extract time
  const timeMatch = prompt.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)|(?:\d{1,2})(?::\d{2})?\s*(?:o'?clock))\b/i);

  // Extract project/address
  const projectMatch = prompt.match(/project\s+(?:is\s+)?([^,\.]+)|at\s+([^,\.]+(?:road|street|avenue|lane|close|way|drive|place|court|gardens?)[^,\.]*)/i);

  return {
    taskType,
    rawDate: dateMatch?.[0] || dayMatch?.[0] || '',
    rawTime: timeMatch?.[0] || '',
    rawProject: projectMatch?.[1] || projectMatch?.[2] || '',
    rawPrompt: prompt,
  };
}

async function createCalendarEntry({ taskType, title, dueDate, startTime, projectId, projectAddress, aoAddress, description, userId }) {
  const sb = getSupabase();
  if (!sb) throw new Error('No Supabase connection');

  const { data, error } = await sb.from('tasks').insert([{
    task_type: taskType,
    title,
    due_date: dueDate,
    start_time: startTime || null,
    project_id: projectId || null,
    project_address_snapshot: projectAddress || null,
    ao_address_snapshot: aoAddress || null,
    description: description || null,
    status: 'pending',
    user_id: userId || null,
    created_at: new Date().toISOString(),
  }]).select('*').single();

  if (error) throw error;
  return data;
}

function needsProjectContext(prompt = '') {
  const lower = String(prompt || '').toLowerCase();
  return lower.includes('notice') || lower.includes('award') || lower.includes('adjoining owner') ||
    lower.includes('building owner') || lower.includes('surveyor') || lower.includes('party wall') ||
    lower.includes('project') || lower.includes('fee') || lower.includes('schedule') ||
    lower.includes('soc') || lower.includes('who is') || lower.includes('what is the') ||
    lower.includes('address') || lower.includes('owner') || lower.includes('ref');
}

function isStatutoryQuestion(prompt = '') {
  const lower = String(prompt || '').toLowerCase();
  return /section\s*\d|s\.\s*\d|party wall act|party structure notice|counter notice|adjacent excavation|line of junction|section 1[^0-9]|section 2[^0-9]|section 3[^0-9]|section 4[^0-9]|section 5[^0-9]|section 6[^0-9]|section 7[^0-9]|section 8[^0-9]|section 9[^0-9]|section 10|section 11|section 12|section 13|section 14|section 15|section 16|section 20|does.*act|must.*notice|notice.*require|required.*notice|statutory requirement|what.*act say|under the act|pursuant to|underpin|safeguard.*foundation|foundation.*safeguard|dispute.*procedure|resolution.*dispute|expense.*act|right.*entry|service.*notice|notice.*service|definition|what is a party wall|what is a party fence|what is a party structure|agreed surveyor|third surveyor|award.*appeal|appeal.*award/i.test(lower);
}

async function lookupKnowledgeBase(prompt = '') {
  const sb = getSupabase();
  if (!sb) return null;

  try {
    // Detect which sections are relevant from the prompt
    const lower = prompt.toLowerCase();
    const sectionMatches = [];

    // Direct section references
    const sectionNums = [...lower.matchAll(/section\s*(\d+)/g)].map(m => `s${m[1]}`);
    sectionMatches.push(...sectionNums);

    // Topic-based matches
    if (/adjacent excavation|excavat|3 metre|6 metre|underpin|safeguard.*found|foundation.*safeguard/.test(lower)) sectionMatches.push('s6');
    if (/party structure notice|s\.?\s*3\b|section 3/.test(lower)) sectionMatches.push('s3');
    if (/counter notice|s\.?\s*4\b|section 4/.test(lower)) sectionMatches.push('s4');
    if (/dispute|resolution|agreed surveyor|third surveyor|award|ex parte/.test(lower)) sectionMatches.push('s10');
    if (/line of junction|new.*wall.*boundary|s\.?\s*1\b/.test(lower)) sectionMatches.push('s1');
    if (/rights.*owner|repair.*party wall|s\.?\s*2\b/.test(lower)) sectionMatches.push('s2');
    if (/compensation|inconvenience|loss.*damage|special foundation/.test(lower)) sectionMatches.push('s7');
    if (/expens|cost.*act|who.*pay/.test(lower)) sectionMatches.push('s11');
    if (/right.*entry|access.*surveyor|enter.*premises/.test(lower)) sectionMatches.push('s8');
    if (/easement|light|right.*light/.test(lower)) sectionMatches.push('s9');
    if (/service.*notice|how.*serve|email.*notice|electronic/.test(lower)) sectionMatches.push('s15');
    if (/definition|what is a party wall|party fence wall|party structure|building owner|adjoining owner|special foundation/.test(lower)) sectionMatches.push('s20');

    // Deduplicate
    const refs = [...new Set(sectionMatches)];
    if (!refs.length) {
      // Fall back to full-text search
      const { data } = await sb
        .from('knowledge_base')
        .select('section_ref, title, statutory_text, practice_notes')
        .or(`statutory_text.ilike.%${prompt.slice(0, 50)}%,title.ilike.%${prompt.slice(0, 50)}%`)
        .limit(3);
      return data?.length ? data : null;
    }

    const { data } = await sb
      .from('knowledge_base')
      .select('section_ref, title, statutory_text, practice_notes')
      .in('section_ref', refs.slice(0, 4));

    return data?.length ? data : null;
  } catch (err) {
    console.warn('[ely-smart] knowledge base lookup failed:', err.message);
    return null;
  }
}

// ── Background embed trigger — non-blocking ─────────────────────────────
async function triggerEmbed(table, recordId) {
  try {
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://nora-d9wy.vercel.app';
    // Fire and forget — don't await
    fetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'embed_record', table, record_id: recordId }),
    }).catch(() => {}); // silent fail
  } catch {}
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
        .select('subject, sender_email, sender_name, sent_at, body, folder, is_sent')
        .eq('project_id', projectId)
        .order('sent_at', { ascending: true });
      allEmails = (data || []).map(e => ({
        date: e.sent_at ? new Date(e.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
        direction: e.is_sent ? 'Sent' : 'Received',
        from: e.sender_name || e.sender_email || '',
        subject: e.subject || '',
        body: (e.body || '').slice(0, 3000),
      }));
    } catch (err) {
      console.warn('[ely-smart] case review email load error:', err.message);
    }
  }

  // Load project chat messages from ai_messages — this is where project chat lives
  let allBrain = [];
  if (sb && projectId) {
    try {
      const { data } = await sb
        .from('ai_messages')
        .select('role, content, created_at, surface')
        .eq('project_id', projectId)
        .eq('surface', 'project_chat')
        .order('created_at', { ascending: true });
      allBrain = (data || []).map(m => ({
        date: m.created_at ? new Date(m.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
        type: m.role === 'user' ? 'Surveyor note' : 'Ely response',
        content: (m.content || '').slice(0, 2000),
      }));
    } catch (err) {
      console.warn('[ely-smart] case review chat load error:', err.message);
    }
  }

  // Filter emails by topic keywords to reduce payload — keep most relevant
  const topicWords = (topic || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const filterRelevant = (items, contentKey) => {
    if (!topicWords.length) return items;
    const scored = items.map(item => {
      const text = (item[contentKey] || item.subject || item.content || '').toLowerCase();
      const score = topicWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
      return { ...item, _score: score };
    });
    const relevant = scored.filter(i => i._score > 0).sort((a, b) => b._score - a._score);
    const rest = scored.filter(i => i._score === 0);
    return [...relevant, ...rest];
  };

  const filteredEmails = filterRelevant(allEmails, 'body').slice(0, 40);
  const filteredBrain = filterRelevant(allBrain, 'content').slice(0, 80);

  const emailsText = filteredEmails.length
    ? filteredEmails.map(e => `[${e.date}] ${e.direction} — From: ${e.from}\nSubject: ${e.subject}\n${e.body}`).join('\n\n---\n\n')
    : 'No emails found.';

  const brainText = filteredBrain.length
    ? filteredBrain.map(m => `[${m.date}] ${m.type}: ${m.content}`).join('\n\n')
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


// ── Unknown proper noun checker ───────────────────────────────────────────────
// When modeHint is draft, scan the user prompt for proper nouns that don't
// appear anywhere in the known context. If found, return a clarification
// question instead of drafting.

function extractProperNouns(text = '') {
  if (!text) return [];
  // Match capitalised words that are NOT at the start of a sentence
  // and NOT common party wall / professional terms
  const commonWords = new Set([
    'I', 'The', 'This', 'That', 'These', 'Those', 'We', 'You', 'He', 'She',
    'They', 'It', 'My', 'Your', 'Our', 'His', 'Her', 'Its', 'Their',
    'Party', 'Wall', 'Act', 'Award', 'Notice', 'SOC', 'LOA', 'BO', 'AO',
    'Building', 'Owner', 'Adjoining', 'Surveyor', 'Engineer', 'Section',
    'Schedule', 'Condition', 'Draft', 'Email', 'Letter', 'Reply',
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December',
    'Square', 'One', 'Consulting', 'Itzik', 'Nora', 'Ely',
    'London', 'Road', 'Street', 'Avenue', 'Close', 'Lane', 'Drive',
    'Ltd', 'Limited', 'LLP', 'PLC', 'Inc',
    'Hi', 'Dear', 'Kind', 'Regards', 'Thank', 'Thanks', 'Please',
    'Perfect', 'Great', 'Good', 'OK', 'Yes', 'No',
    'As', 'In', 'On', 'At', 'To', 'For', 'Of', 'With', 'By', 'From',
    'And', 'Or', 'But', 'So', 'If', 'When', 'Once', 'After', 'Before',
  ]);

  // Strip possessives before extracting — "Shashi's" becomes "Shashi"
  const words = text.replace(/'s\b/g, '').replace(/[^a-zA-Z\s'-]/g, ' ').split(/\s+/);
  const nouns = [];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    // Must be capitalised, 3+ chars, not in common list, not all caps (abbreviation)
    if (
      word.length >= 3 &&
      /^[A-Z][a-z]+/.test(word) &&
      !commonWords.has(word) &&
      !/^[A-Z]{2,}$/.test(word)
    ) {
      nouns.push(word);
    }
  }

  return [...new Set(nouns)];
}

function buildKnownNounSet(projectBundle = null, emailContext = null, chatHistory = []) {
  const known = new Set();

  // From project data
  if (projectBundle?.project) {
    const p = projectBundle.project;
    const fields = [
      p.name, p.bo_1_name, p.bo_2_name, p.ao_client_name,
      p.bos_name, p.bos_firm, p.bo_company, p.bo, p.ref,
    ];
    fields.forEach(f => {
      if (f) String(f).split(/\s+/).forEach(w => known.add(w));
    });
  }

  // From adjoining owners
  if (projectBundle?.adjoining_owners) {
    projectBundle.adjoining_owners.forEach(ao => {
      [ao.name, ao.surveyor_name, ao.surveyor_firm, ao.address].forEach(f => {
        if (f) String(f).split(/\s+/).forEach(w => known.add(w));
      });
    });
  }

  // From email context
  if (emailContext) {
    [emailContext.from, emailContext.sender_name, emailContext.from_email,
     emailContext.subject, emailContext.body, emailContext.threadText].forEach(f => {
      if (f) String(f)
        .replace(/<[^>]+>/g, ' ')  // strip email angle brackets
        .replace(/[^a-zA-Z\s]/g, ' ')  // strip punctuation
        .split(/\s+/)
        .filter(w => w.length > 1)
        .forEach(w => known.add(w));
    });
  }

  // From chat history
  chatHistory.forEach(m => {
    if (m.content) String(m.content).split(/\s+/).forEach(w => known.add(w));
  });

  return known;
}

function findUnknownNouns(prompt = '', knownNouns = new Set()) {
  const candidates = extractProperNouns(prompt);
  return candidates.filter(noun => {
    // Check if this word (or a close match) appears in the known set
    // Strip possessives from both sides before comparing
    const lc = noun.replace(/'s$/i, '').toLowerCase();
    for (const known of knownNouns) {
      const klc = String(known).replace(/'s$/i, '').toLowerCase();
      if (klc.includes(lc) || lc.includes(klc)) {
        return false;
      }
    }
    return true;
  });
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

    // ── Silent read fast path ────────────────────────────────────────────────
    // Bypass all classifiers, booking flow, brain loading and system prompt overhead.
    // Just send the thread to GPT and return the raw response.
    if (body.isSilentRead || body.mode === 'silent_read') {
      const emailCtx = body.emailContext || {};
      const threadContent = emailCtx.threadText || emailCtx.body || body.prompt || '';

      const { default: OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const silentResult = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 150,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `You are Ely, an AI assistant for Itzik Darel / Square One Consulting (help@sq1consulting.co.uk). 
Read the email thread provided. Identify participants, tone, history and any escalation DIRECTED AT ITZIK specifically.
Only flag if there is something directed at Itzik that warrants attention.
If flagging: respond with "Flag: [one short sentence]".
If no flag needed: respond with the single word "Ready."
Never summarise. Never explain. Never ask questions.`,
          },
          {
            role: 'user',
            content: body.prompt || `Read this thread:\n\n${threadContent}`,
          },
        ],
      });

      const silentReply = silentResult.choices?.[0]?.message?.content?.trim() || 'Ready.';
      return res.status(200).json({ reply: silentReply, replyText: silentReply });
    }

    const modeHint = inferModeHint(body.surface, body.prompt, body);
    const prompt = String(body.prompt || '').trim();
    const isDraftWithEly = String(body.mode || body.workflowStage || '').toLowerCase().includes('draft_with_ely');

    // ── Case review confirmation ──────────────────────────────────────────
    if (body.case_review_confirmed && body.case_review_topic && projectId) {

      // Call dedicated case-review endpoint — has maxDuration: 300, no timeout risk
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      let findings = '';
      try {
        const crRes = await fetch(`${baseUrl}/api/case-review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'start',
            project_id: projectId,
            topic: body.case_review_topic,
          }),
        });
        const crData = await crRes.json();
        findings = crData.result || `Case review encountered an error: ${crData.error || 'Unknown error'}`;
      } catch (err) {
        findings = `Case review encountered an error: ${err.message}`;
      }

      // Return findings to GPT-4o to present
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_completion_tokens: 3500,
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

    if (detectsCaseReview(prompt) && !projectId) {
      return res.status(200).json({
        reply: `I can pull the project notes but I need to know which project you're working on. Can you give me the project reference or address?`,
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
    const isMainChat = body.surface === 'main_chat';
    const isProjectChat = body.surface === 'project_chat';
    const canBook = isMainChat || isProjectChat;

    // ── Calendar booking flow ─────────────────────────────────────────────
    // NEVER intercept if modeHint is draft — draft always wins over booking
    // If user is confirming a pending booking, create the entry
    // ── Invoice generation confirm ────────────────────────────────────────
    if (body.pending_invoice_confirm && body.pending_invoice) {
      const inv = body.pending_invoice;
      try {
        // Save the invoice to Supabase
        const { createClient } = await import('@supabase/supabase-js');
        const sbInv = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

        // Get next invoice number
        const { data: existingInvoices } = await sbInv.from('invoices').select('invoice_number').order('invoice_number', { ascending: false }).limit(1);
        const nextNum = existingInvoices?.[0]?.invoice_number ? existingInvoices[0].invoice_number + 1 : 1601;

        const subtotal = inv.items.reduce((s, i) => s + (parseFloat(i.total || i.amount || 0)), 0);
        const invoiceRecord = {
          invoice_number: nextNum,
          invoice_date: new Date().toISOString().split('T')[0],
          status: 'unpaid',
          bill_to_name: inv.bill_to_name,
          bill_to_address: inv.bill_to_address,
          property_address: inv.property_address,
          project_id: projectId || null,
          items: inv.items,
          subtotal,
          vat_rate: 0,
          vat_amount: 0,
          total: subtotal,
        };

        const { data: savedInvoice, error: saveErr } = await sbInv.from('invoices').insert(invoiceRecord).select().single();
        if (saveErr) throw new Error(saveErr.message);

        // Generate PDF
        const pdfRes = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/generate-invoice-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoice: savedInvoice, invoice_id: savedInvoice.id, project_id: projectId, user_id: 'help@sq1consulting.co.uk' }),
        });

        const pdfData = await pdfRes.json().catch(() => ({}));
        if (!pdfRes.ok || !pdfData.base64) throw new Error(pdfData.error || 'PDF generation failed');

        return res.status(200).json({
          reply: `✅ Invoice ${nextNum} generated for £${subtotal.toFixed(2)}.`,
          invoice_generated: true,
          invoice: savedInvoice,
          invoice_pdf_base64: pdfData.base64,
          invoice_file_name: pdfData.file_name || `Invoice-${nextNum}.pdf`,
          invoice_storage_path: pdfData.storage_path,
          sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });
      } catch (invErr) {
        return res.status(200).json({
          reply: `Sorry, I couldn't generate the invoice: ${invErr.message}. Please try again or use the invoice screen.`,
          sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });
      }
    }

    // ── Invoice intent detection (project_chat surface only) ─────────────
    if (body.surface === 'project_chat' && !body.pending_invoice_confirm) {
      const rawPrompt = String(body.prompt || '').trim();

      if (detectsInvoiceGenerate(rawPrompt) && body.pending_invoice) {
        // User said "generate it" — confirm with them before generating
        const inv = body.pending_invoice;
        const total = inv.items.reduce((s, i) => s + (parseFloat(i.total || i.amount || 0)), 0);
        const itemLines = inv.items.map(i => `• ${i.description} — £${parseFloat(i.total || i.amount || 0).toFixed(2)}`).join('\n');
        return res.status(200).json({
          reply: `Ready to generate the invoice.\n\n${itemLines}\n\n**Total: £${total.toFixed(2)}**\n\nSending to: ${inv.bill_to_name} (${inv.bo_email || 'email not on file'})\n\nConfirm?`,
          pending_invoice: inv,
          pending_invoice_confirm: true,
          sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });
      }
    }

        if (!['draft', 'review'].includes(modeHint) && body.pending_booking_confirm && body.pending_booking) {
      try {
        const booking = body.pending_booking;
        await createCalendarEntry({
          taskType: booking.taskType,
          title: booking.title,
          dueDate: booking.dueDate,
          startTime: booking.startTime,
          projectId: booking.projectId,
          projectAddress: booking.projectAddress,
          aoAddress: booking.aoAddress,
          description: booking.description,
          userId,
        });
        return res.status(200).json({
          reply: `✅ Done — booked in:\n\n**${booking.title}**\n📅 ${booking.displayDate}${booking.startTime ? ' at ' + booking.startTime : ''}${booking.projectAddress ? '\n📍 ' + booking.projectAddress : ''}`,
          booking_created: true,
          sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });
      } catch (err) {
        console.error('[ely-smart] booking creation failed:', err.message);
        return res.status(200).json({
          reply: `Sorry, I couldn't save that to the calendar — ${err.message}. Please try adding it manually.`,
          sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });
      }
    }

    // ── Detect new booking intent ─────────────────────────────────────────
    const bookingIntent = canBook && !['draft', 'review'].includes(modeHint) ? parseBookingIntent(prompt) : null;    if (bookingIntent && (bookingIntent.rawDate || bookingIntent.rawProject)) {
      // Build a confirmation prompt for GPT to flesh out the details
      const taskTypeLabels = {
        soc: 'Schedule of Condition',
        reminder: 'Reminder',
        deadline: 'Deadline',
        site_visit: 'Site Visit',
        meeting: 'Meeting',
        appointment: 'Appointment',
      };

      const systemMsg = `You are Ely, a party wall surveying assistant. The user wants to book something in the calendar.

Extract the following from their message and confirm back clearly:
1. Task type (Schedule of Condition / Reminder / Deadline / Site Visit / Meeting / Appointment)
2. Date and time
3. Project/address if mentioned
4. Any other relevant details

If the task type is unclear, list the options and ask which one.
If the date is unclear, ask for clarification.

Format your response EXACTLY like this:
Here's what I'll book in:

📋 **[Task Type]**
📅 **[Date and time]**
📍 **[Address/project if known]**
📝 **[Any other details]**

Shall I confirm? (Say yes or no)

IMPORTANT: Include at the very end of your response, on its own line, this JSON block wrapped in |||:
|||{"taskType":"[type]","title":"[title]","dueDate":"[YYYY-MM-DD or null]","startTime":"[HH:MM or null]","projectAddress":"[address or null]","displayDate":"[human readable date]"}|||`;

      const bookingMessages = [
        { role: 'system', content: systemMsg },
        { role: 'user', content: prompt },
      ];

      const bookingResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o', max_completion_tokens: 600, temperature: 0.2, messages: bookingMessages }),
      });

      const bookingData = await bookingResponse.json();
      const bookingReply = bookingData.choices?.[0]?.message?.content || '';

      // Extract the JSON blob
      const jsonMatch = bookingReply.match(/\|\|\|(.*?)\|\|\|/s);
      let pendingBooking = null;
      let cleanReply = bookingReply.replace(/\|\|\|.*?\|\|\|/s, '').trim();

      if (jsonMatch) {
        try {
          pendingBooking = JSON.parse(jsonMatch[1]);
        } catch { /* ignore parse error */ }
      }

      return res.status(200).json({
        reply: cleanReply,
        pending_booking: pendingBooking,
        awaiting_booking_confirm: true,
        sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
    }

    // ── General inbox search for main chat ────────────────────────────────
    // When user asks about appointments, meetings, or specific people in main
    // chat with no email selected — search inbox automatically, no linking needed
    let generalInboxResults = [];
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

    // ── Calendar search ──────────────────────────────────────────────────
    // When asking about appointments/dates, check the tasks/calendar table too
    let calendarResults = [];
    if (asksAboutInbox) {
      try {
        const sb = getSupabase();
        if (sb) {
          const dayMatch = prompt.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|this week|next week)\b/i);
          const dayTerm = dayMatch ? dayMatch[0].toLowerCase() : '';

          // Calculate date range based on day mentioned
          const now = new Date();
          let dateFrom = null;
          let dateTo = null;

          if (dayTerm === 'today') {
            dateFrom = now.toISOString().slice(0, 10);
            dateTo = dateFrom;
          } else if (dayTerm === 'tomorrow') {
            const tom = new Date(now);
            tom.setDate(tom.getDate() + 1);
            dateFrom = tom.toISOString().slice(0, 10);
            dateTo = dateFrom;
          } else if (dayTerm === 'this week') {
            dateFrom = now.toISOString().slice(0, 10);
            const end = new Date(now);
            end.setDate(end.getDate() + 7);
            dateTo = end.toISOString().slice(0, 10);
          } else if (dayTerm === 'next week') {
            const start = new Date(now);
            start.setDate(start.getDate() + 7);
            const end = new Date(start);
            end.setDate(end.getDate() + 7);
            dateFrom = start.toISOString().slice(0, 10);
            dateTo = end.toISOString().slice(0, 10);
          } else if (dayTerm) {
            // Find the next occurrence of the named day
            const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
            const targetDay = days.indexOf(dayTerm);
            if (targetDay >= 0) {
              const date = new Date(now);
              const currentDay = date.getDay();
              let daysUntil = targetDay - currentDay;
              if (daysUntil <= 0) daysUntil += 7;
              date.setDate(date.getDate() + daysUntil);
              dateFrom = date.toISOString().slice(0, 10);
              dateTo = dateFrom;
            }
          } else {
            // No specific day — search next 14 days
            dateFrom = now.toISOString().slice(0, 10);
            const end = new Date(now);
            end.setDate(end.getDate() + 14);
            dateTo = end.toISOString().slice(0, 10);
          }

          let query = sb
            .from('tasks')
            .select('title, description, due_date, start_time, project_address_snapshot, ao_address_snapshot, task_type, status')
            .neq('status', 'completed')
            .order('due_date', { ascending: true })
            .limit(10);

          if (dateFrom) query = query.gte('due_date', dateFrom);
          if (dateTo) query = query.lte('due_date', dateTo);

          const { data } = await query;
          calendarResults = (data || []).map(t => ({
            title: t.title || t.task_type || 'Appointment',
            date: t.due_date ? new Date(t.due_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }) : '',
            time: t.start_time || '',
            address: t.project_address_snapshot || t.ao_address_snapshot || '',
            description: t.description || '',
            status: t.status || '',
          }));
        }
      } catch (err) {
        console.warn('[ely-smart] calendar search failed:', err.message);
      }
    }
    // Never load everything on every call. Fetch each piece only if relevant.

    const hasSuppliedEmail = !!suppliedEmailContext || !!body.threadId || !!body.emailId;
    const needsEmails = hasSuppliedEmail || wantsEmailContext(prompt, projectId, suppliedEmailContext, body.threadId, body.emailId);
    const needsProject = needsProjectContext(prompt);
    const needsBrain = true; // always load brain — instruction set must be available on all surfaces regardless of project

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


        const systemPrompt = await buildSystemPrompt({
      brain,
      projectId,
      resolvedProject,
      projectBundle, // always pass full bundle — Claude brief is injected separately after
      scopedEmailContext,
      modeHint,
      draftingExamples,
      userPrompt: prompt,
    });

    const messages = await buildMessages({ body, systemPrompt, scopedEmailContext, modeHint });

    // Recipient-change override — inject targeted instruction immediately before user message
    // when the prompt is a recipient redirect and there is an existing draft in history
    const isRecipientChange =
      /\baddress (it|this|the (letter|email|draft)) to\b/i.test(prompt) ||
      /\blet'?s address (it|this) to\b/i.test(prompt) ||
      /\bchange the recipient to\b/i.test(prompt) ||
      /\brewrite (it|the (letter|email|draft)) for\b/i.test(prompt) ||
      /\bsend (it|this|the (letter|email|draft)) to\b/i.test(prompt);

    const hasPriorDraft = (body.chatHistory || []).some(m =>
      m.role === 'assistant' && m.content && m.content.length > 200
    );

    if (isRecipientChange && hasPriorDraft && modeHint === 'draft') {
      // Insert override just before the final user message
      const lastUserIdx = messages.map(m => m.role).lastIndexOf('user');
      if (lastUserIdx !== -1) {
        messages.splice(lastUserIdx, 0, {
          role: 'user',
          content: 'RECIPIENT CHANGE — FULL REDRAFT REQUIRED\n\nThe recipient has now been identified or changed. Do not simply update the salutation or closing. Reassess the entire draft for this recipient: their role, what they already know, what background is now redundant, and how directly you can open. Remove any introductory wording that would only be needed for a new or uninvolved recipient. The revised letter must read as though it was originally written for this person. Apply the RECIPIENT-AWARE REDRAFTING and ONGOING PROFESSIONAL CORRESPONDENCE rules in full.'
        }, {
          role: 'assistant',
          content: 'Understood. I will fully reassess the draft for this recipient, removing redundant background and rewriting the opening and structure accordingly.'
        });
      }
    }

    // ── Knowledge base lookup for statutory questions ─────────────────────
    if (isStatutoryQuestion(prompt)) {
      try {
        const kbResults = await lookupKnowledgeBase(prompt);
        if (kbResults?.length) {
          const kbText = kbResults.map(r =>
            `${r.title}\n\nSTATUTORY TEXT:\n${r.statutory_text}${r.practice_notes ? `\n\nPRACTICE NOTES:\n${r.practice_notes}` : ''}`
          ).join('\n\n---\n\n');

          messages.splice(1, 0, {
            role: 'system',
            content: `AUTHORITATIVE STATUTORY REFERENCE — Party Wall etc. Act 1996:\n\nThe following is the exact statutory text from legislation.gov.uk. Answer the user''s question from this text. Do not rely on general knowledge where the Act text is provided here.\n\n${kbText}`,
          });
        }
      } catch (err) {
        console.warn('[ely-smart] knowledge base injection failed:', err.message);
      }
    }

    // Inject general inbox search results if we ran one
    if (generalInboxResults.length > 0 || calendarResults.length > 0) {
      let contextBlock = '';

      if (calendarResults.length > 0) {
        contextBlock += `DIARY/CALENDAR — appointments found:\n\n${calendarResults.map(e =>
          `${e.date}${e.time ? ' at ' + e.time : ''}: ${e.title}${e.address ? ' — ' + e.address : ''}${e.description ? '\n' + e.description : ''}`
        ).join('\n\n')}\n\n`;
      } else if (asksAboutInbox) {
        contextBlock += `DIARY/CALENDAR — no appointments found in the requested period.\n\n`;
      }

      if (generalInboxResults.length > 0) {
        contextBlock += `INBOX SEARCH — emails matching the query:\n\n${generalInboxResults.map(e =>
          `From: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\n${e.body}`
        ).join('\n\n---\n\n')}`;
      } else if (asksAboutInbox) {
        contextBlock += `INBOX SEARCH — no matching emails found.`;
      }

      if (contextBlock.trim()) {
        messages.splice(1, 0, {
          role: 'system',
          content: `Use the following diary and email information to answer the user's question accurately. Cross-reference both. If an appointment appears in emails but not the diary, say so explicitly.\n\n${contextBlock}`,
        });
      }
    } else if (asksAboutInbox) {
      messages.splice(1, 0, {
        role: 'system',
        content: `INBOX AND DIARY SEARCH: Both were searched but nothing matching was found. Tell the user honestly that you checked both the diary and emails and couldn't find anything matching their query.`,
      });
    }

    console.log(
      `[ely-smart] project=${projectId || 'none'} emails=${scopedEmailContext?.length || 0} suppliedEmail=${suppliedEmailContext ? 'yes' : 'no'} aos=${projectBundle?.adjoining_owners?.length || 0} mode=${modeHint}`
    );

    const temperature = modeHint === 'draft' ? 0.62 : 0.35;
    // HARDCODED — do not restore env var override. ELY_MAIN_CHAT_MODEL was silently set to gpt-5.4
    // in Vercel env vars and degraded every response. gpt-4o for everything.
    const activeModel = 'gpt-4o';
    const isReasoningModel = false;

    const modelPayload = isReasoningModel
      ? {
          model: activeModel,
          max_completion_tokens: 3500,
          reasoning_effort: isDraftWithEly ? 'medium' : 'low',
        }
      : {
          model: activeModel,
          max_completion_tokens: 3500,
          temperature,
        };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        ...modelPayload,
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

      // Model not available — fall back to gpt-4o
      if (errMsg.toLowerCase().includes('model') && (errMsg.toLowerCase().includes('not found') || errMsg.toLowerCase().includes('does not exist') || errMsg.toLowerCase().includes('invalid'))) {
        console.log('[ely-smart] Model not available, falling back to gpt-4o');
        const fallbackResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
          body: JSON.stringify({ model: 'gpt-4o', max_completion_tokens: 3500, temperature, messages }),
        });
        if (!fallbackResponse.ok) throw new Error(errMsg);
        const fallbackData = await fallbackResponse.json();
        const fallbackReply = cleanOutput(fallbackData.choices?.[0]?.message?.content || '');
        return res.status(200).json({ reply: fallbackReply, resolvedProject, model: 'gpt-4o', sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
      }

      throw new Error(errMsg);
    }

    const data = await response.json();
    const fullReply = cleanOutput(data.choices?.[0]?.message?.content || '');
    const modelUsed = data.model || 'gpt-5.4-mini';
    console.log('[ely-smart] responded with model:', modelUsed);

    // ── Draft With Ely: missing points analysis ───────────────────────────
    // Disabled: running this synchronously was causing mobile connection drops
    // on long drafts. Will re-enable as async when architecture supports it.
    const isDraftWithElyMP = String(body.mode || body.workflowStage || '').toLowerCase().includes('draft_with_ely');
    const missingPoints = [];

    return res.status(200).json({
      reply: fullReply,
      ...(isDraftWithEly && missingPoints.length > 0 ? { missing_points: missingPoints } : {}),
      model: modelUsed,
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



















