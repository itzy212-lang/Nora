// api/ely-smart.js
// Ely/Nora smart route - project-hydrated collaboration version
// Global behaviour: analyse first, draft only when clearly requested.

import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
// PHASE V2 — isolated architecture path. V1's brain-content rows and its
// own buildSystemPrompt()/buildMessages() below are never modified by this
// import or by anything V2 does. See docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md.
import { resolveArchitectureVersion, buildDiagnosticsEnvelope } from './lib/v2-operating-system.js';
import { resolveEffectiveVoice, buildGoldStandardBlock } from './lib/v2-voice-resolution.js';
import { assembleWorkingMemory, extractConfirmedProjectAnchors, extractCurrentDraftState, extractProjectMemory, buildStructuredProjectFacts, identifyDiscussedEmail, splitSemanticResults, excludeExistingIds, filterByMatchedAnchor } from './lib/v2-working-memory.js';
import { assembleV2Prompt, splitDraftFromCommentary } from './lib/v2-prompt-assembly.js';
// PHASE 2A — Stage 1 strategic reasoning modules (Phase 1 deliverables, unmodified).
import { buildStage1Context } from './lib/stage1-context.js';
import { validateBriefShape } from './lib/stage1-schema.js';
import { applyDependencyValidation } from './lib/stage1-dependency-graph.js';
import { resolveStage1State, computeBriefForInjection, STAGE1_STATE } from './lib/stage1-state.js';
// Note: computeBriefForInjection is imported but not currently called in
// this file — retained per instruction for Phase 3 promotion wiring. Its
// own correctness is already exhaustively covered by Phase 1's test suite
// (stage1-state.test.js) and re-exercised directly in
// phase2a-preflight-caller-flow.test.js in this change.

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

// Added 2026-08-21, real, serious fix — replacing the prompt-only
// approach that failed live: asked to nominate real contacts, the AI
// invented a wrong surname entirely and altered every qualification.
// A prompt instruction alone can't guarantee reliability — this is a
// genuine lookup, so it's now enforced as one: after the AI drafts
// its reply (using whatever short, dictated, or misspelled version
// of a name it wrote, e.g. 'Steven Cornich' for the stored 'Stephen
// Cornish'), every contact's short name is matched by surname
// (case-insensitive, tolerant of common first-name spelling
// variants) and swapped for the exact, full stored name — letters,
// qualifications, and all. This runs in code, not in the model's
// judgement, so it can't be skipped or paraphrased away.
function shortNameFor(fullName = '') {
  // Real contact name formats seen: 'Stephen Cornish, PhD MA...',
  // 'Maurice Ndirika - FFPWS...', 'Alex M. Frame MSc, FRICS...' — the
  // person's actual name ends at the first comma/dash, or before the
  // first all-caps qualification-looking token (2+ capital letters,
  // e.g. 'MSc', 'FRICS').
  const cut = fullName.search(/,| -\s|\s+[A-Z]{2,}/);
  const raw = (cut > 0 ? fullName.slice(0, cut) : fullName).trim();
  const words = raw.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return { first: words[0], surname: words[words.length - 1], words };
}

function applyContactCorrections(text, contactsContext) {
  if (!text || !Array.isArray(contactsContext) || !contactsContext.length) return text;
  let result = text;
  const shorts = contactsContext
    .filter(c => c?.name && !c.__fetch_error)
    .map(c => ({ c, short: shortNameFor(c.name) }))
    .filter(x => x.short);

  // Full 'Firstname Surname' matches first (more specific, so they
  // take priority over the bare-first-name pass below).
  for (const { c, short } of shorts) {
    if (short.surname.length < 4) continue; // too short a surname risks false matches
    // Fixed while building this: real example seen live was 'Steven
    // Cornich' for the stored 'Stephen Cornish' — the surname itself
    // was also misheard/misspelled, not just the first name. Exact
    // surname matching would have missed this. Matches on the first
    // 4 letters of the surname instead — real name variants and
    // dictation errors almost always preserve the start of a word —
    // tolerating the rest differing, while still being distinctive
    // enough with a 4+ letter anchor to avoid false positives.
    const surnameStem = short.surname.slice(0, 4).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Fixed 2026-08-31, real, severe, confirmed bug reported live:
    // this originally accepted ANY capitalized first name before a
    // matching surname stem, not specifically a variant of this
    // contact's own first name — so a genuinely different person
    // sharing only a surname (a real, live example: 'Shaw Kelly', a
    // barrister the user actually knows, repeatedly and silently
    // overwritten with the stored contact 'John Kelly', despite
    // direct, repeated correction — the user was never actually
    // fighting the AI's output, but this exact function running
    // afterward). Now also requires the matched first name to share
    // the stored contact's own first-name stem (first 3 letters),
    // the same tolerance-for-variants approach already used for the
    // surname, applied to the first name too — 'Steven' still
    // matches 'Stephen' (both start 'Ste'), but 'Shaw' no longer
    // matches 'John' at all.
    const firstNameStem = short.first.slice(0, 3).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b(${firstNameStem}[a-zA-Z]*)(?:\\s+[A-Z][a-zA-Z.]*)?\\s+${surnameStem}[a-zA-Z]*\\b(?!\\s*[,-]?\\s*[A-Z]{2,})`, 'g');
    result = result.replace(re, (match) => (match === c.name ? match : c.name));
  }

  // Fixed 2026-08-25, real, serious regression reported live: this
  // bare-first-name pass was built narrowly for third-surveyor
  // nomination text ('Maurice' alone resolving to the full stored
  // name), but it applied unconditionally to EVERY bare first name
  // anywhere in a draft — including plain email greetings. 'Hi
  // David,' was being rewritten to 'Hi David Vizard AssocRICS
  // MFPWS,' since 'David' is unique among contacts, exactly the
  // condition this pass required. The harm (every casual greeting
  // broken) far outweighs the narrow benefit this was built for.
  // Removed entirely — the full 'Firstname Surname' pass above still
  // catches genuine nomination-style mentions, which almost always
  // include a surname-like word nearby; a truly bare first name is
  // now left exactly as the AI wrote it.

  return result;
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

// Verify bearer token server-side and return the authenticated UUID.
// Returns null if token is missing, invalid or expired.
// Never trusts the request body for identity.
async function verifyBearerToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  const sb = getSupabase();
  if (!sb) return null;

  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user?.id) return null;
  return user.id;
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

FEE QUOTING RULE — CRITICAL — ACT IMMEDIATELY:
Square One Consulting standard fees are: notice=£107 per adjoining owner, soc=£500 per property, agreed_surveyor=£950, separate=£950.
If the user asks for a fee quote, fee proposal, quote, or mentions sending a quote to anyone — output the FEE_AGREED tag ON YOUR VERY FIRST RESPONSE. Do not ask clarifying questions first. Do not wait. Generate it immediately.
End your message with this tag on its own line:
FEE_AGREED: notice=107, soc=500, agreed_surveyor=950, separate=950
If the number of adjoining owners is known, include it: FEE_AGREED: notice=107, soc=500, agreed_surveyor=950, separate=950, num_aos=2
The tag auto-generates the PDF — output it on the first response when any fee quote is requested.
Tell the user you are generating the quote in your message.

SUBJECT LINE — ADJOINING OWNER REFERENCE:
The default email subject already includes the Building Owner's property address — do not include the project reference number in the subject under any circumstances, it has no meaning to the recipient.
If the user's message in this conversation makes clear that the email or draft specifically concerns one or more adjoining owners (e.g. "this is for the AO at number 6", "relating to the adjoining owner at 8 Park Avenue", "for both AOs"), end your message with a structured tag on its own line:
AO_SUBJECT_REF: 6 Park Avenue
or, for more than one:
AO_SUBJECT_REF: 8 Park Avenue, 6 Park Avenue
List the full address of each relevant adjoining owner exactly as known from the project context, separated by a comma if there is more than one. Do not include this tag unless the user has specifically indicated the correspondence relates to one or more named adjoining owners.
`;


function normaliseRepresentationRole(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (/agreed|both|joint/.test(raw)) return 'AGREED_SURVEYOR';
  if (/\bao\b|adjoining|neighbour|neighbor/.test(raw)) return 'AO_SURVEYOR';
  if (/\bbo\b|building|owner/.test(raw)) return 'BO_SURVEYOR';
  return '';
}

function representationLabel(role = '') {
  if (role === 'AO_SURVEYOR') return 'Adjoining Owner surveyor';
  if (role === 'AGREED_SURVEYOR') return 'Agreed Surveyor';
  return 'Building Owner surveyor';
}

function resolveRuntimeProject(body = {}) {
  return body.currentProject || body.project || body.context?.currentProject || body.context?.project || null;
}

function buildRuntimeAoContext(body = {}, projectBundle = null) {
  const runtimeProject = resolveRuntimeProject(body) || {};
  const selectedAO = body.selectedAO || body.selected_ao || body.context?.selectedAO || body.context?.selected_ao || runtimeProject.selectedAO || runtimeProject.selected_ao || null;
  const runtimeAos = Array.isArray(runtimeProject.aos) ? runtimeProject.aos : [];
  const bundleAos = Array.isArray(projectBundle?.adjoining_owners) ? projectBundle.adjoining_owners : [];
  return { selectedAO, aos: bundleAos.length ? bundleAos : runtimeAos };
}

function resolveRepresentation({ body = {}, projectBundle = null } = {}) {
  const runtimeProject = resolveRuntimeProject(body) || {};
  const project = projectBundle?.project_raw || projectBundle?.project || runtimeProject || {};
  const role = normaliseRepresentationRole(firstNonEmpty(
    body.representation,
    body.representationRole,
    body.context?.representation,
    body.context?.representationRole,
    runtimeProject.role,
    runtimeProject.appointment_role,
    runtimeProject.surveyor_role,
    project.role,
    project.appointment_role,
    project.surveyor_role
  )) || 'BO_SURVEYOR';

  const aoContext = buildRuntimeAoContext(body, projectBundle);
  return {
    role,
    label: representationLabel(role),
    source: projectBundle?.project_raw ? 'linked project' : 'runtime project',
    selectedAO: aoContext.selectedAO,
    aos: aoContext.aos,
  };
}

function buildRepresentationLockText(representation) {
  const role = representation?.role || 'BO_SURVEYOR';
  const label = representationLabel(role);
  const prohibited = role === 'AO_SURVEYOR'
    ? "Do not write as Building Owner surveyor, do not say we act for the Building Owner, and do not advance the Building Owner's position as our own."
    : role === 'AGREED_SURVEYOR'
      ? 'Do not write as separately appointed BO surveyor or separately appointed AO surveyor. Maintain neutral Agreed Surveyor positioning.'
      : "Do not write as Adjoining Owner surveyor, do not say we act for the Adjoining Owner, and do not advance the Adjoining Owner's position as our own.";

  const selectedAO = representation?.selectedAO;
  const selectedAoText = selectedAO
    ? `\nSelected AO/runtime target: ${compactJson(selectedAO, 2000)}`
    : '';

  return `REPRESENTATION LOCK -- AUTHORITATIVE\nSquare One / Itzik's role on this matter is: ${label}.\nThis role is resolved from the ${representation?.source || 'project/runtime context'} and overrides any ambiguous wording in emails, chat history, memory, examples or dictation.\n${prohibited}\nBefore summarising or drafting, interpret "we", "us", "our", "I", "my client" and "the client" consistently with this role unless the source text is clearly quoting someone else.${selectedAoText}`;
}

function validateRoleConsistency(reply = '', representation = null, modeHint = '') {
  if (!reply || !representation || modeHint !== 'draft') return null;
  const text = String(reply).toLowerCase();
  const role = representation.role;
  const failures = [];

  if (role === 'BO_SURVEYOR') {
    if (/we act for (the )?adjoining owner|acting for (the )?adjoining owner|on behalf of (the )?adjoining owner/.test(text)) failures.push('Draft says Square One acts for the Adjoining Owner while project role is Building Owner surveyor.');
  } else if (role === 'AO_SURVEYOR') {
    if (/we act for (the )?building owner|acting for (the )?building owner|on behalf of (the )?building owner/.test(text)) failures.push('Draft says Square One acts for the Building Owner while project role is Adjoining Owner surveyor.');
  } else if (role === 'AGREED_SURVEYOR') {
    if (/we act for (the )?(building owner|adjoining owner)|acting for (the )?(building owner|adjoining owner)|on behalf of (the )?(building owner|adjoining owner)/.test(text)) failures.push('Draft uses separate-party representation wording while project role is Agreed Surveyor.');
  }

  return failures.length ? failures : null;
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
    body: stripHtml(body).slice(0, 4000),
  };
}

function buildSuppliedEmailContext(body = {}) {
  const supplied = body.emailContext || body.context?.selectedEmailContext || null;
  if (!supplied) return null;

  // selectedEmailBody is the raw body of the selected email only (not the thread concatenation).
  // Inbox.jsx passes this separately. Fall back to body_preview if not present.
  // This prevents threadText from being treated as the selected email body.
  const selectedBody = firstNonEmpty(
    supplied.selectedEmailBody,   // set by Inbox.jsx
    supplied.body_preview,
    supplied.preview,
    supplied.snippet
    // intentionally excludes supplied.body and supplied.threadText — those are the full thread
  );

  return normaliseEmailRecord({
    ...supplied,
    body: selectedBody || supplied.body || '',  // selectedBody first; fall back to body only if no separate field
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

  // Fallback: read AOs from projects.aos JSON when both table queries return empty.
  // This is the source of truth for most projects — AO data lives in the JSON column.
  const projectJsonAos = (!adjoiningOwners.length && !legacyAos.length && project?.aos)
    ? (Array.isArray(project.aos) ? project.aos : [])
    : [];

  const notices = await safeSelect('notices', '*', q =>
    q.eq('project_id', projectId).order('created_at', { ascending: false }).limit(20)
  );

  const documents = await safeSelect('documents', 'id, project_id, file_name, file_type, category, section_type, created_at, ao_id', q =>
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
    adjoining_owners: adjoiningOwners.length ? adjoiningOwners : (legacyAos.length ? legacyAos : projectJsonAos),
    notices,
    documents,
    project_memory: projectMemory,
    soc_reports: socReports,
    project_chat_notes: projectChatMessages,
    project_emails: projectEmails,
  };
}

// ── Slim project facts loader — party names, AOs, notices, memory only ──
// Used for drafting surfaces where full email load is not needed.
// Semantic search provides relevant emails on demand.
async function loadProjectFacts(projectId) {
  const sb = getSupabase();
  if (!sb || !projectId) return null;

  const { data: project, error } = await sb
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .maybeSingle();

  if (error) console.warn('[ely-smart] project facts load failed:', error.message);

  const adjoiningOwners = await safeSelect('adjoining_owners', '*', q =>
    q.eq('project_id', projectId).limit(20)
  );
  const legacyAos = adjoiningOwners.length ? [] : await safeSelect('aos', '*', q =>
    q.eq('project_id', projectId).limit(20)
  );
  const projectJsonAos = (!adjoiningOwners.length && !legacyAos.length && project?.aos)
    ? (Array.isArray(project.aos) ? project.aos : [])
    : [];

  const notices = await safeSelect('notices', '*', q =>
    q.eq('project_id', projectId).order('created_at', { ascending: false }).limit(20)
  );

  const projectMemory = await safeSelect('project_memory', '*', q =>
    q.eq('project_id', projectId).order('created_at', { ascending: false }).limit(30)
  );

  const socReports = await safeSelect(
    'soc_reports',
    'id, ao_id, ao_names, ao_address, bo_address, inspection_date, raw_notes, structured_data, proposed_works, status, created_at',
    q => q.eq('project_id', projectId).order('created_at', { ascending: false }).limit(10)
  );

  // Slim fallback email load — only used if semantic search fails
  // Cap at 10 most recent to avoid prompt bloat
  const fallbackEmails = await safeSelect(
    'emails',
    'id, subject, sender_name, sender_email, to_email, direction, received_at, sent_at, body, body_preview, raw_recipients',
    q => q
      .eq('project_id', projectId)
      .order('received_at', { ascending: false })
      .limit(10)
  );

  return {
    project_raw: project || null,
    project: normaliseProject(project || {}),
    adjoining_owners: adjoiningOwners.length ? adjoiningOwners : (legacyAos.length ? legacyAos : projectJsonAos),
    notices,
    documents: [],
    project_memory: projectMemory,
    soc_reports: socReports,
    project_chat_notes: [],
    project_emails: [],          // not injected directly — semantic search handles this
    fallback_emails: fallbackEmails, // only used if semantic search returns nothing
  };
}

// ── Semantic search across all project content ───────────────────────────
async function semanticSearchProject(projectId, userPrompt, limit = 20) {
  const sb = getSupabase();
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

// ── Clause library: match a new clause request against the user's own
// saved example clauses ────────────────────────────────────────────────
// Added 2026-09-10, on request: reuses the same embedding pattern as
// semanticSearchProject above. Only used for the clause_request
// surface — genuinely irrelevant to every other surface here.
async function matchClauseLibrary(userPrompt) {
  const sb = getSupabase();
  if (!sb || !userPrompt) return [];
  try {
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) return [];

    const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: userPrompt.slice(0, 8000), dimensions: 1536 }),
    });
    if (!embedRes.ok) return [];
    const embedData = await embedRes.json();
    const queryEmbedding = embedData.data[0].embedding;

    const { data, error } = await sb.rpc('match_clause_library', {
      query_embedding: queryEmbedding,
      match_count: 3,
    });
    if (error || !data?.length) return [];
    return data.filter(m => m.similarity > 0.55);
  } catch (err) {
    console.warn('[ely-smart] clause library match failed:', err.message);
    return [];
  }
}


