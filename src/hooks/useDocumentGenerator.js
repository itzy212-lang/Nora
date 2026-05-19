import sb from '../supabaseClient';

export default function useDocumentGenerator() {

  const generateDocument = async ({
    templateKey,
    mergeData,
    fileName = 'document.docx'
  }) => {

    try {

      // =========================================
      // FETCH TEMPLATE FROM SUPABASE
      // =========================================

      const { data: template, error: templateError } = await sb
        .from('document_templates')
        .select('file_b64')
        .eq('template_key', templateKey)
        .single();

      if (templateError || !template?.file_b64) {
        console.error('Template fetch failed:', templateError);
        throw new Error('Unable to load document template');
      }

      // =========================================
      // GENERATE DOCUMENT
      // =========================================

      const response = await fetch('/api/generate-doc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          template_b64: template.file_b64,
          merge_data: mergeData,
          output_format: 'docx'
        })
      });

      const result = await response.json();

      if (!response.ok || !result?.success) {
        console.error('Generation failed:', result);
        throw new Error(result?.error || 'Document generation failed');
      }

      // =========================================
      // CONVERT BASE64 TO BLOB
      // =========================================

      const byteCharacters = atob(result.docx_b64);

      const byteNumbers = new Array(byteCharacters.length);

      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }

      const byteArray = new Uint8Array(byteNumbers);

      const blob = new Blob(
        [byteArray],
        {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }
      );

      // =========================================
      // DOWNLOAD FILE
      // =========================================

      const url = window.URL.createObjectURL(blob);

      const link = document.createElement('a');

      link.href = url;
      link.download = fileName;

      document.body.appendChild(link);

      link.click();

      document.body.removeChild(link);

      window.URL.revokeObjectURL(url);

      return {
        success: true
      };

    } catch (error) {

      console.error('generateDocument error:', error);

      return {
        success: false,
        error: error.message
      };
    }
  };

  return {
    generateDocument
  };
}
