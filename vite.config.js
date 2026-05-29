import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// build: force rebuild 2026-05-29
export default defineConfig({
  plugins: [react()],
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
