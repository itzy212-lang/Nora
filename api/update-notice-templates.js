// api/update-notice-templates.js
// One-time admin endpoint: reads fixed notice templates from GitHub and updates DB
// Call once with GET /api/update-notice-templates?secret=<ADMIN_SECRET>

import { createClient } from '@supabase/supabase-js';

const TEMPLATES = [
  { key: 'cover', id: 'f9c215c6-66db-4c6c-a8b2-0f67b2cd09e4', file: 'ORIGNAL_NOTICE_LETTER_TEMPLATE_fixed.docx' },
  { key: 's1',    id: 'bbba8ff2-936b-46ab-94dd-cd56584f2fe3', file: 'Section_1_Notice_TEMPLATE_v2_fixed.docx' },
  { key: 's3',    id: 'e9448404-3a90-429f-abb6-1be3eaf5146a', file: 'Section_3_Notice_TEMPLATE_V2_fixed.docx' },
  { key: 's6',    id: '4d081357-23ab-42a8-ab98-54c351f5d8cd', file: 'Section_6_Notice_TEMPLATE_M_fixed.docx' },
];

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'itzy212-lang/nora';

function getServerClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export default async function handler(req, res) {
  // Simple secret check
  const secret = req.query.secret || req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getServerClient();
  if (!supabase) return res.status(500).json({ error: 'Supabase unavailable' });

  const results = [];

  for (const tmpl of TEMPLATES) {
    try {
      // Fetch from GitHub
      const ghRes = await fetch(
        `https://api.github.com/repos/${REPO}/contents/templates/${tmpl.file}`,
        { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } }
      );
      if (!ghRes.ok) throw new Error(`GitHub fetch failed: ${ghRes.status}`);
      const ghData = await ghRes.json();
      const file_b64 = ghData.content.replace(/\n/g, '');
      const file_size = Math.round(file_b64.length * 0.75);

      // Update DB
      const { error } = await supabase
        .from('document_templates')
        .update({ file_b64, file_size, updated_at: new Date().toISOString() })
        .eq('id', tmpl.id);

      if (error) throw new Error(error.message);
      results.push({ key: tmpl.key, status: 'updated', size: file_size });
      console.log(`[update-notice-templates] ${tmpl.key}: updated (${file_size} bytes)`);
    } catch (err) {
      results.push({ key: tmpl.key, status: 'error', error: err.message });
      console.error(`[update-notice-templates] ${tmpl.key}: ${err.message}`);
    }
  }

  return res.status(200).json({ success: true, results });
}
