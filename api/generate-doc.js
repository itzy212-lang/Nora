import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { createClient } from '@supabase/supabase-js';

function getServerClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function serialiseError(error) {
  if (!error) return null;

  return {
    message: error.message || null,
    name: error.name || null,
    stack: error.stack || null,
    properties: error.properties || null,
    errors: error.properties?.errors || null,
  };
}

function serialiseDocxtemplaterErrors(error) {
  const main = serialiseError(error);

  const nested = Array.isArray(error?.properties?.errors)
    ? error.properties.errors.map(item => serialiseError(item))
    : [];

  return {
    ...main,
    nested_errors: nested,
  };
}

function normaliseMergeData(mergeData = {}) {
  const tdata = {};

  Object.keys(mergeData || {}).forEach(key => {
    const cleanKey = String(key)
      .replace(/^\{\{/, '')
      .replace(/\}\}$/, '')
      .trim();

    const value = mergeData[key];

    tdata[cleanKey] =
      value === undefined || value === null ? '' : value;
  });

  return tdata;
}

function renderDocx(templateB64, mergeData = {}) {
  const zip = new PizZip(
    Buffer.from(templateB64, 'base64')
  );

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    nullGetter: () => '',
  });

  const tdata = normaliseMergeData(mergeData);

  doc.render(tdata);

  const buffer = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  return {
    buffer,
    tdata,
  };
}

async function convertDocxToPdf(docxBuffer, fileName = 'document.docx') {
  const apiKey = process.env.API2PDF_API_KEY;

  if (!apiKey) {
    console.error('[generate-doc] API2PDF_API_KEY is not set.');
    return null;
  }

  const supabase = getServerClient();

  if (!supabase) {
    console.error('[generate-doc] Supabase admin client is not available.');
    return null;
  }

  const safeFileName = String(fileName || 'document.docx')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_');

  const tempPath = `temp/pdf-conversion/${Date.now()}-${safeFileName.toLowerCase().endsWith('.docx') ? safeFileName : `${safeFileName}.docx`}`;

  const pdfFileName = safeFileName.replace(/\.docx$/i, '.pdf');

  try {
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(tempPath, docxBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      });

    if (uploadError) {
      console.error('[generate-doc] Temporary DOCX upload failed:', uploadError.message);
      return null;
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from('documents')
      .createSignedUrl(tempPath, 300);

    if (signedError || !signedData?.signedUrl) {
      console.error('[generate-doc] Temporary signed URL failed:', signedError?.message || 'No signed URL returned');
      return null;
    }

    const pdfResponse = await fetch('https://v2.api2pdf.com/libreoffice/any-to-pdf', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: signedData.signedUrl,
        fileName: pdfFileName,
      }),
    });

    const pdfJson = await pdfResponse.json().catch(() => ({}));

    if (!pdfResponse.ok || !pdfJson?.FileUrl) {
      console.error('[generate-doc] API2PDF conversion failed:', pdfResponse.status, JSON.stringify(pdfJson));
      return null;
    }

    const converted = await fetch(pdfJson.FileUrl);

    if (!converted.ok) {
      console.error('[generate-doc] API2PDF PDF download failed:', converted.status);
      return null;
    }

    const arrayBuffer = await converted.arrayBuffer();

    return Buffer.from(arrayBuffer).toString('base64');
  } catch (error) {
    console.error('[generate-doc] PDF conversion error:', error?.message || error);
    return null;
  } finally {
    try {
      await supabase.storage.from('documents').remove([tempPath]);
    } catch {
      // ignore cleanup errors
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'POST, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  try {
    const {
      template_b64,
      merge_data = {},
    } = req.body || {};

    if (!template_b64) {
      return res.status(400).json({
        success: false,
        error: 'No template_b64 provided',
      });
    }

    let rendered;

    try {
      rendered = renderDocx(
        template_b64,
        merge_data
      );
    } catch (renderError) {
      const details =
        serialiseDocxtemplaterErrors(renderError);

      console.error(
        '[generate-doc] TEMPLATE RENDER ERROR:',
        JSON.stringify(details, null, 2)
      );

      return res.status(500).json({
        success: false,
        error:
          renderError?.message ||
          'Template render failed',
        details,
      });
    }

    const fileName =
      merge_data?.file_name ||
      merge_data?.FILE_NAME ||
      rendered?.tdata?.file_name ||
      rendered?.tdata?.FILE_NAME ||
      'document.docx';

    const pdfB64 = await convertDocxToPdf(rendered.buffer, fileName);

    return res.status(200).json({
      success: true,
      docx_b64:
        rendered.buffer.toString('base64'),
      pdf_b64: pdfB64,
      storage_path: null,
      doc_id: null,
    });
  } catch (err) {
    const details = serialiseError(err);

    console.error(
      '[generate-doc] FATAL ERROR:',
      JSON.stringify(details, null, 2)
    );

    return res.status(500).json({
      success: false,
      error:
        err?.message ||
        'Document generation failed',
      details,
    });
  }
}
