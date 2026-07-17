// src/hooks/useDocumentGenerator.js
import sb from '../supabaseClient';

async function loadTemplate(templateKey) {
  if (!templateKey) {
    throw new Error('No template key supplied');
  }

  const { data, error } = await sb
    .from('document_templates')
    .select('template_key,label,filename,file_b64,is_active')
    .eq('template_key', templateKey)
    .eq('is_active', true)
    .limit(1);

  if (error) {
    throw new Error(`Unable to load template "${templateKey}": ${error.message}`);
  }

  const template = data?.[0];

  if (!template) {
    throw new Error(`No active template found for "${templateKey}"`);
  }

  if (!template.file_b64) {
    throw new Error(`Template "${templateKey}" exists but has no file content`);
  }

  return template;
}

async function readJson(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || `Server returned ${response.status}` };
  }
}

export default function useDocumentGenerator() {
  const generateDocument = async ({
    templateKey,
    mergeData,
    fileName = 'document.docx',
    projectId = null,
    skipDownload = false,
    outputAs = 'docx', // 'docx' | 'pdf' — which format to actually download
  }) => {
    try {
      console.log('[generateDocument] start', { templateKey, fileName, projectId, outputAs });

      const template = await loadTemplate(templateKey);

      const enrichedMergeData = { ...(mergeData || {}) };
      if (projectId) enrichedMergeData.project_id = projectId;
      enrichedMergeData.user_id = 'help@sq1consulting.co.uk';

      const response = await fetch('/api/generate-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_b64: template.file_b64,
          merge_data: enrichedMergeData,
          output_format: 'docx',
        }),
      });

      const result = await readJson(response);

      if (!response.ok || !result?.success) {
        console.error('[generateDocument] /api/generate-doc failed', {
          templateKey,
          status: response.status,
          result,
        });

        throw new Error(result?.error || `Document generation failed (${response.status})`);
      }

      if (!skipDownload) {
        if (outputAs === 'pdf') {
          if (!result.pdf_b64) {
            throw new Error('PDF conversion failed — no PDF was returned. Check API2PDF_API_KEY is set in Vercel.');
          }
          downloadB64(result.pdf_b64, fileName, 'application/pdf');
        } else if (result.docx_b64) {
          downloadB64(
            result.docx_b64,
            fileName,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          );
        }
      }

      return {
        success: true,
        docx_b64: result.docx_b64 || null,
        pdf_b64: result.pdf_b64 || null,
        storage_path: result.storage_path || null,
        doc_id: result.doc_id || null,
      };
    } catch (error) {
      console.error('[generateDocument] error:', error);
      return { success: false, error: error.message };
    }
  };

  const sendForSignature = async ({
    templateKey,
    mergeData,
    fileName = 'Letter of Appointment.pdf',
    projectId,
    appointmentType,
    signers,
  }) => {
    try {
      const template = await loadTemplate(templateKey);

      const enrichedMergeData = { ...(mergeData || {}) };
      if (projectId) enrichedMergeData.project_id = projectId;
      enrichedMergeData.user_id = 'help@sq1consulting.co.uk';

      const genResponse = await fetch('/api/generate-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_b64: template.file_b64,
          merge_data: enrichedMergeData,
          output_format: 'docx',
        }),
      });

      const genResult = await readJson(genResponse);

      if (!genResponse.ok || !genResult?.success) {
        throw new Error(genResult?.error || `Document generation failed (${genResponse.status})`);
      }

      if (!genResult.pdf_b64) {
        throw new Error('PDF conversion failed. Check API2PDF_API_KEY is set in Vercel.');
      }

      const sigResponse = await fetch('/api/send-loa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          appointment_type: appointmentType,
          template_key: templateKey,
          document_name: fileName.replace(/\.docx$/i, '.pdf'),
          pdf_b64: genResult.pdf_b64,
          signers,
        }),
      });

      const sigResult = await readJson(sigResponse);

      if (!sigResponse.ok || !sigResult?.success) {
        throw new Error(sigResult?.error || 'Failed to send for signature');
      }

      return {
        success: true,
        signing_request_id: sigResult.signing_request_id,
        doc_id: genResult.doc_id || null,
      };
    } catch (error) {
      console.error('[sendForSignature] error:', error);
      return { success: false, error: error.message };
    }
  };

  return { generateDocument, sendForSignature };
}

function downloadB64(b64, fileName, mimeType) {
  const byteCharacters = atob(b64);
  const byteNumbers = new Array(byteCharacters.length);

  for (let i = 0; i < byteCharacters.length; i += 1) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }

  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
