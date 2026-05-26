// api/generate-doc.js

import { createClient } from '@supabase/supabase-js';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function safeFileName(value) {
  return String(value || 'document.docx')
    .replace(/[^\w\s.\-()]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function encodeXmlEntities(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normaliseMergeData(data = {}) {
  const out = { ...(data || {}) };

  Object.keys(out).forEach(key => {
    if (out[key] === null || out[key] === undefined) {
      out[key] = '';
    }

    if (key.includes('&')) {
      out[key.replace(/&/g, '&amp;')] = out[key];
    }

    if (key.includes('&amp;')) {
      out[decodeXmlEntities(key)] = out[key];
    }
  });

  return out;
}

function simplifyDocxError(err) {
  try {
    if (err?.properties?.errors?.length) {
      return err.properties.errors
        .slice(0, 12)
        .map(e => {
          const explanation =
            e?.properties?.explanation ||
            e?.properties?.id ||
            e?.message ||
            'Template error';

          const tag =
            e?.properties?.xtag ||
            e?.properties?.tag ||
            '';

          return tag ? `${tag}: ${explanation}` : explanation;
        })
        .join(' | ');
    }

    return err?.message || 'Document generation failed.';
  } catch {
    return err?.message || 'Document generation failed.';
  }
}

function normaliseTemplateXml(xml) {
  let out = String(xml || '');

  out = out.replace(
    /\$\{([^{}]+?)\}/g,
    (_, tag) => `{${tag.trim()}}`
  );

  out = out.replace(
    /\{\{([^{}]+?)\}\}/g,
    (_, tag) => `{${tag.trim()}}`
  );

  out = out.replace(
    /\{([A-Za-z0-9_ .:/&;\-]+?)\}/g,
    (_, tag) => {
      const cleaned = tag.trim();

      if (!cleaned) return '';

      return `{${cleaned}}`;
    }
  );

  return out;
}

function normaliseZipTemplate(zip) {
  const xmlFilePattern =
    /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/;

  Object.keys(zip.files).forEach(fileName => {
    if (!xmlFilePattern.test(fileName)) return;

    const file = zip.file(fileName);
    if (!file) return;

    const xml = file.asText();
    const normalised = normaliseTemplateXml(xml);

    zip.file(fileName, normalised);
  });

  return zip;
}

function renderDocx(templateB64, mergeData) {
  if (!templateB64) {
    throw new Error('No template_b64 provided.');
  }

  const buffer = Buffer.from(templateB64, 'base64');

  try {
    const zip = normaliseZipTemplate(new PizZip(buffer));

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '',
    });

    doc.render(normaliseMergeData(mergeData));

    return doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
  } catch (err) {
    console.error('[generate-doc] render failed:', simplifyDocxError(err));

    throw new Error(simplifyDocxError(err));
  }
}

async function saveDocumentRecord({
  projectId,
  fileName,
  docxB64,
  mergeData,
}) {
  const sb = getSupabase();

  if (!sb || !projectId) return null;

  const safeName = safeFileName(
    fileName || mergeData?.file_name || 'document.docx'
  );

  const storagePath =
    `projects/${projectId}/documents/${Date.now()}-${safeName}`;

  const { error: uploadError } = await sb.storage
    .from('documents')
    .upload(
      storagePath,
      Buffer.from(docxB64, 'base64'),
      {
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      }
    );

  if (uploadError) {
    console.warn('[generate-doc] storage upload failed:', uploadError.message);
    return null;
  }

  const insertPayload = {
    project_id: projectId,
    name: safeName,
    file_name: safeName,
    file_type: 'docx',
    mime_type:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    storage_path: storagePath,
    category: mergeData?.category || 'document',
    section_type:
      mergeData?.section_type ||
      mergeData?.source_template ||
      null,
    created_at: new Date().toISOString(),
  };

  const { data, error: insertError } = await sb
    .from('documents')
    .insert(insertPayload)
    .select('id,storage_path')
    .single();

  if (insertError) {
    console.warn('[generate-doc] document insert failed:', insertError.message);

    return {
      storage_path: storagePath,
    };
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  try {
    const {
      template_b64,
      merge_data = {},
      file_name,
      output_format = 'docx',
      project_id,
      projectId,
      skip_storage = false,
    } = req.body || {};

    if (!template_b64) {
      return res.status(400).json({
        success: false,
        error: 'No template_b64 provided.',
      });
    }

    const mergeData = normaliseMergeData(merge_data);

    const resolvedProjectId =
      project_id ||
      projectId ||
      mergeData.project_id ||
      null;

    const resolvedFileName = safeFileName(
      file_name ||
      mergeData.file_name ||
      'document.docx'
    );

    const docxBuffer = renderDocx(template_b64, mergeData);
    const docxB64 = docxBuffer.toString('base64');

    let saved = null;

    if (!skip_storage && resolvedProjectId) {
      saved = await saveDocumentRecord({
        projectId: resolvedProjectId,
        fileName: resolvedFileName,
        docxB64,
        mergeData,
      });
    }

    return res.status(200).json({
      success: true,
      docx_b64: docxB64,
      pdf_b64: null,
      storage_path: saved?.storage_path || null,
      doc_id: saved?.id || null,
      output_format,
    });
  } catch (err) {
    console.error('[generate-doc] failed:', err);

    return res.status(500).json({
      success: false,
      error: err?.message || 'Document generation failed.',
    });
  }
}