// ── PHASE 2A: Stage 1 Strategic Reasoning ─────────────────────────────────
// Redesigned in place (Milestone 1/2's original Luna-based brief generator
// is replaced entirely — this is the same function, not a second one).
//
// Produces a structured professional case assessment: real problem, user
// objective, chronology, controlling facts, concessions, candidate
// arguments, decisive issue (or correctly none), counterfactual test,
// counterargument, residual issues, overstatement risks. Model: Terra only,
// no temperature. Governing schema: IMPLEMENTATION_READY_STAGE1_SCHEMA.md.
//
// PHASE 2A SCOPE: retrievedAuthority is always the empty, labelled
// "not_attempted" placeholder (CORRECTED_DOMAIN_KNOWLEDGE_CONTRACT_SPEC.md
// §5) — no knowledge retrieval happens here. representationLock is fixed,
// JavaScript-supplied input; the model never generates or restates it as
// its own output field.
//
// This function does NOT decide whether its output reaches Stage 2 — that
// decision belongs entirely to the caller (see the Phase 2A caller flow
// below). This function returns a result describing what happened; the
// caller is solely responsible for stage1BriefForPrompt, which is always
// null during Phase 2A regardless of what this function returns.
// ──────────────────────────────────────────────────────────────────────────

const STAGE1_VALIDATION_RESULT = Object.freeze({
  VALID: 'valid',
  SHAPE_INVALID: 'shape_invalid',
  DEPENDENCY_INVALID: 'dependency_invalid',
  GENERATION_FAILED: 'generation_failed',
  COMPLETION_TRUNCATED: 'completion_truncated',
});

function emptyRetrievedAuthority() {
  return { retrieval_status: 'not_attempted', authorities: [], retrieval_outcome: null, retrieval_gaps: [] };
}

function buildStage1SystemPrompt() {
  return `You are a professional case-assessment analyst working alongside an experienced party wall surveyor and their practice.

Your job is NOT to draft correspondence, and NOT to decide what case law or statutory authority applies.

Your job is to produce the internal professional case assessment an experienced colleague would form before saying anything out loud: what has actually happened, what the user is trying to achieve, what matters, what the evidence supports, what the strongest honest arguments are, and what strategy best advances the user's objective. A separate stage decides how this is communicated.

MANDATORY REASONING SEQUENCE — follow this order. Do not begin by asking what case law applies.

1. Understand the situation and reconstruct what has actually happened.
2. Identify the user's actual objective — not only the objective reality of the dispute, but why the user is asking for help and what outcome they want (examples: winning or advancing an argument; protecting the appointing owner's position; drawing a line under a dispute; getting works or negotiations moving again; preserving a commercial or professional relationship; de-escalating unnecessary hostility; obtaining a practical concession; documenting the record without escalating; challenging fees; preserving legal or procedural rights; preparing for mediation or litigation; producing a short operational response rather than a complete argument — these are illustrative, not exhaustive). Do not substitute a different, stronger-sounding objective for the user's actual one. If the user's objective conflicts with the evidence, professional duty, the representation lock, or a material risk, say so explicitly rather than silently pursuing it.
3. Reconstruct the relevant chronology, grounded in verbatim excerpts from the supplied, opaquely-labelled sources.
4. Detect concessions, admissions, commitments, contradictions and changes of position — each grounded in a verbatim excerpt from a specific labelled source. An implied change of position requires two independent excerpts (an earlier and a later one), never inferred from a single ambiguous message.
5. Identify controlling facts and classify each as established (grounded in at least one verified excerpt), disputed (grounded in supporting evidence, with opposing evidence recorded separately if present), or inferred (grounded in other findings already in this brief, never invented from nothing).
6. Construct genuinely distinct candidate arguments. For each argument, separate its CORE substance — which must rest only on findings essential to the argument's existence — from any REINFORCEMENT — a separate, distinct point that strengthens the argument but which the argument would still exist without. Never embed a reinforcement-only claim (such as "the opposing side has expressly accepted this") inside the core argument text. State it as a separate reinforcement instead.
7. Rank the candidate arguments by strategic force.
8. Decide whether a single issue is genuinely decisive. Do not invent a decisive issue where none exists — where no single point is decisive, say so and rely on the ranked hierarchy instead. Where one exists: state why it is decisive, and apply a counterfactual test — state a test question of the form "if [the controlling fact] were not true, would this argument still matter?" together with the expected answer, so the decisive claim is auditable rather than asserted.
9. State the strongest counterargument the other side could genuinely make, stated fairly, not as a strawman.
10. Identify residual issues that remain live even after the decisive or strongest argument is applied — do not let one strong point silently absorb everything else.
11. Flag specific overstatement risks — places where the user's own position, or the argument you have constructed, would become vulnerable if pushed further than the evidence supports.
12. Recommend an argument order and an overall response strategy that reflects everything above and, critically, actually advances the user's identified objective — not merely the most rhetorically powerful case available in the abstract.

EVIDENCE DISCIPLINE
Every source you are given is labelled with an opaque identifier (e.g. email_0001, chat_0001, current_message). Every claim that depends on a specific source must cite that exact identifier and reproduce the supporting text verbatim, not paraphrased. A downstream system will mechanically verify every excerpt against the source it claims to come from — an excerpt that does not match exactly, or a claim with no citation, will be rejected. Do not invent, approximate, or paraphrase-and-present-as-verbatim.

REPRESENTATION LOCK
You will be given a fixed representation lock stating which party's side this analysis is being prepared for. Treat it as authoritative, fixed input. Do not restate it, alter it, or produce it as an output field — it is not part of your output.

AUTHORITY
You will be given a retrievedAuthority object. In this phase it will always show retrieval_status "not_attempted" with no authorities supplied. Do not reference, assume, or invent any specific case, statute, section, or citation — proceed on the supplied factual evidence alone. If you believe authority would materially strengthen a specific argument, you may note that generically (e.g. "a statutory or case-law point may reinforce this if available"), but you must never assert that a specific authority exists or supports the point.

Return ONLY valid JSON matching this schema. No preamble, no explanation, no markdown.

{
  "user_objective": "string",
  "real_problem_to_solve": "string",
  "chronology": [ { "source_id": "string", "date": "string", "event": "string", "excerpt": "string" } ],
  "original_factual_premise": "string",
  "controlling_facts": [ { "fact_id": "fact_01", "fact": "string", "status": "established | disputed | inferred", "supporting_evidence": [ { "source_id": "string", "excerpt": "string" } ], "opposing_evidence": [ { "source_id": "string", "excerpt": "string" } ], "inference_basis_ids": ["string"] } ],
  "material_changes": [ { "change_id": "change_01", "change": "string", "source_id": "string", "excerpt": "string", "strategic_effect": "string" } ],
  "user_emphasised_points": [ { "point": "string", "source_id": "string", "excerpt": "string", "should_control_response": true } ],
  "express_concessions_and_admissions": [ { "concession_id": "concession_01", "party": "string", "source_id": "string", "excerpt": "string", "classification": "concession | admission" } ],
  "implied_changes_of_position": [ { "position_change_id": "position_change_01", "description": "string", "earlier_source_id": "string", "earlier_excerpt": "string", "later_source_id": "string", "later_excerpt": "string", "confidence": "high | medium | low" } ],
  "prior_commitments": [ { "commitment_id": "commitment_01", "party": "string", "source_id": "string", "excerpt": "string", "status": "fulfilled | outstanding | withdrawn | unclear", "strategic_effect": "string" } ],
  "contradictions": [ { "contradiction_id": "contradiction_01", "description": "string", "source_a_id": "string", "source_a_excerpt": "string", "source_b_id": "string", "source_b_excerpt": "string" } ],
  "candidate_arguments": [ { "argument_id": "arg_01", "core_argument": "string", "required_finding_ids": ["string"], "reinforcements": [ { "reinforcement_id": "reinforcement_01", "finding_ids": ["string"], "statement": "string" } ], "strength": "strong | moderate | weak", "limitations": "string" } ],
  "argument_ranking": ["string"],
  "decisive_issue": { "exists": true, "argument_id": "string or null", "core_reason": "string or null", "reinforcements": [ { "reinforcement_id": "string", "finding_ids": ["string"], "statement": "string" } ], "counterfactual_test": "string or null", "counterfactual_expected_answer": "string or null", "required_dependency_ids": ["string"], "supporting_dependency_ids": ["string"], "confidence": "high | medium | low or null" },
  "strongest_counterargument": "string",
  "residual_issues": ["string"],
  "overstatement_risks": ["string"],
  "evidence_references": [ { "source_id": "string", "excerpt": "string", "used_for": "string" } ],
  "recommended_argument_order": ["string"],
  "recommended_response_strategy": "string",
  "recommended_strategy_required_finding_ids": ["string"],
  "requires_clarification": { "needed": false, "material_gaps": [], "clarification_question": "string or null" },
  "tone_register": "formal | professional-conversational | warm | firm",
  "user_terminology_to_preserve": {},
  "must_include": [],
  "do_not_include": [],
  "analysis_confidence": "high | medium | low",
  "analysis_gaps": []
}

When decisive_issue.exists is false, argument_id, core_reason, counterfactual_test and counterfactual_expected_answer must be null, and required_dependency_ids must be empty. When it is true, all of those fields are required and required_dependency_ids must be non-empty.`;
}

const STAGE1_COMPLETION_TOKEN_LIMIT = 8000; // raised from 4000 — see PHASE2A_PREFLIGHT_CORRECTION.md finding 2.1

