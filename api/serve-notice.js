import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function addDaysIso(dateIso, days) {
  const d = new Date(`${dateIso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function safeInsert(supabase, table, payload) {
  let p = { ...payload };
  let lastError = null;

  for (let i = 0; i < 10; i += 1) {
    const { data, error } = await supabase
      .from(table)
      .insert([p])
      .select('*')
      .single();

    if (!error) return data;
    lastError = error;

    const missing = error.message?.match(/Could not find the '([^']+)' column/)?.[1];
    if (missing && Object.prototype.hasOwnProperty.call(p, missing)) {
      const next = { ...p };
      delete next[missing];
      p = next;
      continue;
    }

    throw error;
  }

  throw lastError || new Error(`Could not insert ${table}`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const supabase = getSupabase();
    const body = req.body || {};
    const projectId = body.project_id;
    const aoId = body.ao_id;
    const noticeType = body.notice_type;
    const noticeDate = body.notice_date;
    const works = body.notifiable_works || null;
    const templateType = body.template_type || noticeType;
    const createReminder = body.create_reminder !== false;
    const includeCoverLetter = body.include_cover_letter !== false;
    const section2Subsections = body.section_2_subsections || null;

    if (!projectId) throw new Error('project_id is required');
    if (!aoId) throw new Error('ao_id is required');
    if (!noticeType) throw new Error('notice_type is required');
    if (!noticeDate) throw new Error('notice_date is required');

    const isS10 = noticeType === 'section_10';
    const deadlineDate = addDaysIso(noticeDate, isS10 ? 10 : 14);

    // Calculate next run_number for this project/AO
    const { data: existingRuns } = await supabase
      .from('notices')
      .select('run_number')
      .eq('project_id', projectId)
      .eq('ao_id', aoId)
      .order('run_number', { ascending: false })
      .limit(1);
    const runNumber = existingRuns?.[0]?.run_number
      ? existingRuns[0].run_number + 1
      : 1;

    const notice = await safeInsert(supabase, 'notices', {
      project_id: projectId,
      ao_id: aoId,
      section_1: noticeType === 'section_1',
      section_3: noticeType === 'section_3',
      section_6: noticeType === 'section_6',
      section_10: isS10,
      notice_cover_letter: includeCoverLetter,
      section_1_notifiable_works: noticeType === 'section_1' ? works : null,
      section_3_notifiable_works: noticeType === 'section_3' ? works : null,
      section_6_notifiable_works: noticeType === 'section_6' ? works : null,
      notice_date: noticeDate,
      status: 'served',
      template_type: templateType,
      run_number: runNumber,
      section_2_subsections: noticeType === 'section_2' ? section2Subsections : null,
    });

    return res.status(200).json({
      success: true,
      notice,
      task: null,
      deadline_date: deadlineDate,
      status_patch: isS10
        ? {
            status: 's10',
            s10_served_date: noticeDate,
            s10ServedDate: noticeDate,
            s10_deadline: deadlineDate,
            s10Deadline: deadlineDate,
          }
        : {
            status: 'notice_served',
            notice_served_date: noticeDate,
            noticeServedDate: noticeDate,
            consent_deadline: deadlineDate,
            consentDeadline: deadlineDate,
          },
    });
  } catch (err) {
    console.error('[serve-notice] error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Could not record served notice' });
  }
}
