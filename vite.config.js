import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// build: force rebuild 2026-05-29
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
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
