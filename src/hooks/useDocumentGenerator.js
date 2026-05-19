// src/hooks/useDocumentGenerator.js
import sb from '../supabaseClient';

export default function useDocumentGenerator() {

  // ── Generate DOCX (and optionally PDF) ──────────────────────
  const generateDocument = async ({
    templateKey,
    mergeData,
    fileName = 'document.docx',
    projectId = null,
  }) => {
    try {
      // Fetch template from Supabase
      const { data: template, error: templateError } = await sb
        .from('document_templates')
        .select('file_b64')
        .eq('template_key', templateKey)
        .single();

      if (templateError || !template?.file_b64) {
        throw new Error('Unable to load document template');
      }

      // Inject project_id into merge data so server can save record
      const enrichedMergeData = { ...mergeData };
      if (projectId) enrichedMergeData.project_id = projectId;

      const response = await fetch('/api/generate-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_b64: template.file_b64,
          merge_data: enrichedMergeData,
          output_format: 'docx',
        })
      });

      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || 'Document generation failed');
      }

      // Trigger DOCX download
      if (result.docx_b64) {
        downloadB64(result.docx_b64, fileName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      }

      return {
        success: true,
        docx_b64: result.docx_b64 || null,
        pdf_b64: result.pdf_b64 || null,
        storage_path: result.storage_path || null,
        doc_id: result.doc_id || null,
      };

    } catch (error) {
      console.error('generateDocument error:', error);
      return { success: false, error: error.message };
    }
  };

  // ── Send for e-signature via Firma ───────────────────────────
  const sendForSignature = async ({
    templateKey,
    mergeData,
    fileName = 'Letter of Appointment.pdf',
    projectId,
    appointmentType, // 'bo_loa' | 'ao_loa' | 'ao_agreed_surveyor_loa'
    signers,         // [{ name, email }] or [{ name, email }, { name, email }]
  }) => {
    try {
      // Step 1 — generate DOCX + PDF
      const { data: template, error: templateError } = await sb
        .from('document_templates')
        .select('file_b64')
        .eq('template_key', templateKey)
        .single();

      if (templateError || !template?.file_b64) {
        throw new Error('Unable to load document template');
      }

      const enrichedMergeData = { ...mergeData };
      if (projectId) enrichedMergeData.project_id = projectId;

      const genResponse = await fetch('/api/generate-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_b64: template.file_b64,
          merge_data: enrichedMergeData,
          output_format: 'docx',
        })
      });

      const genResult = await genResponse.json();
      if (!genResponse.ok || !genResult?.success) {
        throw new Error(genResult?.error || 'Document generation failed');
      }

      if (!genResult.pdf_b64) {
        throw new Error('PDF conversion failed — cannot send for signature without a PDF. Check API2PDF_API_KEY is set in Vercel.');
      }

      // Step 2 — send to Firma
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
        })
      });

      const sigResult = await sigResponse.json();
      if (!sigResponse.ok || !sigResult?.success) {
        throw new Error(sigResult?.error || 'Failed to send for signature');
      }

      return {
        success: true,
        signing_request_id: sigResult.signing_request_id,
        doc_id: genResult.doc_id || null,
      };

    } catch (error) {
      console.error('sendForSignature error:', error);
      return { success: false, error: error.message };
    }
  };

  return { generateDocument, sendForSignature };
}

// ── Helper ────────────────────────────────────────────────────
function downloadB64(b64, fileName, mimeType) {
  const byteCharacters = atob(b64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
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
