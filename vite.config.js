import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

function fixNoticeReviewModalTdz() {
  return {
    name: 'fix-notice-review-modal-tdz',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/components/projects/NoticeReviewModal.jsx')) return null;

      const fixed = code.replace(
        '}, [pages, rebuildMergedPdf]);',
        '}, [pages, pdfB64, pdfUrl]);'
      );

      if (fixed === code) {
        throw new Error('NoticeReviewModal TDZ fix target was not found.');
      }

      return { code: fixed, map: null };
    },
  };
}

// build: force rebuild 2026-05-29
export default defineConfig({
  plugins: [fixNoticeReviewModalTdz(), react()],
  build: {
    outDir: 'dist',
    sourcemap: 'inline',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        portal: resolve(__dirname, 'portal.html'),
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api/ely-ai': {
        target: 'https://uttrmbmbmjszzfiftvco.supabase.co/functions/v1/ai_router',
        changeOrigin: true,
        rewrite: () => '',
      },
    },
  },
});