async function generateStage1Brief({
  projectId, userId, surface, modeHint,
  projectBundle, scopedEmailContext, selectedEmail, semanticResults,
  chatHistory = [], userPrompt = '',
  representationLock = null,
  retrievedAuthority = emptyRetrievedAuthority(),
  diagnosticsState = 'SHADOW', // 'SHADOW' | 'PROMOTED_CANDIDATE_BLOCKED' — caller-supplied, for diagnostics only
}) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const t0 = Date.now();

  const result = {
    generationSucceeded: false,
    validationResult: STAGE1_VALIDATION_RESULT.GENERATION_FAILED,
    brief: null,
    tokensUsed: null,
    durationMs: 0,
    errorMsg: null,
    shapeErrors: null,
    dependencyValidation: null,
    retryAttempted: false,
    retryOutcome: null, // 'succeeded' | 'failed' | null
  };

  if (!OPENAI_KEY) {
    result.errorMsg = 'Missing OPENAI_API_KEY';
    result.durationMs = Date.now() - t0;
    await logStage1Diagnostics({ projectId, userId, surface, userPrompt, diagnosticsState, result, retrievedAuthority });
    return result;
  }

  const { contextBlocks, sourceIdMap } = buildStage1Context({
    userPrompt,
    selectedEmail,
    scopedEmailContext,
    chatHistory,
    projectBundle,
    semanticResults,
  });

  const fixedInputBlock = [
    representationLock ? `REPRESENTATION LOCK (fixed, authoritative — do not restate as output):\n${JSON.stringify(representationLock)}` : null,
    `RETRIEVED AUTHORITY (fixed input for this phase):\n${JSON.stringify(retrievedAuthority)}`,
  ].filter(Boolean).join('\n\n---\n\n');

  const stage1User = [
    fixedInputBlock,
    ...contextBlocks.map(b => `[${b.sourceId}] ${b.label}:\n${b.text}`),
  ].filter(Boolean).join('\n\n---\n\n');

  const stage1System = buildStage1SystemPrompt();

  const stage1Payload = {
    model: 'gpt-5.6-terra',
    reasoning_effort: process.env.STAGE1_REASONING_EFFORT || process.env.DRAFTING_REASONING_EFFORT || 'medium',
    max_completion_tokens: STAGE1_COMPLETION_TOKEN_LIMIT,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: stage1System },
      { role: 'user', content: stage1User },
    ],
  };

  // Applies the parsed OpenAI response (or a completion_truncated / other
  // outcome) onto `result`. Shared between the initial attempt and the
  // single permitted retry so both paths are validated identically.
  function applyResponseToResult(data) {
    const choice = data.choices?.[0];
    const finishReason = choice?.finish_reason || null;
    const raw = choice?.message?.content || '{}';
    result.tokensUsed = data.usage?.total_tokens || null;

    // Token-budget truncation is checked BEFORE attempting to parse, per
    // the requirement not to classify a known token-budget truncation as
    // generation_failed — even in the rare case the cut-off text happens
    // to still be syntactically valid JSON, it may be incomplete relative
    // to what the model intended to produce.
    if (finishReason === 'length') {
      result.generationSucceeded = false;
      result.validationResult = STAGE1_VALIDATION_RESULT.COMPLETION_TRUNCATED;
      result.errorMsg = `Completion truncated at max_completion_tokens (${STAGE1_COMPLETION_TOKEN_LIMIT})`;
      return;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      result.errorMsg = 'JSON parse failed: ' + parseErr.message;
      return;
    }

    result.generationSucceeded = true;
    const shapeResult = validateBriefShape(parsed);
    if (!shapeResult.valid) {
      result.validationResult = STAGE1_VALIDATION_RESULT.SHAPE_INVALID;
      result.shapeErrors = shapeResult.errors;
      result.errorMsg = `Shape validation failed: ${shapeResult.errors.length} error(s)`;
      return;
    }
    const depResult = applyDependencyValidation(shapeResult.brief, sourceIdMap);
    result.dependencyValidation = {
      removedReinforcements: depResult.removedReinforcements,
      removedFindings: depResult.removedFindings,
      removedArguments: depResult.removedArguments,
      invalidationReason: depResult.invalidationReason,
    };
    if (!depResult.valid) {
      result.validationResult = STAGE1_VALIDATION_RESULT.DEPENDENCY_INVALID;
      result.errorMsg = depResult.invalidationReason;
    } else {
      result.validationResult = STAGE1_VALIDATION_RESULT.VALID;
      result.brief = depResult.brief;
    }
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(stage1Payload),
    });

    if (res.ok) {
      const data = await res.json();
      applyResponseToResult(data);
    } else {
      const err = await res.json().catch(() => ({}));
      const errMsg = err.error?.message || `HTTP ${res.status}`;

      // Reuse the exact transient-error match and retry shape already
      // verified working for the existing Stage 2 Terra call (same model,
      // same reasoning configuration, no temperature, one retry maximum,
      // no fallback to any other model). Only this specific known
      // transient condition retries — ordinary schema/dependency/model
      // errors do not.
      if (errMsg.toLowerCase().includes('insufficient permissions')) {
        result.retryAttempted = true;
        console.log('[stage1] Terra permissions error — retrying once after 1s');
        await new Promise(r => setTimeout(r, 1000));
        try {
          const retryRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
            body: JSON.stringify(stage1Payload),
          });
          if (retryRes.ok) {
            const retryData = await retryRes.json();
            applyResponseToResult(retryData);
            result.retryOutcome = result.generationSucceeded ? 'succeeded' : 'failed';
            console.log('[stage1] Terra retry outcome:', result.retryOutcome);
          } else {
            const retryErr = await retryRes.json().catch(() => ({}));
            result.errorMsg = retryErr.error?.message || errMsg;
            result.retryOutcome = 'failed';
          }
        } catch (retryFetchErr) {
          result.errorMsg = retryFetchErr.message;
          result.retryOutcome = 'failed';
        }
        // No recursive or further retry regardless of this outcome — one
        // retry maximum, per the explicit requirement.
      } else {
        result.errorMsg = errMsg;
      }
    }
  } catch (err) {
    result.errorMsg = err.message;
  }

  result.durationMs = Date.now() - t0;
  await logStage1Diagnostics({ projectId, userId, surface, userPrompt, diagnosticsState, result, retrievedAuthority });
  console.log(`[stage1] ${diagnosticsState} outcome=${result.validationResult} in ${result.durationMs}ms, tokens=${result.tokensUsed}, retried=${result.retryAttempted}`);
  return result;
}

// Diagnostics — reuses the existing stage1_briefs table exactly as it is
// today. No new columns, no migration. The versioned envelope carries
// everything Phase 2A needs inside the existing JSONB `brief` column; the
// existing `error` column carries a concise failure summary where relevant.
// Never stores raw chain-of-thought or duplicated full email bodies — only
// the final, validated (or null) brief and the dependency-validation
// summary, consistent with the existing table's own truncation pattern.
async function logStage1Diagnostics({ projectId, userId, surface, userPrompt, diagnosticsState, result, retrievedAuthority }) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const envelope = {
      schema_version: 'phase2a_shadow_v2', // v2: completion_truncated + retry fields + recorded token limit
      state: diagnosticsState,
      validation_result: result.validationResult,
      strategic_brief: result.brief || null,
      dependency_validation: result.dependencyValidation || {
        removedReinforcements: [], removedFindings: [], removedArguments: [], invalidationReason: null,
      },
      retrieved_authority_status: retrievedAuthority?.retrieval_status || 'not_attempted',
      completion_token_limit: STAGE1_COMPLETION_TOKEN_LIMIT,
      retry_attempted: result.retryAttempted || false,
      retry_outcome: result.retryOutcome || null,
    };
    await sb.from('stage1_briefs').insert([{
      project_id: projectId || null,
      user_id: userId || null,
      surface: surface || null,
      model: 'gpt-5.6-terra',
      prompt_snippet: (userPrompt || '').slice(0, 200),
      brief: envelope,
      stage1_tokens_used: result.tokensUsed,
      stage1_duration_ms: result.durationMs,
      error: result.errorMsg ? String(result.errorMsg).slice(0, 500) : null,
    }]);
  } catch (logErr) {
    console.warn('[stage1] diagnostics logging failed (non-fatal):', logErr.message);
  }
}


