// api/generate-doc.js — Full version with PDF conversion and Supabase Storage
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
  );
}

// ── PDF CONVERSION via API2PDF ────────────────────────────────
async function convertDocxToPdf(storagePath, fileName) {
  const apiKey = process.env.API2PDF_API_KEY;
  if (!apiKey) {
    console.warn('[generate-doc] API2PDF_API_KEY not set — skipping PDF conversion.');
    return null;
  }
  try {
    const supabase = getSupabase();
    const { data: signedData, error: signedErr } = await supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 120);

    if (signedErr || !signedData?.signedUrl) {
      console.error('[generate-doc] Could not create signed URL:', signedErr?.message);
      return null;
    }

    const res = await fetch('https://v2.api2pdf.com/libreoffice/any-to-pdf', {
      method: 'POST',
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: signedData.signedUrl,
        fileName: (fileName || 'document').replace(/\.docx$/i, '.pdf')
      })
    });

    const data = await res.json();
    if (!res.ok || !data.FileUrl) {
      console.error('[generate-doc] API2PDF error:', res.status, JSON.stringify(data));
      return null;
    }

    const pdfRes = await fetch(data.FileUrl);
    const pdfBuf = await pdfRes.arrayBuffer();
    return Buffer.from(pdfBuf).toString('base64');
  } catch (err) {
    console.error('[generate-doc] PDF conversion exception:', err.message);
    return null;
  }
}

// ── SUPABASE STORAGE UPLOAD ───────────────────────────────────
async function uploadToStorage(fileBuffer, fileName, projectId) {
  const supabase = getSupabase();
  const safeName = fileName.replace(/[^a-zA-Z0-9._\-\s]/g, '_');
  const filePath = `${projectId}/${Date.now()}_${safeName}`;

  const { error } = await supabase.storage
    .from('documents')
    .upload(filePath, fileBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: false
    });

  if (error) throw error;
  return filePath;
}

// ── SAVE DOCUMENT RECORD ──────────────────────────────────────
async function saveDocRecord({ project_id, ao_id, file_name, file_type, category, storage_path, user_id, section_type }) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('documents')
    .insert([{
      project_id,
      ao_id: ao_id || null,
      file_name,
      file_type: file_type || 'docx',
      category: category || 'document',
      storage_path,
      user_id: user_id || null,
      section_type: section_type || null,
      created_at: new Date().toISOString(),
      status: 'generated',
      version: 1
    }])
    .select('id')
    .single();

  if (error) { console.error('DB insert error:', error.message); return null; }
  return data?.id || null;
}

// ── TEMPLATE FILL ─────────────────────────────────────────────
function fillTemplate(templateB64, mergeData) {
  const buf = Buffer.from(templateB64, 'base64');
  const zip = new PizZip(buf);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    errorLogging: false,
  });

  const tdata = {};
  Object.keys(mergeData || {}).forEach(k => {
    const cleanKey = k.replace(/^\{\{/, '').replace(/\}\}$/, '');
    tdata[cleanKey] = mergeData[k] ?? '';
  });

  doc.render(tdata);
  return {
    output: doc.getZip().generate({ type: 'base64', compression: 'DEFLATE' }),
    tdata
  };
}

// ── HANDLER ───────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { template_b64, merge_data, output_format } = req.body || {};

    if (!template_b64) return res.status(400).json({ error: 'No template provided' });

    let output, tdata;
    try {
      ({ output, tdata } = fillTemplate(template_b64, merge_data));
    } catch (fillErr) {
      return res.status(500).json({ error: fillErr.message || 'Template render failed' });
    }

    const buffer = Buffer.from(output, 'base64');
    const rawName = tdata.file_name || 'document.docx';
    const fileName = rawName.toLowerCase().endsWith('.docx') ? rawName : `${rawName}.docx`;
    const projectId = tdata.project_id || merge_data?.project_id || 'unknown';

    // Upload to Supabase Storage
    let storagePath = null;
    let docId = null;
    try {
      storagePath = await uploadToStorage(buffer, fileName, projectId);
      docId = await saveDocRecord({
        project_id: projectId,
        ao_id: tdata.ao_id || merge_data?.ao_id || null,
        file_name: fileName,
        category: tdata.category || 'document',
        storage_path: storagePath,
        user_id: tdata.user_id || null,
        section_type: tdata.section_type || null,
      });
    } catch (storeErr) {
      console.warn('[generate-doc] Storage/DB failed (non-fatal):', storeErr.message);
    }

    // Convert to PDF for Firma signing
    const pdfB64 = storagePath
      ? await convertDocxToPdf(storagePath, fileName)
      : null;

    return res.status(200).json({
      success: true,
      docx_b64: output,
      pdf_b64: pdfB64 || null,
      storage_path: storagePath,
      doc_id: docId,
    });

  } catch (err) {
    console.error('[generate-doc] fatal error:', err);
    return res.status(500).json({ error: err.message || 'Document generation failed' });
  }
}
