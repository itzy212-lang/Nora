import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Build-time integration keeps the large App.jsx stable while routing PM projects
// through the enhanced responsive shell.
const pmEnhancedShell = {
  name: 'pm-enhanced-shell',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/src/App.jsx') && !id.endsWith('\\src\\App.jsx')) return null;
    const from = "import PMProjectDetail from './components/projects/PMProjectDetail';";
    const to = "import PMProjectDetail from './components/projects/PMProjectDetailEnhanced';";
    if (!code.includes(from)) return null;
    return { code: code.replace(from, to), map: null };
  },
};

export default defineConfig({
  plugins: [pmEnhancedShell, react()],
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