// ── NORA V2: isolated runtime, reads user_brain_v2 + *_v2 rows only ────────
// Per docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md. This never touches any V1
// source (ely_master_v3, global_drafting, party_wall_drafting, the V1
// user_brain table) and V1's buildSystemPrompt()/buildMessages() never call
// anything in this section. Routing into this path happens exactly once,
// at the single call site below, gated by resolveArchitectureVersion().
async function loadV2Sources({ userId }) {
  const sb = getSupabase();
  if (!sb) return { universalBrain: null, defaultVoiceProfile: null, userBrainV2: null };

  const [ubRes, dvpRes, ubv2Res] = await Promise.all([
    sb.from('ai_instruction_sets').select('system_prompt').eq('name', 'universal_brain_v2').maybeSingle(),
    sb.from('ai_instruction_sets').select('system_prompt').eq('name', 'default_voice_profile_v2').maybeSingle(),
    userId
      ? sb.from('user_brain_v2').select('*').eq('user_id', userId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    universalBrain: ubRes?.data?.system_prompt || null,
    defaultVoiceProfile: dvpRes?.data?.system_prompt || null,
    userBrainV2: ubv2Res?.data || null,
  };
}

// Runs the complete V2 pipeline for one request and returns the response
// payload. Exactly one Terra call is made here — no separate reasoning
// call, no iterative retrieval loop. Progressive context assembly uses only
// what the caller already gathered (project bundle, scoped email context,
// semantic results, chat history) via the existing, already-working V1
// retrieval functions — nothing is re-fetched, and nothing here judges
// whether that context is sufficient (see v2-working-memory.js).
async function runV2Pipeline({
  userId, surface, modeHint, prompt, representation, effectiveProjectId,
  projectBundle, scopedEmailContext, chatHistory, hasExplicitEmailSelection,
  confirmedDraftText, draftingExamples, domainKnowledgeText, contactsContext,
  clauseLibraryMatches, inboxSearchContext,
}) {
  const t0 = Date.now();
  const { universalBrain, defaultVoiceProfile, userBrainV2 } = await loadV2Sources({ userId });

  const effectiveVoice = resolveEffectiveVoice({ defaultVoiceProfile, userBrainV2 });

  const exampleForGoldStandard = Array.isArray(draftingExamples) ? draftingExamples[0] : null;
  const goldStandardBlock = modeHint === 'draft'
    ? buildGoldStandardBlock({ example: exampleForGoldStandard, userBrainV2 })
    : null;

  // Current email resolution hierarchy (2026-08-06 final verification,
  // per explicit requirement): mechanical, deterministic, four tiers —
  //   1+2. Explicit UI selection (threadId/emailId) or supplied/pasted/
  //        attached context (suppliedEmailContext, e.g. Inbox.jsx passing
  //        a selected email body) — both authoritative, array order left
  //        exactly as buildScopedEmailContext returns it (thread-anchored
  //        branch), never reordered.
  //   3. Mechanical verbatim-chunk match: if the user has pasted or
  //      quoted part of a specific email back into the current prompt,
  //      identifyDiscussedEmail() finds it by plain substring matching
  //      (see v2-working-memory.js) — never a relevance judgement — and
  //      that email is moved to the front.
  //   4. Otherwise, newest project email first (scopedEmailContext is
  //      returned oldest-first by buildScopedEmailContext — reversed here
  //      so "the current email" defaults to the most recent, not the
  //      oldest of the 30 fetched, confirmed as a real regression
  //      previously).
  let orderedEmailContext;
  if (hasExplicitEmailSelection) {
    orderedEmailContext = scopedEmailContext || [];
  } else {
    const newestFirst = [...(scopedEmailContext || [])].reverse();
    const mechanicalMatch = identifyDiscussedEmail(prompt, newestFirst);
    orderedEmailContext = mechanicalMatch
      ? [mechanicalMatch, ...newestFirst.filter((e) => e.id !== mechanicalMatch.id)]
      : newestFirst;
  }

  // Context-wiring correction (2026-08-06): semanticSearchProject() is the
  // existing, already-working V1 function — it calls the
  // search_project_content RPC, which itself unions emails, ai_messages
  // (chat, across every session on this project, not just the current
  // one) and project_memory in a single embeddings-scored query, strictly
  // scoped to p_project_id. This single call is the source for BOTH the
  // semanticResults and (as a supplement, see below) projectMemory
  // Working Memory categories.
  const project = projectBundle?.project_raw || projectBundle?.project || null;
  const requestText = [prompt, ...orderedEmailContext.slice(0, 1).map((e) => e.body || e.body_preview || '')].join(' ');
  let searchResults = [];
  if (effectiveProjectId && prompt) {
    try {
      searchResults = (await semanticSearchProject(effectiveProjectId, prompt, 25)) || [];
      // Added 2026-09-02, on request: this call has been genuinely
      // live and working since the 2026-08-06 v2 wiring correction
      // above it, but was never given the same logging the old,
      // now-dead v1 buildSystemPrompt version had — so
      // semantic_search_log went stale on that exact date even
      // though the feature itself kept working, making it look
      // abandoned. Fire-and-forget, matches the old logging shape.
      getSupabase()?.from('semantic_search_log').insert([{
        project_id: effectiveProjectId,
        surface: surface || 'unknown',
        prompt_snippet: (prompt || '').slice(0, 120),
        results_count: searchResults?.length || 0,
        success: !!(searchResults?.length),
        fallback_used: false,
        error_message: null,
      }]).then(() => {}).catch(() => {});
    } catch (searchErr) {
      console.warn('[nora-v2] semantic search failed (non-fatal):', searchErr.message);
      searchResults = [];
      getSupabase()?.from('semantic_search_log').insert([{
        project_id: effectiveProjectId,
        surface: surface || 'unknown',
        prompt_snippet: (prompt || '').slice(0, 120),
        results_count: 0,
        success: false,
        fallback_used: false,
        error_message: String(searchErr.message || searchErr).slice(0, 300),
      }]).then(() => {}).catch(() => {});
    }
  }
  const alreadyIncludedIds = new Set([
    ...orderedEmailContext.map((e) => e.id).filter(Boolean),
  ]);
  const { emailChatResults, memoryResults } = splitSemanticResults(searchResults);
  const semanticResultsFiltered = filterByMatchedAnchor(
    excludeExistingIds(emailChatResults, alreadyIncludedIds),
    { project, requestText }
  );

  // Direct project memory (2026-08-06 correction): populated straight from
  // projectBundle.project_memory — already fetched by loadProjectFacts()
  // for every project_chat request, previously unused. Cleaned the same
  // way V1 cleans it (exclude raw-email/UI-noise entries, strip the
  // embedding). This does NOT depend on semantic ranking. Semantic search
  // may still surface additional memory rows not already covered — those
  // are merged in as a supplement, deduped against the direct set by ID,
  // never replacing it.
  const directProjectMemory = extractProjectMemory(projectBundle);
  const directMemoryIds = new Set(directProjectMemory.map((m) => m.id).filter(Boolean));
  const supplementalMemoryFromSearch = filterByMatchedAnchor(
    excludeExistingIds(memoryResults, new Set([...alreadyIncludedIds, ...directMemoryIds])),
    { project, requestText }
  ).map((r) => ({
    id: r.content_id, content: r.content, date: r.metadata?.created_at,
    author: r.metadata?.source_type, evidential_status: 'project_memory_semantic_supplement',
  }));

  // Cross-session Project Chat history (2026-08-06 correction): direct,
  // bounded, not semantic-search-dependent. loadProjectFacts() (used for
  // this surface) hardcodes project_chat_notes to [] — confirmed in code
  // — so this was never populated for Project Chat requests under either
  // V1 or V2. Fetched here directly. The backend does not track a stable
  // session ID for the current request (session persistence is frontend-
  // only, confirmed by grep — there is no request-scoped sessionId field
  // anywhere in this file), so "exclude the current session" is enforced
  // by content-matching against the chatHistory already supplied for this
  // request, not by a session_id filter that doesn't reliably exist here.
  let projectChatHistoryRaw = [];
  if (effectiveProjectId) {
    try {
      const sb = getSupabase();
      if (sb) {
        const { data, error } = await sb.from('ai_messages')
          .select('id, role, content, created_at, session_id')
          .eq('project_id', effectiveProjectId)
          .eq('surface', 'project_chat')
          .order('created_at', { ascending: false })
          .limit(40);
        if (error) console.warn('[nora-v2] project chat history load failed:', error.message);
        projectChatHistoryRaw = data || [];
      }
    } catch (chatHistErr) {
      console.warn('[nora-v2] project chat history load failed (non-fatal):', chatHistErr.message);
    }
  }
  const currentSessionContentSet = new Set((chatHistory || []).map((m) => (m.content || '').trim()));
  // Fixed 2026-08-06 (final verification, before push): only exclude by
  // content match when the text is long enough to be genuinely
  // distinctive. Short, common replies ("Agreed", "Okay", "Give me the
  // draft") could otherwise wrongly exclude a real, distinct historical
  // message purely because it happens to share the same short text as
  // something in the live session — a real gap identified before this
  // was pushed. Below this length, a message is always kept; the cost of
  // an occasional harmless duplicate short reply is far lower than the
  // cost of silently dropping a distinct prior message.
  const DEDUP_MIN_LENGTH = 40;
  const projectChatHistory = projectChatHistoryRaw
    .filter((m) => {
      const text = (m.content || '').trim();
      if (!text) return false;
      if (text.length < DEDUP_MIN_LENGTH) return true;
      return !currentSessionContentSet.has(text);
    })
    .map((m) => ({
      id: m.id, content: `${m.role}: ${m.content}`.slice(0, 1500),
      date: m.created_at, author: m.session_id ? `session:${m.session_id.slice(0, 8)}` : null,
      evidential_status: 'prior_project_chat_recency_based', // interim mechanism — recency-based, not relevance-ranked; stated explicitly rather than implied
    }));

  const rawSources = {
    currentInstruction: prompt ? [{ id: 'current_instruction', content: prompt, evidential_status: 'current_request' }] : [],
    selectedEmail: orderedEmailContext.slice(0, 1).map((e) => ({
      id: e.id, content: (e.body || e.body_preview || '').slice(0, 4000),
      date: e.received_at || e.sent_at, author: e.sender_name || e.sender_email,
    })),
    thread: orderedEmailContext.slice(1).map((e) => ({
      id: e.id, content: (e.body || e.body_preview || '').slice(0, 2000),
      date: e.received_at || e.sent_at, author: e.sender_name || e.sender_email,
    })),
    // Protects the most recent accepted draft from the chatHistory
    // per-category cap, so a minor-amendment request can never lose it.
    currentDraftState: extractCurrentDraftState(confirmedDraftText),
    // Mechanical extraction only — matches AO name/address substrings
    // against the current request + selected email text, never infers
    // which party is "relevant". See v2-working-memory.js.
    confirmedProjectAnchors: extractConfirmedProjectAnchors({ project, requestText }),
    // Structured, labelled project facts (2026-08-06 correction) —
    // replaces JSON.stringify(projectBundle).slice(0,4000). Never
    // includes embedding vectors or raw project_memory/email content;
    // those have their own categories.
    projectFacts: buildStructuredProjectFacts(projectBundle),
    semanticResults: semanticResultsFiltered.map((r) => ({
      id: r.content_id, content: r.content, date: r.metadata?.received_at || r.metadata?.created_at,
      author: r.metadata?.sender_name || r.metadata?.role, evidential_status: `semantic_${r.content_type}`,
    })),
    projectMemory: [...directProjectMemory, ...supplementalMemoryFromSearch],
    projectChatHistory,
    chatHistory: (chatHistory || []).slice(-40).map((m, i) => ({ id: `history_${i}`, content: `${m.role}: ${m.content}` })),
  };
  const workingMemory = assembleWorkingMemory(rawSources);

  const { prompt: systemPrompt, sections } = assembleV2Prompt({
    universalBrain,
    effectiveVoice,
    goldStandardBlock,
    domainKnowledge: domainKnowledgeText || null,
    workingMemory,
    surface,
    modeHint,
    representationLock: representation ? JSON.stringify(representation) : null,
    contactsContext,
    clauseLibraryMatches,
    inboxSearchContext,
  });

  const requestedReasoningEffort = process.env.DRAFTING_REASONING_EFFORT || 'medium';
  let modelReturned = null;
  let observedReasoningTokens = null;
  let fallbackOccurred = false;
  let replyText = '';

  try {
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-5.6-terra',
        reasoning_effort: requestedReasoningEffort,
        max_completion_tokens: 3500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      replyText = data.choices?.[0]?.message?.content || '';
      modelReturned = data.model || 'gpt-5.6-terra';
      observedReasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? null;
    } else {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn('[nora-v2] Terra call failed, no fallback model used:', err.message);
    fallbackOccurred = false; // explicitly: this codebase never silently falls back to another model for V2
    throw err;
  }

  // Mechanical split only — a fixed-delimiter extraction, not a judgement
  // about what "counts" as a draft. See splitDraftFromCommentary().
  const { reply: splitReply, draft: splitDraft } = splitDraftFromCommentary(replyText);

  const diagnostics = buildDiagnosticsEnvelope({
    architectureVersion: 'v2',
    modelReturned,
    requestedReasoningEffort,
    observedReasoningTokens,
    surface,
    modeHint,
    representation: representation?.role || null,
    promptSections: sections,
    effectiveVoiceProfileId: effectiveVoice.effectiveVoiceProfileId,
    contextSelected: workingMemory.included,
    contextExcluded: workingMemory.excluded,
    goldStandardExampleId: goldStandardBlock?.exampleId || null,
    fallbackOccurred,
    validationResult: null,
  });

  try {
    const sb = getSupabase();
    if (sb) {
      await sb.from('stage1_briefs').insert([{
        project_id: projectBundle?.project?.id || null,
        user_id: userId || null,
        surface: surface || null,
        model: modelReturned,
        prompt_snippet: (prompt || '').slice(0, 200),
        brief: diagnostics,
        stage1_tokens_used: observedReasoningTokens,
        stage1_duration_ms: Date.now() - t0,
        error: null,
      }]);
    }
  } catch (logErr) {
    console.warn('[nora-v2] diagnostics logging failed (non-fatal):', logErr.message);
  }

  // Added 2026-08-21, real, serious fix — see applyContactCorrections
  // definition for full reasoning: this is now a guaranteed, code-
  // level lookup rather than relying on the model to reproduce
  // contact names correctly on its own. Applied here, inside the
  // pipeline itself, rather than at its call site — several static-
  // analysis tests key off the exact literal text of both the call
  // site and the response construction there, and this keeps both
  // completely untouched while still correcting what's actually
  // returned.
  const correctedReply = applyContactCorrections(splitReply, contactsContext);
  const correctedDraft = applyContactCorrections(splitDraft, contactsContext);
  return { replyText: correctedReply, draft: correctedDraft, diagnostics };
}

// ── PHASE 2A PREFLIGHT CORRECTION: background shadow task ──────────────────
// Wraps semantic search + generateStage1Brief() + diagnostics into a single
// promise, registered via waitUntil() so the user-facing Stage 2 response
// never awaits it. Receives an immutable snapshot of only the approved
// inputs — no live/mutable request-local references — captured by the
// caller before this task is scheduled, so nothing here depends on request
// state that may no longer be valid by the time this actually runs.
//
// Semantic search lives here, not in the blocking request path: Stage 2's
// own semantic search (inside buildSystemPrompt(), a separate call site)
// already exists independently for Stage 2's own purposes — VERIFIED
// REPOSITORY, confirmed by inspection before this change. The search
// previously run in the blocking path here existed solely to feed this
// discarded shadow analysis and has been moved inside this task.
//
// This whole function is wrapped so it can never produce an unhandled
// promise rejection — every internal failure is caught, logged via the
// normal diagnostics path (generateStage1Brief already logs on every
// outcome), and swallowed.
async function runStage1ShadowTask(snapshot) {
  try {
    let stage1SemanticResults = null;
    try {
      stage1SemanticResults = await semanticSearchProject(snapshot.projectId, snapshot.userPrompt, 20);
    } catch (semErr) {
      console.warn('[stage1] background semantic search failed (non-fatal):', semErr.message);
    }

    await generateStage1Brief({
      projectId: snapshot.projectId,
      userId: snapshot.userId,
      surface: snapshot.surface,
      modeHint: snapshot.modeHint,
      projectBundle: snapshot.projectBundle,
      scopedEmailContext: snapshot.scopedEmailContext,
      selectedEmail: snapshot.selectedEmail,
      semanticResults: stage1SemanticResults,
      chatHistory: snapshot.chatHistory,
      userPrompt: snapshot.userPrompt,
      representationLock: snapshot.representationLock,
      retrievedAuthority: snapshot.retrievedAuthority,
      diagnosticsState: snapshot.diagnosticsState,
    });

    if (snapshot.diagnosticsState === 'PROMOTED_CANDIDATE_BLOCKED') {
      console.warn('[stage1] STAGE1_PROMOTED is set but Phase 2A has no promotion path — treated as shadow only, blocked.');
    }
  } catch (err) {
    // Defence in depth — generateStage1Brief() already catches its own
    // internal failures and always logs a diagnostics row, so reaching
    // this catch means something outside that function's own try/catch
    // failed unexpectedly. Logged, never rethrown: this task must never
    // produce an unhandled rejection regardless of what fails inside it.
    console.warn('[stage1] background shadow task failed unexpectedly (non-fatal, no diagnostics row for this failure):', err?.message || err);
  }
}


// ── Cross-project search — finds project by name then searches its content ──
// Used from main chat when user says "look at the Sellafield project notes"
async function searchNamedProject(prompt, projectsContext = []) {
  if (!projectsContext?.length || !prompt) return null;
  const sb = getSupabase();
  if (!sb) return null;

  const lower = prompt.toLowerCase();
  console.log('[ely-smart] searchNamedProject called: prompt=', lower.slice(0,60), 'projects=', projectsContext.length);
  if (projectsContext.length > 0) console.log('[ely-smart] first project addr=', (projectsContext[0].bo_premise_address || projectsContext[0].address || 'NONE').toLowerCase());

  // DEBUG — log what fields the first project has
  if (projectsContext.length > 0) {
    const sample = projectsContext[0];
    console.log('[ely-smart] projectsContext sample keys:', Object.keys(sample).join(','), 'addr:', sample.bo_premise_address || sample.address || 'NONE');
  }

  // Score every project against the prompt — support multiple matches
  const scored = [];
  for (const proj of projectsContext) {
    const addr = (proj.bo_premise_address || proj.address || proj.name || '').toLowerCase();
    const ref = (proj.ref || '').toLowerCase();
    if (!addr && !ref) continue;

    let score = 0;
    const addrWords = addr.split(/[,\s]+/).filter(w => w.length >= 5);
    for (const w of addrWords) {
      if (lower.includes(w)) {
        score += w.length; // exact match
      } else if (w.length >= 6 && lower.includes(w.slice(0, 5))) {
        score += 4; // fuzzy prefix match — catches Whisper mishearing e.g. mitchum vs mitcham
      }
    }
    if (ref && lower.includes(ref)) score += 20;
    if (score > 0) console.log('[ely-smart] score debug:', addr.slice(0,40), 'score=', score, 'prompt includes mitcham=', lower.includes('mitcham'));
    if (score >= 5) scored.push({ proj, score });
  }

  // Sort by score descending — take up to 3 matched projects
  scored.sort((a, b) => b.score - a.score);
  const matched = scored.slice(0, 3).map(s => s.proj);

  console.log('[ely-smart] cross-project search matched:', matched.length, 'projects:', matched.map(p => p.bo_premise_address || p.address).join(' | '));
  if (!matched.length) return null;

  // For each matched project, load basic facts — no semantic search needed for a list/summary request
  const allResults = [];
  for (const matchedProject of matched) {
    const projectId = matchedProject.id;

    // Try semantic search first
    let results = await semanticSearchProject(projectId, prompt, 8);

    if (!results?.length) {
      // Fallback: just include the project address/ref as a result so GPT can list it
      allResults.push({
        content_type: 'project_summary',
        content_id: projectId,
        content: `Project: ${matchedProject.bo_premise_address || matchedProject.address} (${matchedProject.ref || 'no ref'}) -- Status: ${matchedProject.status || 'active'}`,
        similarity: 1.0,
        project: matchedProject,
      });
    } else {
      for (const r of results) allResults.push({ ...r, project: matchedProject });
    }
  }

  return { projects: matched, results: allResults };
}

function wantsEmailContext(prompt = '', projectId = null, suppliedEmailContext = null, threadId = null, emailId = null) {
  if (suppliedEmailContext || threadId || emailId) return true;

  // v4: Do not load all project emails merely because a project is active.
  // Only load when the prompt clearly refers to emails/correspondence.
  const lower = String(prompt || '').toLowerCase();

  // 'draft' alone is NOT a signal to load email context — only load when
  // the user is clearly referencing existing correspondence to reply to or read.
  const draftingAgainstExisting =
    /\breply\s+(to|saying)\b/.test(lower) ||
    /\brespond\s+(to|saying)\b/.test(lower) ||
    /\bdraft\s+(a\s+)?reply\b/.test(lower) ||
    /\bdraft\s+(a\s+)?response\b/.test(lower) ||
    /\b(draft|write|reply)\b.{0,30}\b(their|his|her|that)\s+email\b/.test(lower);

  return (
    lower.includes('email') ||
    lower.includes('thread') ||
    lower.includes('inbox') ||
    lower.includes('correspondence') ||
    lower.includes('wrote') ||
    lower.includes('received') ||
    lower.includes('what do you think about this email') ||
    lower.includes('what did they say') ||
    lower.includes('what is he asking') ||
    lower.includes('what is she asking') ||
    lower.includes('what are they asking') ||
    draftingAgainstExisting
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
    // Cap at 30 most recent — unbounded fetch blows past OpenAI TPM limits on projects
    // with long correspondence histories. Broader history goes through searchProjectEmails.
    query = query.eq('project_id', projectId).order('received_at', { ascending: false }).limit(30);
  } else {
    query = query.in('folder', ['Inbox', 'Sent Items']).limit(20);
  }

  const { data, error } = await query;
  // Restore chronological order after most-recent-first fetch
  if (projectId && data?.length) data.reverse();

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
    /\bwhat do you think\b/i.test(p) ||
    /\bwhat'?s your view\b/i.test(p) ||
    /\bwhats your view\b/i.test(p) ||
    /\bwhat'?s your read\b/i.test(p) ||
    /\bwhats your read\b/i.test(p) ||
    /\bthoughts\?\?\b/i.test(p) ||
    /\bcan (he|she|they|we|i) do that\b/i.test(p) ||
    /\bis that right\b/i.test(p) ||
    /\bis that correct\b/i.test(p) ||
    /\bis that a breach\b/i.test(p) ||
    /\btalk me through\b/i.test(p) ||
    /\b(let'?s|let us) discuss\b/i.test(p) ||
    /\bchat through\b/i.test(p) ||
    /\bam i missing\b/i.test(p) ||
    /\bwhat('?s| is) his angle\b/i.test(p) ||
    /\bwhat('?s| is) her angle\b/i.test(p) ||
    /\bwhat('?s| is) their angle\b/i.test(p) ||
    /\bwhy is (he|she|they) saying this\b/i.test(p) ||
    /\bhow would a judge view this\b/i.test(p) ||
    /\bhow would a third surveyor view this\b/i.test(p) ||
    /\bhelp me form a response\b/i.test(p) ||
    /\bwe need to discuss\b/i.test(p) ||
    /\bi think\b/i.test(p) ||
    /\bi am concerned\b/i.test(p) ||
    /\bi'm concerned\b/i.test(p)
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


/**
 * Distinguishes "draft" as a live instruction ("draft this now") from
 * "draft" describing something that already happened ("I drafted this",
 * "Carly had agreed for me to draft an agreement" — narrating a past
 * authorisation, not asking for one now). A bare word-boundary match on
 * "draft" catches both; this checks for a retrospective marker in the
 * immediate text before each occurrence and only counts the word as a
 * live instruction if at least one occurrence has no such marker nearby.
 * Confirmed against the real message that exposed this: "...Carly had
 * agreed for me to draft an agreement..." — "had agreed" sits right
 * before "draft" and correctly marks it as historical narrative, not an
 * instruction, once this check is applied.
 *
 * Fixed 2026-08-08 (third real occurrence): a real message pasted an
 * email containing "the draft agreement was met with silence" — a noun
 * phrase referring to an already-existing document, with nothing useful
 * in the text before "draft" at all. Added a second, "after" check:
 * "draft [agreement/document/letter/...]" immediately followed by a
 * past-tense state verb ("was", "has been", "remains") is treated as
 * historical too, since a live instruction would never be phrased that
 * way ("draft the agreement was..." is not a sentence anyone gives as
 * an instruction).
 */
function hasLiveDraftInstruction(p) {
  const retrospectiveMarkersBefore = /\b(had|has|have) (agreed|asked|confirmed|instructed|told|said)\b|\bwas (asked|instructed|told)\b|\boriginally\b|\bpreviously\b|\bback then\b|\bat that (time|point|stage)\b|\bthe original\b|\bwould have\b|\bwas intended\b|\bhad wanted\b|\bwhile i\b|\bas i\b|\bwhen i\b|\bwhile we\b|\bas we\b/i;
  const retrospectiveMarkersAfter = /^\s*(agreement|document|letter|email|reply|response|notice|award)?\s*(was|were|has been|had been|remains|is now|became|had|has)\b/i;
  const MAX_WINDOW = 60;
  const AFTER_WINDOW = 40;
  const regex = /\bdraft\b/gi;
  let match;
  while ((match = regex.exec(p)) !== null) {
    // Stop the lookback at the nearest clause boundary (comma, period,
    // or one of a few clear transition words), not just a fixed
    // character count — otherwise a retrospective marker earlier in a
    // long, comma-spliced dictated sentence can incorrectly suppress a
    // genuine, unrelated live instruction later in the same sentence.
    const searchStart = Math.max(0, match.index - MAX_WINDOW);
    let before = p.slice(searchStart, match.index);
    const boundaryMatch = before.match(/[,.;]|\bnow\b|\bso\b|\bthen\b/gi);
    if (boundaryMatch) {
      const lastBoundary = before.lastIndexOf(boundaryMatch[boundaryMatch.length - 1]);
      before = before.slice(lastBoundary + boundaryMatch[boundaryMatch.length - 1].length);
    }
    if (retrospectiveMarkersBefore.test(before)) continue; // historical via preceding text

    const after = p.slice(match.index + match[0].length, match.index + match[0].length + AFTER_WINDOW);
    if (retrospectiveMarkersAfter.test(after)) continue; // historical via following text — new

    return true; // a genuine, non-historical occurrence found
  }
  return false; // every occurrence was retrospective, or the word never appeared
}

function hasExplicitDraftRequest(prompt = '') {
  const p = normalisePromptForIntent(prompt).toLowerCase();

  if (!p) return false;

  // Fixed 2026-08-07: real, confirmed bug. A message opening "Let's
  // respond to X's email..." immediately matched the soft patterns below
  // and forced draft mode, regardless of how much of the actual message
  // was detailed analysis and argument-building — genuine collaboration
  // content, not ready-to-send text. Mode is decided here, before Terra
  // ever runs, so this single early match was silencing the Universal
  // Brain's own "understand before drafting" instructions entirely; they
  // never got a chance to apply. Confirmed against the real message that
  // triggered this: "Lets respond to Carly's email... [2000+ words of
  // detailed argument]".
  //
  // Unambiguous drafting language (the user is handing over ready
  // content, or explicitly using a drafting verb) still triggers draft
  // mode regardless of length.
  const unambiguousDraft =
    (hasLiveDraftInstruction(p)) ||
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

  if (unambiguousDraft) return true;

  // Ambiguous framing — "let's respond to X" / "reply to them" — can mean
  // either "here is the final text, send it" (short, direct) or "let's
  // work out how to respond" (long, substantive — genuine collaboration).
  // Only treat these as a draft trigger for short, direct messages,
  // matching the same 40-word threshold already used for the
  // draft_with_ely surface elsewhere in this file. A long, detailed
  // dictation opening with this phrasing falls through to discussion
  // intent / default discuss instead, so collaboration actually happens.
  const ambiguousDraftFraming =
    /\blet'?s (respond|reply)\b/i.test(p) ||
    /\blet'?s (respond|reply) to\b/i.test(p) ||
    /\brespond to (lewis|him|her|them|this|the email)\b/i.test(p) ||
    /\breply to (lewis|him|her|them|this|the email)\b/i.test(p) ||
    /\b(can|could) (you|we) (respond|reply)\b/i.test(p) ||
    /\b(respond|reply) (to|saying|with)\b/i.test(p);

  if (ambiguousDraftFraming) {
    const wordCount = p.split(/\s+/).filter(Boolean).length;
    if (wordCount < 40) return true;
    // Long, substantive message — do not force draft mode here. Falls
    // through to the rest of inferIntent (hasDiscussionIntent, default
    // 'discuss'), letting the Universal Brain's own collaboration-first
    // instructions actually apply.
  }

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

function looksLikeAmendmentInstruction(prompt = '') {
  const p = normalisePromptForIntent(prompt).toLowerCase();
  // Catches instructions to modify/add/change a draft that's already been produced
  return (
    /\badd (the|a|that|this|some|more)\b/i.test(p) ||
    /\binclude (the|a|that|this|it)\b/i.test(p) ||
    /\btake out\b/i.test(p) ||
    /\bremove (the|a|that)\b/i.test(p) ||
    /\bchange (the|a|that|this|anything)\b/i.test(p) ||
    /\bdon'?t change\b/i.test(p) ||
    /\bmake it\b/i.test(p) ||
    /\bkeep it\b/i.test(p) ||
    /\bshorter\b/i.test(p) ||
    /\blonger\b/i.test(p) ||
    /\badd that\b/i.test(p) ||
    /\balso (add|include|mention|say)\b/i.test(p) ||
    /\bput in\b/i.test(p) ||
    /\bmention (the|that|this)\b/i.test(p) ||
    /\bsay that\b/i.test(p) ||
    /\bcheck if\b/i.test(p) ||
    /\bseems (too|quite|very)\b/i.test(p) ||
    /\bthat('?s| is) (too|quite|very|not|wrong|correct|right|accurate|small|large|big)\b/i.test(p) ||
    // Fixed 2026-08-08 (real, confirmed miss): these three patterns
    // specifically cover the exact real message that exposed this gap
    // — "1 minor change I need to make is...", "just that one",
    // "don't change anything else" — none of the existing patterns
    // matched any of them, so mode came back as 'discuss' for a
    // message that was unmistakably a targeted amendment instruction.
    /\b(one|1|a|single) (minor|small|quick) (change|amendment|tweak|edit)\b/i.test(p) ||
    /\bjust (that one|this one|that|this)\b/i.test(p) ||
    /\bonly (change|amend) (that|this|the)\b/i.test(p)
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

  // Fixed 2026-08-07 (state-integrity correction): this previously
  // triggered on nothing more than "an email/thread is attached" —
  // true almost constantly in Project Chat — combined with ordinary
  // words like "change", "add", "shorter". Confirmed as a real, separate
  // over-eager mechanism, independent of the mode classifier fixes made
  // earlier today. Now requires a genuinely confirmed draft
  // (body.context.previousDraft, sourced exclusively from a prior
  // backend response's own `draft` field — never inferred from length,
  // email presence, or keyword content) before an amendment-shaped
  // phrase is treated as amendment mode at all.
  const confirmedDraft = body.context?.previousDraft || body.previousDraft || null;
  if (confirmedDraft && looksLikeAmendmentInstruction(p)) {
    return 'draft';
  }

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
    // Draft with Ely exists for drafting. Default is always draft.
    // Only route to discuss if the prompt is SHORT (under 40 words) AND
    // clearly asks for analysis — never override a substantial dictation.
    const wordCount = p.split(/\s+/).filter(Boolean).length;
    if (wordCount < 40 && hasDiscussionIntent(p)) return 'discuss';
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
Identify what is being asked, the underlying issue, tone, position changes and response strategy.`,

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
    facts.push('Adjoining Owners:');
    aos.slice(0, 12).forEach((ao, i) => {
      const name = [ao.name, ao.name2].filter(Boolean).join(' and ') || ao.owner_name || ao.ao_name || `AO ${i + 1}`;
      const address = ao.premise || ao.reg_addr || ao.address || ao.ao_premise_address || '';
      const email = ao.email || ao.ao_email || '';
      const status = ao.status || '';
      const surveyorName = ao.surv_name || ao.surveyor_name || ao.surveyorName || '';
      const surveyorFirm = ao.surv_firm || ao.surveyor_firm || ao.surveyorFirm || '';
      const thirdSurveyor = ao.third_surveyor_name || ao.thirdSurveyorName || '';
      const thirdFirm = ao.third_surveyor_firm || ao.thirdSurveyorFirm || '';
      let aoLine = `AO${ao.num || i + 1}: ${name}`;
      if (address) aoLine += `, ${address}`;
      if (email) aoLine += `, email: ${email}`;
      if (status) aoLine += `, status: ${status}`;
      if (surveyorName) aoLine += `, AO surveyor: ${surveyorName}${surveyorFirm ? ` (${surveyorFirm})` : ''}`;
      if (thirdSurveyor) aoLine += `, Third surveyor: ${thirdSurveyor}${thirdFirm ? ` (${thirdFirm})` : ''}`;
      facts.push(aoLine);
    });
  }

  return facts.join('\n');
}

// Strip signatures, legal disclaimers, and repeated boilerplate from email bodies
// extractLatestMessage: strips quoted reply chains from an email body.
// Returns only the sender's new content above the first quoted divider.
// Handles Outlook (--- date | From ---), Gmail (> ), and standard (From: header) patterns.
function extractLatestMessage(text = '') {
  if (!text) return '';
  const lines = text.split('\n');
  const cleaned = [];
  for (const line of lines) {
    const l = line.trim();
    // Stop at Outlook-style quoted divider: "--- DD Mon, HH:MM | From: ..."
    if (/^---\s+\d/.test(l)) break;
    // Stop at standard quoted reply header (From: on its own line after some content)
    if (/^from:\s+/i.test(l) && cleaned.length > 2) break;
    // Stop at Outlook forwarded/reply header block
    if (/^(sent|to|cc):\s+/i.test(l) && cleaned.length > 2 && cleaned.some(c => /^from:\s+/i.test(c.trim()))) break;
    // Stop at Gmail quote marker
    if (/^On .+ wrote:$/.test(l)) break;
    // Stop at horizontal rule separating quoted content
    if (/^_{5,}$/.test(l) || /^-{5,}$/.test(l)) break;
    cleaned.push(line);
  }
  return cleaned.join('\n').trim().slice(0, 1500);
}

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
  return cleaned.join('\n').trim().slice(0, 1500);
}

function buildEmailContextText({ body = {}, scopedEmailContext = [] }) {
  const supplied = buildSuppliedEmailContext(body);

  // Sort scopedEmailContext DESCENDING (newest first) before processing.
  // This ensures the newest emails are never truncated when there are more than 20 messages.
  const sortedScope = [...(scopedEmailContext || [])].sort((a, b) => {
    const da = new Date(a.received_at || a.sent_at || a.date || 0);
    const db = new Date(b.received_at || b.sent_at || b.date || 0);
    return db - da; // descending: newest first
  });

  // Build deduplicated email list.
  // supplied (the selected email) is always first regardless of date.
  const emails = [];
  const seen = new Set();

  const addEmail = (raw) => {
    const normalised = normaliseEmailRecord(raw);
    if (!normalised) return;
    const key = normalised.id || `${normalised.thread_id}|${normalised.date}|${normalised.subject}`;
    if (seen.has(key)) return;
    seen.add(key);
    emails.push(normalised);
  };

  if (supplied) addEmail({ ...supplied, _isSelected: true });

  // Add newest-first thread emails (up to 29 more after the selected)
  for (const email of sortedScope) {
    if (emails.length >= 30) break;
    addEmail(email);
  }

  if (!emails.length) return '';

  const selected = emails[0];

  // Extract only the sender's latest message from the selected email body,
  // stripping quoted reply chains so GPT sees the actual new content.
  const selectedBodyRaw = selected.body || '';
  const selectedBodyClean = extractLatestMessage(selectedBodyRaw);

  // Thread context: all emails after the selected, up to 20 (already newest-first)
  const thread = emails.slice(1, 21);

  return `
ACTIVE SELECTED EMAIL CONTEXT:
The user is drafting or preparing a response to the email below. This is the LATEST email that triggered the response. Read the sender's message carefully before the quoted history.

LATEST EMAIL — from ${selected.from || 'unknown'}:
From: ${selected.from || ''}
From email: ${selected.from_email || ''}
Subject: ${selected.subject || ''}
Date: ${selected.date || ''}

${selectedBodyClean || '(body not available)'}

${thread.length > 0 ? `THREAD CONTEXT -- ${thread.length} most recent email${thread.length === 1 ? '' : 's'} (newest first):
${thread.map((email, index) => `
[${index + 1}] ${new Date(email.date || 0).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} — From: ${email.from || 'unknown'}
Subject: ${email.subject || ''}
${cleanEmailBody(email.body || '')}
`).join('\n---\n')}` : ''}
`.trim().slice(0, 40000);
}

// Removed 2026-09-15: buildSystemPrompt() and buildMessages() (~758
// lines combined) previously sat here — the V1 pipeline's own prompt
// and message-array construction. Confirmed their only call sites
// were inside the V1 execution block removed earlier in this same
// commit; nothing else in this file, and nothing exported, ever
// called either one. Full audit trail in the dead-code audit
// document from this same date.

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
              model: 'claude-sonnet-4-6',
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
      if (query) fallback = fallback.or(`subject.ilike.%${query}%,body_preview.ilike.%${query}%`);

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


function parseBookingIntent(prompt = '') {
  const lower = prompt.toLowerCase();

  // Never trigger booking for party wall / construction professional content
  const isPartyWallContent = /schedule of condition|party wall|financial contribution|enclosure cost|award clause|section 11|section 6|section 2|section 10|adjoining owner|building owner|party structure|notice|dissent|agreed surveyor/i.test(lower);
  if (isPartyWallContent) return null;

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


function isStatutoryQuestion(prompt = '') {
  const lower = String(prompt || '').toLowerCase();
  return /section\s*\d|s\.\s*\d|party wall act|party structure notice|counter notice|adjacent excavation|line of junction|section 1[^0-9]|section 2[^0-9]|section 3[^0-9]|section 4[^0-9]|section 5[^0-9]|section 6[^0-9]|section 7[^0-9]|section 8[^0-9]|section 9[^0-9]|section 10|section 11|section 12|section 13|section 14|section 15|section 16|section 20|does.*act|must.*notice|notice.*require|required.*notice|statutory requirement|what.*act say|under the act|pursuant to|underpin|safeguard.*foundation|foundation.*safeguard|dispute.*procedure|resolution.*dispute|expense.*act|right.*entry|service.*notice|notice.*service|definition|what is a party wall|what is a party fence|what is a party structure|agreed surveyor|third surveyor|award.*appeal|appeal.*award|fee.*recover|recover.*fee|recoverable.*cost|cost.*recover|interim.*invoice|invoice.*interim|jurisdiction|surveyors?.*jurisdiction|dispute.*fee|fee.*dispute|costs.*award|award.*cost|consent.*notice|notice.*consent|damage.*claim|claim.*damage|making good|schedule of condition|no notice|notice.*expir|notice.*laps|notice.*valid|valid.*notice|appointing owner|appointed surveyor|named surveyor|refer.*third|third.*refer|ex parte|security.*expense|right of access|access.*right|without prejudice|compensation.*damage|damage.*compensation|enforce.*award|award.*enforce/i.test(lower);
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

// ── Claude case review ────────────────────────────────────────────────────

// ── Fallback for oversized requests — uses gpt-4o ────────────────────────
async function callClaude(messages = []) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) throw new Error('Missing OPENAI_API_KEY');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_completion_tokens: 3500,
      messages: messages.length ? messages : [{ role: 'user', content: 'Please help.' }],
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Fallback failed');

  const raw = payload.choices?.[0]?.message?.content || '';
  return cleanOutput(`*This is a bit too large for me -- let me get our admin team on that for you right away.* 📋\n\n${raw}`);
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



export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!OPENAI_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });

  try {
    const body = req.body || {};

    // ── Authenticate — derive user UUID from verified bearer token only.
    // Body-supplied user IDs are not trusted for identity.
    const verifiedUserId = await verifyBearerToken(req);
    if (!verifiedUserId) {
      return res.status(401).json({ error: 'Unauthorised — valid Supabase session required' });
    }

    // ── Silent read fast path — must come FIRST before any expensive lookups


    let projectId = inferProjectId(body);

    const resolvedProject = !projectId ? await resolveProjectFromPrompt(body.prompt) : null;
    if (resolvedProject?.id) projectId = resolvedProject.id;

    // Use verified UUID exclusively — body.userId retained only for non-auth session scoping
    const userId = verifiedUserId;

    // ── Silent read fast path

    const modeHint = inferModeHint(body.surface, body.prompt, body);
    const prompt = String(body.prompt || '').trim();
    const isDraftWithEly = String(body.mode || body.workflowStage || '').toLowerCase().includes('draft_with_ely');
    console.log('[ely-smart] isDraftWithEly=', isDraftWithEly, 'mode=', body.mode, 'workflowStage=', body.workflowStage);

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
            { role: 'system', content: 'You are Nora, a party wall surveyor assistant. Present the case review findings clearly and offer to discuss specific aspects or help draft a response.' },
            { role: 'user', content: `Here are Claude\'s findings from the full case review on "${body.case_review_topic}":\n\n${findings}\n\nPresent these findings to the surveyor clearly. Offer to help them work with any part of it -- drafting arguments, letters, or further analysis.` },
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
        reply: `Ooh, a case review -- now we're talking. 🕵️\n\nBefore I get the research department involved: are you looking to review a specific email or document, or do you want a full case file review across all correspondence, emails, notes and chat history on this project?\n\nIf it's the full works, tell me what you want me to focus on and I'll get them on it straight away.`,
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
        // Fixed 2026-09-16, real multi-user bug: previously hardcoded
        // to a single account here. verifyBearerToken() only returns
        // the UUID (used everywhere else in this file), not the
        // email that OneDrive's own account lookup is keyed by — a
        // small, local lookup here rather than changing that shared
        // function's return shape, which many other call sites depend on.
        let userEmailForPdf = null;
        try {
          const sbAuth = getSupabase();
          const { data: authUser } = await sbAuth.auth.admin.getUserById(userId);
          userEmailForPdf = authUser?.user?.email || null;
        } catch (emailLookupErr) {
          console.warn('[ely-smart] Could not resolve user email for invoice PDF:', emailLookupErr.message);
        }

        const pdfRes = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/generate-invoice-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoice: savedInvoice, invoice_id: savedInvoice.id, project_id: projectId, user_id: userEmailForPdf }),
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
        const itemLines = inv.items.map(i => `- ${i.description} -- £${parseFloat(i.total || i.amount || 0).toFixed(2)}`).join('\n');
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
          reply: `✅ Done -- booked in:\n\n**${booking.title}**\n📅 ${booking.displayDate}${booking.startTime ? ' at ' + booking.startTime : ''}${booking.projectAddress ? '\n📍 ' + booking.projectAddress : ''}`,
          booking_created: true,
          sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });
      } catch (err) {
        console.error('[ely-smart] booking creation failed:', err.message);
        return res.status(200).json({
          reply: `Sorry, I couldn't save that to the calendar -- ${err.message}. Please try adding it manually.`,
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

      const systemMsg = `You are Nora, a party wall surveying assistant. The user wants to book something in the calendar.

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
      /appointment|meeting|booked|confirmed|friday|monday|tuesday|wednesday|thursday|saturday|sunday|this week|next week|schedule|diary|calendar|check my email|search my email|have i.*email|did i.*email|who (is|are|did|confirmed|booked|sent)|any.*appointment|any.*meeting|tomorrow|today|yesterday|\d+(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(prompt)
    );
    // Fixed 2026-09-13, real, confirmed bug reported live immediately
    // after deploy: "cannot access 'asksAboutForgetting' before
    // initialization" — this was originally declared much further
    // down (by the calendar search block) but used earlier, here, by
    // the email search block below. Moved the declaration up to
    // before its first actual use.
    // Fixed 2026-09-13, real, confirmed gap found from a live test's
    // own diagnostic log: "I'm not sure if I've booked X" is one of
    // the most natural ways to ask this and didn't match any of the
    // original patterns (did I book / have I booked) at all. Broadened
    // to cover uncertainty phrasing generally, not just those two
    // specific constructions.
    const asksAboutForgetting = isMainChat && /\b(forgot|forgotten|slipped my mind|did i (miss|book)|have i (missed|booked)|not sure (if|whether)|don'?t know (if|whether)|can'?t remember|can'?t recall)\b/i.test(prompt);

    // Fixed 2026-09-14, real, confirmed gap reported live: "is there a
    // property that hasn't had a schedule of conditions booked in" is
    // a genuinely different question from "did I forget to book one
    // for today" — it's not about a specific appointment or date at
    // all, it's a direct request for the elimination list itself. The
    // asksAboutForgetting flow searches email first and only offers
    // this list as a fallback, which doesn't fit a direct question
    // like this — shown immediately here instead, no email search
    // needed first.
    const asksAboutMissingSoc = isMainChat && /\b(schedule of conditions?|\bsoc\b)/i.test(prompt) && /\b(hasn'?t had|haven'?t had|doesn'?t have|don'?t have|without a|not yet (had|booked)|which (propert|project)|any (propert|project))\b/i.test(prompt);

    // Added 2026-09-13, on request, after real, justified pushback:
    // "no errors" was being treated as "nothing went wrong", but a
    // keyword-match miss is a silent, valid code path, not a crash —
    // there was no visibility at all into whether this detection
    // fired for a given request. Logs the actual decision, not just
    // the outcome, so this is checkable directly in the logs for the
    // next real attempt rather than guessed at from the outside.
    if (isMainChat) {
      console.log('[ely-smart] inbox/forgot detection:', {
        promptPreview: String(prompt || '').slice(0, 120),
        asksAboutInbox,
        asksAboutForgetting,
        hasSuppliedEmailContext: !!suppliedEmailContext,
        hasEmailId: !!body.emailId,
        hasThreadId: !!body.threadId,
      });
    }

    if (asksAboutInbox) {
      try {
        const sb = getSupabase();
        if (sb) {
          const now = new Date();

          // Resolve relative date references to actual date ranges
          const resolveDate = (p) => {
            const lower = p.toLowerCase();
            const d = new Date(now);
            if (/\btomorrow\b/.test(lower)) { d.setDate(d.getDate() + 1); return { date: d, range: 'day' }; }
            if (/\btoday\b/.test(lower)) { return { date: d, range: 'day' }; }
            if (/\byesterday\b/.test(lower)) { d.setDate(d.getDate() - 1); return { date: d, range: 'day' }; }
            // Day name: next occurrence
            const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
            const dayMatch = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
            if (dayMatch) {
              const target = days.indexOf(dayMatch[1]);
              const current = d.getDay();
              const diff = (target - current + 7) % 7 || 7;
              d.setDate(d.getDate() + diff);
              return { date: d, range: 'day' };
            }
            // Explicit date: "30th July", "30 July", "July 30"
            const explicitMatch = lower.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)|(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/i);
            if (explicitMatch) {
              const months = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};
              const dayNum = parseInt(explicitMatch[1] || explicitMatch[4]);
              const monthStr = (explicitMatch[2] || explicitMatch[3]).toLowerCase();
              d.setMonth(months[monthStr], dayNum);
              return { date: d, range: 'day' };
            }
            if (/\bthis week\b/.test(lower)) { return { date: d, range: 'week' }; }
            if (/\bnext week\b/.test(lower)) { d.setDate(d.getDate() + 7); return { date: d, range: 'week' }; }
            return null;
          };

          const resolved = resolveDate(prompt);
          const topicMatch = prompt.match(/\b(appointment|meeting|inspection|soc|survey|visit|site|confirmed|schedule|booked|booking)\b/i);
          const topicTerm = topicMatch ? topicMatch[0].toLowerCase() : '';

          let query = sb
            .from('emails')
            .select('subject, from_name, sender_name, from_address, sender_email, received_at, body_preview, folder, project_id');

          if (resolved) {
            // Date-range filter: search emails received around the target date
            // AND search email bodies/subjects mentioning that date
            const targetDate = resolved.date;
            const dayStart = new Date(targetDate); dayStart.setHours(0,0,0,0);
            const dayEnd = new Date(targetDate); dayEnd.setHours(23,59,59,999);
            const weekStart = new Date(targetDate); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);

            // Format target date as strings to search in body
            const dateStr = targetDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
            const dateStr2 = targetDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            const dateNum = `${targetDate.getDate()}/${targetDate.getMonth()+1}`;
            const dateNum2 = `${String(targetDate.getDate()).padStart(2,'0')}/${String(targetDate.getMonth()+1).padStart(2,'0')}`;

            if (resolved.range === 'day') {
              // Fixed 2026-09-13, real, confirmed bug found while
              // investigating a live report: received_at.gte.X and
              // received_at.lte.Y were both loose top-level entries in
              // the same .or() array — meaning "received after X" OR
              // "received before Y", which is true for virtually every
              // email ever received, not "received on that specific
              // day". This never actually filtered by date at all; it
              // just returned whichever 15 emails were most recent
              // overall, which could easily push the actual relevant
              // email (if received days or weeks earlier) out of the
              // results entirely. Grouped the date range with and()
              // so it's genuinely AND'd together, only OR'd against
              // the separate body/subject date-mention checks.
              query = query.or([
                `and(received_at.gte.${dayStart.toISOString()},received_at.lte.${dayEnd.toISOString()})`,
                `subject.ilike.%${dateStr}%`,
                `body_preview.ilike.%${dateStr}%`,
                `subject.ilike.%${dateStr2}%`,
                `body_preview.ilike.%${dateStr2}%`,
                `body_preview.ilike.%${dateNum}%`,
                `body_preview.ilike.%${dateNum2}%`,
              ].join(','));
            } else {
              query = query
                .gte('received_at', weekStart.toISOString())
                .lte('received_at', weekEnd.toISOString());
            }
          } else if (topicTerm) {
            // No date — fall back to topic keyword search
            // Added 2026-09-13, on request: for a "did I forget to
            // book this" question with no specific date given, bound
            // this to the last three weeks by default rather than
            // searching every email ever sent/received — small,
            // easily-missed things like this are almost always recent.
            query = query.or(`subject.ilike.%${topicTerm}%,body_preview.ilike.%${topicTerm}%`);
            if (asksAboutForgetting) {
              const threeWeeksAgo = new Date(now);
              threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
              query = query.gte('received_at', threeWeeksAgo.toISOString());
            }
          } else {
            // No date, no topic — get recent emails
            query = query.order('received_at', { ascending: false }).limit(10);
          }

          const { data } = await query
            .order('received_at', { ascending: false })
            .limit(15);

          // Also fetch project titles for context
          const projectIds = [...new Set((data || []).map(e => e.project_id).filter(Boolean))];
          let projectMap = {};
          if (projectIds.length) {
            const { data: projs } = await sb.from('projects').select('id, bo_premise_address').in('id', projectIds);
            (projs || []).forEach(p => { projectMap[p.id] = p.bo_premise_address; });
          }

          generalInboxResults = (data || []).map(e => ({
            from: e.from_name || e.from_address || '',
            subject: e.subject || '',
            date: e.received_at ? new Date(e.received_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }) : '',
            body: cleanEmailBody(e.body || '').slice(0, 600),
            project: projectMap[e.project_id] || '',
          }));

          // Also search project_memory across all projects for date/appointment references
          try {
            const searchTerms = [];
            if (resolved) {
              const d2 = resolved.date;
              searchTerms.push(
                `${d2.getDate()} ${d2.toLocaleDateString('en-GB', { month: 'long' })}`,
                `${d2.getDate()} ${d2.toLocaleDateString('en-GB', { month: 'short' })}`,
                `${d2.getDate()}/${d2.getMonth()+1}`,
              );
            }
            if (topicTerm) searchTerms.push(topicTerm);

            if (searchTerms.length) {
              const orFilter = searchTerms.map(t => `content.ilike.%${t}%`).join(',');
              const { data: memData } = await sb
                .from('project_memory')
                .select('content, source_type, created_at, project_id')
                .or(orFilter)
                .order('created_at', { ascending: false })
                .limit(10);

              if (memData?.length) {
                // Get project addresses for memory entries
                const memProjectIds = [...new Set(memData.map(m => m.project_id).filter(Boolean))];
                let memProjectMap = { ...projectMap };
                if (memProjectIds.length) {
                  const { data: memProjs } = await sb.from('projects').select('id, bo_premise_address').in('id', memProjectIds);
                  (memProjs || []).forEach(p => { memProjectMap[p.id] = p.bo_premise_address; });
                }

                const memResults = memData.map(m => ({
                  type: 'project_note',
                  project: memProjectMap[m.project_id] || '',
                  source: m.source_type || 'note',
                  date: m.created_at ? new Date(m.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
                  content: (m.content || '').slice(0, 500),
                }));

                // Append to generalInboxResults as project memory hits
                generalInboxResults = [
                  ...generalInboxResults,
                  ...memResults,
                ];
              }
            }
          } catch (memErr) {
            console.warn('[ely-smart] project_memory search failed:', memErr.message);
          }
        }
      } catch (err) {
        console.warn('[ely-smart] general inbox search failed:', err.message);
      }
    }

    // ── Elimination list ────────────────────────────────────────────────
    // Added 2026-09-13, on request: the agreed fallback when a "did I
    // forget to book this" search comes up empty — rather than leaving
    // the user stuck with nothing, list every project/AO that's at a
    // stage where this kind of thing would plausibly be outstanding,
    // so they can work through it together rather than search blind.
    let eliminationResults = [];
    if (asksAboutForgetting || asksAboutMissingSoc) {
      try {
        const sb = getSupabase();
        if (sb) {
          const { data: aoRows } = await sb
            .from('adjoining_owners')
            .select('id, name, address, status, project_id, soc_agreed_date, notice_served_date')
            .is('soc_agreed_date', null)
            .in('status', ['consent', 'dissent', 'notice_served'])
            .limit(40);
          const projIds = [...new Set((aoRows || []).map(a => a.project_id).filter(Boolean))];
          let projMap = {};
          if (projIds.length) {
            const { data: projRows } = await sb.from('projects').select('id, ref, bo_premise_address, status').in('id', projIds);
            (projRows || []).forEach(p => { projMap[p.id] = p; });
          }
          eliminationResults = (aoRows || [])
            .filter(a => {
              // Only genuinely active projects — skip anything already closed/completed
              const proj = projMap[a.project_id];
              return proj && !/complete|closed|archived/i.test(proj.status || '');
            })
            .map(a => ({
              project: projMap[a.project_id]?.ref || projMap[a.project_id]?.bo_premise_address || 'Unknown project',
              ao: a.name || a.address || 'Unknown AO',
              status: a.status,
              noticeServed: a.notice_served_date || null,
            }));
        }
      } catch (elimErr) {
        console.warn('[ely-smart] elimination list failed:', elimErr.message);
      }
    }

    // ── Calendar search ──────────────────────────────────────────────────
    // When asking about appointments/dates, check the tasks/calendar table too
    // "have I forgotten to book something" is a fundamentally
    // different question from "what's booked" — the user already
    // knows it's not in the calendar, that's exactly why they're
    // asking. Searching the calendar for this wastes a query and,
    // worse, risks the model treating an empty calendar result as
    // meaningful when it was never the right place to look.
    // (asksAboutForgetting itself is declared earlier, above, since
    // it's also needed by the email search block before this one.)
    let calendarResults = [];
    if (asksAboutInbox && !asksAboutForgetting) {
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
            .select('title, description, due_date, start_time, project_address_snapshot, ao_address_snapshot, task_type, status, project_id')
            .neq('status', 'completed')
            .order('due_date', { ascending: true })
            .limit(10);

          if (dateFrom) query = query.gte('due_date', dateFrom);
          if (dateTo) query = query.lte('due_date', dateTo);

          const { data } = await query;

          // Fixed 2026-09-14, real, confirmed bug reported live: a
          // task can be genuinely linked to a project via project_id
          // while its own address snapshot field was simply never
          // populated at creation time — the previous version only
          // ever read the snapshot, with no fallback, so a
          // genuinely-linked task could still report as having no
          // known project/property at all. Falls back to a live
          // lookup against the actual linked project when the
          // snapshot is empty but a real project_id exists.
          const tasksNeedingLookup = (data || []).filter(t => !t.project_address_snapshot && !t.ao_address_snapshot && t.project_id);
          let liveProjectAddresses = {};
          if (tasksNeedingLookup.length) {
            const lookupIds = [...new Set(tasksNeedingLookup.map(t => t.project_id))];
            const { data: liveProjects } = await sb.from('projects').select('id, bo_premise_address, ref').in('id', lookupIds);
            (liveProjects || []).forEach(p => { liveProjectAddresses[p.id] = p.bo_premise_address || p.ref; });
          }

          calendarResults = (data || []).map(t => ({
            title: t.title || t.task_type || 'Appointment',
            date: t.due_date ? new Date(t.due_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }) : '',
            time: t.start_time || '',
            address: t.project_address_snapshot || t.ao_address_snapshot || (t.project_id ? liveProjectAddresses[t.project_id] : '') || '',
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
    // On draft_with_ely surface, never bulk-fetch project emails.
    // Words like "correspondence", "reply", "received" appear naturally in dictated draft content
    // and must NOT trigger a database fetch. Only load emails if an actual email is supplied
    // (i.e. replying to an existing email) or the user explicitly asks to search correspondence.
    const explicitResearchRequest = /\b(check|find|look up|search|what did they say|previous email|earlier email|check my email|search correspondence|review.*email|read.*email)\b/i.test(prompt);

    // RULE: Only load emails when explicitly requested by the user.
    // On drafting surfaces (draft_with_ely, inbox_draft): never load project emails.
    // The current email being replied to is already in emailContext.body — no fetch needed.
    // On all other surfaces: only load if prompt clearly references existing correspondence.
    const isDraftingSurface = isDraftWithEly || body.surface === 'inbox_draft' || body.surface === 'clause_request';
    const isProjectChatSurface = isProjectChat || body.surface === 'project_chat';
    // On drafting surfaces (draft_with_ely, inbox_draft) — only load emails when explicitly requested.
    // The current email is already in emailContext — no fetch needed for routine replies.
    // On project chat and main chat — use wantsEmailContext which checks for "email", "thread",
    // "correspondence", "what did they say" etc. This is correctly calibrated and won't fire
    // on every routine project chat message, but will fire on natural email-referencing phrases.
    const needsEmails = isDraftingSurface
      ? explicitResearchRequest
      : (hasSuppliedEmail || wantsEmailContext(prompt, projectId, suppliedEmailContext, body.threadId, body.emailId));
    // Project loading strategy:
    // - Drafting surfaces (draft_with_ely, inbox_draft, project_chat): load slim facts only
    //   (BO/AO names, notices, memory). Semantic search provides relevant emails on demand.
    // - Full bundle only loads when emails are explicitly requested or on non-project surfaces.
    const needsFullBundle = !isProjectChatSurface && !isDraftingSurface;
    const needsBrain = true; // always load brain
    // Added 2026-09-10, on request: only relevant to the clause
    // surface — genuinely irrelevant elsewhere.
    const needsClauseLibrary = body.surface === 'clause_request';

    const [projectBundle, scopedEmailContext, brain, clauseLibraryMatches] = await Promise.all([
      projectId
        ? (needsFullBundle ? loadProjectBundle(projectId) : loadProjectFacts(projectId))
        : Promise.resolve(null),
      needsEmails ? buildScopedEmailContext({
        prompt: body.prompt,
        projectId,
        emailContext: suppliedEmailContext,
        threadId: body.threadId || body.emailContext?.threadId || body.emailContext?.thread_id,
        emailId: body.emailId || body.emailContext?.emailId || body.emailContext?.id,
      }) : Promise.resolve(suppliedEmailContext ? [suppliedEmailContext] : []),
      needsBrain ? loadBrain({ userId, projectId, surface: body.surface, modeHint }) : Promise.resolve(null),
      needsClauseLibrary ? matchClauseLibrary(body.prompt) : Promise.resolve([]),
    ]);

    // ── Brain layer diagnostic logging ───────────────────────────────────────
    console.log('[ely-smart] brain layers:', JSON.stringify({
      global_core:    brain?.global_core?.system_prompt ? brain.global_core.system_prompt.length + 'ch' : 'MISSING',
      global_drafting: brain?.global_drafting?.system_prompt ? brain.global_drafting.system_prompt.length + 'ch' : 'MISSING',
      knowledge_layer: brain?.knowledge_layer?.system_prompt ? brain.knowledge_layer.system_prompt.length + 'ch' : 'MISSING',
      user_brain:     brain?.user_brain?.brain_content ? brain.user_brain.brain_content.length + 'ch' : 'MISSING',
      brain_null:     brain === null,
    }));
    console.log('[ely-smart] project bundle:', JSON.stringify({
      has_project:    !!projectBundle?.project?.id,
      ao_count:       (projectBundle?.adjoining_owners || []).length,
      email_count:    (projectBundle?.project_emails || []).length,
      memory_count:   (projectBundle?.project_memory || []).length,
    }));
    // Added 2026-08-18, diagnostic: real-time check of whether
    // contacts data is actually arriving in the request at all, per
    // reported issue in project chat.
    // Fixed 2026-08-21: extracted into a real variable here (used to
    // be recomputed inline in the log below, and separately again
    // much later for V1) — needed earlier now too, for the v2
    // contact-correction fix, which runs before the later V1-only
    // extraction point is ever reached.
    const contactsContext = body?.context?.contacts || body?.contacts || [];
    console.log('[ely-smart] contacts received:', JSON.stringify({
      count: contactsContext.length,
      sample: contactsContext[0] || null,
    }));

    const representation = resolveRepresentation({ body, projectBundle });

    let draftingExamples = [];

    try {
      // ── GOLD STANDARD SELECTION ──────────────────────────────────────────
      // Classify the drafting task using the combined instruction + email context.
      // Never use word count. Default uncertain correspondence to complex_analytical.
      const _gsEmail = scopedEmailContext?.[0] || null;
      const _gsEmailSignal = _gsEmail
        ? `${_gsEmail.subject || ''}\n${(_gsEmail.body || '').slice(0, 500)}\n${(_gsEmail.body || '').slice(-500)}`
        : '';
      const _gsCt = [prompt, _gsEmailSignal].filter(Boolean).join('\n');

      const _hasComplex = /\bdisput|\bdo\s+not\s+agree\b|\bdo\s+not\s+accept\b|\breject\b|\bchalleng|\binterim\s+fee\b|\bdisputed\s+fee\b|\bunreasonable\s+fee\b|\bfee\s+not\s+recover|\brecoverable\s+costs\b|\bthird\s+surveyor\s+referral\b|\brefer\s+to\s+the\s+third\s+surveyor\b|\bthird\s+surveyor\s+determination\b|\bnotice\s+expir|\bnotices?\s+expired\b|\bnotice\s+laps|\bcase\s+law\b|\bstatutory\s+interpretation\b|\bsection\s+\d|\bbreach\b|\bliability\b|\bwithout\s+prejudice\b|\bclaim\b|\bdamages\b|\benforcement\b|\bcontrary\s+position\b|\bprofessional\s+disagreement\b|\bdetermination\b|\bnot\s+recover\b|\bcosts\s+order\b|\bpursu|\btakes?\s+issue\b|\bcontested\b/i.test(_gsCt);

      const _hasSimple = /\bconfirm\b|\bconfirmation\b|\bthanks\b|\bthank\s+you\b|\breceived\b|\bnoted\b|\bavailability\b|\bsend\s+over\b|\bplease\s+send\b|\bhappy\s+to\b|\bpleased\s+to\b|\blet\s+me\s+know\b|\bquick\s+(?:question|reply|note)\b|\bjust\s+(?:to\s+)?(?:confirm|check|let\s+you\s+know)\b/i.test(_gsCt);

      const _targetCategory = (_hasSimple && !_hasComplex)
        ? 'short_factual_reply'
        : 'complex_analytical';

      const { data: _exData } = await getSupabase()
        .from('ai_drafting_examples')
        .select('*')
        .eq('active', true)
        .eq('category', _targetCategory)
        .limit(1);

      draftingExamples = _exData || [];
      console.log(`[ely-smart] drafting example: category=${_targetCategory} found=${draftingExamples.length} complex=${_hasComplex} simple=${_hasSimple}`);
    } catch (err) {
      console.warn('[ely-smart] drafting examples load failed:', err.message);
    }

    // Fixed 2026-09-13, real, critical bug found live after extensive
    // debugging with the user: generalInboxResults/calendarResults/
    // eliminationResults were computed correctly above, but every
    // consumer of them (the messages.splice() injection further down)
    // lives entirely in the V1 codepath, which never runs at all for
    // any request routed to V2 — confirmed this is every main_chat
    // request tonight, via the diagnostic logging added earlier this
    // session and the routing comment immediately below this block.
    // Built as its own string here, before the V2/V1 routing
    // decision, so it reaches whichever path actually runs.
    let inboxSearchContextForV2 = null;
    // Fixed 2026-09-14, on request: "is there a property that hasn't
    // had a schedule of conditions booked in" is a direct request for
    // the elimination list itself, not a specific-date/appointment
    // question -- handled as its own, separate case, shown directly
    // rather than withheld pending confirmation (unlike the "forgot"
    // flow's fallback use of the same list), and without the
    // calendar/email search noise that question doesn't need.
    if (isMainChat && asksAboutMissingSoc) {
      console.log('[ely-smart] missing-SOC elimination results:', { eliminationResultsCount: eliminationResults.length });
      if (eliminationResults.length > 0) {
        inboxSearchContextForV2 = `The user is asking which properties/projects do not yet have a Schedule of Condition recorded. Use the list below directly to answer -- do not withhold it, this is exactly what was asked for.\n\nPROJECTS WITH NO SCHEDULE OF CONDITION RECORDED (${eliminationResults.length}):\n\n${eliminationResults.map(e =>
          `${e.project} -- ${e.ao} (status: ${e.status}${e.noticeServed ? ', notice served ' + e.noticeServed : ''})`
        ).join('\n')}`;
      } else {
        inboxSearchContextForV2 = `The user is asking which properties/projects do not yet have a Schedule of Condition recorded. None were found -- every active project's adjoining owners past consent/dissent stage already have one recorded. Say so plainly.`;
      }
    } else if (isMainChat && (asksAboutInbox || asksAboutForgetting)) {
      console.log('[ely-smart] inbox/forgot search results:', {
        generalInboxResultsCount: generalInboxResults.length,
        calendarResultsCount: calendarResults.length,
        eliminationResultsCount: eliminationResults.length,
      });
      let contextBlock = '';
      if (calendarResults.length > 0) {
        contextBlock += `DIARY/CALENDAR -- appointments found:\n\n${calendarResults.map(e =>
          `${e.date}${e.time ? ' at ' + e.time : ''}: ${e.title}${e.address ? ' -- ' + e.address : ''}${e.description ? '\n' + e.description : ''}`
        ).join('\n\n')}\n\n`;
      } else if (asksAboutInbox && !asksAboutForgetting) {
        contextBlock += `DIARY/CALENDAR -- no appointments found in the requested period.\n\n`;
      }
      if (generalInboxResults.length > 0) {
        contextBlock += `INBOX SEARCH${asksAboutForgetting ? ' (last three weeks, since no specific date was given)' : ''} -- emails matching the query:\n\n${generalInboxResults.map(e =>
          `From: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\n${e.body}`
        ).join('\n\n---\n\n')}\n\n`;
      } else if (asksAboutInbox) {
        contextBlock += `INBOX SEARCH${asksAboutForgetting ? ' (last three weeks, since no specific date was given)' : ''} -- no matching emails found.\n\n`;
      }
      if (asksAboutForgetting) {
        if (eliminationResults.length > 0) {
          contextBlock += `PROJECTS THAT MAY BE RELEVANT (available if the user wants to work through them -- do NOT list these out unless the email search above found nothing and the user has confirmed they want to see this list; otherwise just mention this option is available if needed):\n\n${eliminationResults.map(e =>
            `${e.project} -- ${e.ao} (status: ${e.status}${e.noticeServed ? ', notice served ' + e.noticeServed : ''})`
          ).join('\n')}\n\n`;
        } else {
          contextBlock += `PROJECTS THAT MAY BE RELEVANT -- none found (no active project currently has an adjoining owner past consent/dissent stage with no Schedule of Condition recorded).\n\n`;
        }
      }
      if (contextBlock.trim()) {
        inboxSearchContextForV2 = asksAboutForgetting
          ? `The user is asking whether they forgot to book or do something -- they already know it is not in the calendar, that is why they are asking, so never mention having checked or not checked the diary for this. Use the email search results below to answer. If genuinely nothing relevant was found in the last three weeks, say so plainly and ask whether they would like you to look back further, or whether they would like you to go through the list of projects that could plausibly be relevant instead -- do not show that list unless they say yes to it.\n\n${contextBlock}`
          : `Use the following diary and email information to answer the user's question accurately. Cross-reference both. If an appointment appears in emails but not the diary, say so explicitly.\n\n${contextBlock}`;
      }
    } else if (isMainChat && asksAboutInbox) {
      inboxSearchContextForV2 = `INBOX AND DIARY SEARCH: Both were searched but nothing matching was found. Tell the user honestly that you checked both the diary and emails and couldn't find anything matching their query.`;
    }

    // ── NORA V2: single routing decision point ──────────────────────────────
    // resolveArchitectureVersion() is the ONLY place either version is chosen.
    // Exactly one of V1 or V2 runs for this request — never both, never a
    // merge. Absence of either the env flag or the allowlist match falls
    // through to V1 with zero other code change required: everything below
    // this block (Phase 2A, buildSystemPrompt, buildMessages, the V1 model
    // call) is completely unmodified and runs exactly as it always has.
    const v2ArchitectureVersion = resolveArchitectureVersion({
      brainVersionEnv: process.env.NORA_BRAIN_VERSION,
      userId,
    });

    if (v2ArchitectureVersion === 'v2') {
      try {
        const { replyText, draft, diagnostics } = await runV2Pipeline({
          userId,
          surface: body.surface || '',
          modeHint,
          prompt,
          representation,
          effectiveProjectId: projectBundle?.project?.id || projectId,
          projectBundle,
          scopedEmailContext,
          hasExplicitEmailSelection: !!(suppliedEmailContext || body.threadId || body.emailId || body.emailContext?.threadId || body.emailContext?.id),
          chatHistory: body.chatHistory || [],
          confirmedDraftText: body.context?.previousDraft || body.previousDraft || null,
          draftingExamples,
          domainKnowledgeText: brain?.knowledge_layer?.system_prompt || null,
          contactsContext,
          clauseLibraryMatches,
          inboxSearchContext: inboxSearchContextForV2,
        });
        console.log('[nora-v2] response served', {
          surface: body.surface, mode: modeHint, model: diagnostics.model_returned, hasDraft: !!draft,
        });
        return res.status(200).json({ reply: replyText, draft, draftType: draft ? 'email' : null, mode: modeHint, architecture_version: 'v2' });
      } catch (v2Err) {
        console.error('[nora-v2] pipeline failed:', v2Err.message);
        return res.status(500).json({ error: 'Nora V2 request failed', detail: v2Err.message });
      }
    }

    // Removed 2026-09-15: the entire V1 execution path (Phase 2A
    // Stage 1 reasoning glue, buildSystemPrompt(), buildMessages(),
    // and the V1 model call itself — ~477 lines) previously sat
    // here. Confirmed genuinely, structurally unreachable, not just
    // unused: resolveArchitectureVersion() always returns 'v2' now
    // (d974a675), and the V2 branch above returns on every path,
    // including its own catch block — there was no scenario under
    // which execution could ever reach past it. Full audit trail in
    // the dead-code audit document from this same date. The
    // Phase 2A functions themselves (generateStage1Brief,
    // semanticSearchProject, runStage1ShadowTask, etc.) are untouched
    // — they're defined much earlier in this file and are still
    // directly unit-tested; only the V1 request-handling code that
    // called them as part of a live request is gone.
  } catch (err) {
    console.error('[ely-smart] error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Test-only exports (Phase 2A) ────────────────────────────────────────────
// Does not change production behaviour — the default export (the Vercel
// handler) is unchanged. Exposed only so Phase 2A's Stage 1 logic can be
// unit-tested without mocking the entire request pipeline.
export { generateStage1Brief, emptyRetrievedAuthority, STAGE1_VALIDATION_RESULT, semanticSearchProject, runStage1ShadowTask, STAGE1_COMPLETION_TOKEN_LIMIT };
