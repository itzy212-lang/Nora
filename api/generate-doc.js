import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

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

    return res.status(200).json({
      success: true,
      docx_b64:
        rendered.buffer.toString('base64'),
      pdf_b64: null,
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
