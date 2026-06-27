import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// build: force rebuild 2026-05-29
export default defineConfig({
  plugins: [react()],
  base: './',  // Required for Capacitor — assets use relative paths
  build: {
    outDir: 'dist',
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
