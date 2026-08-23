import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server proxies the API straight to a locally running backend
// (`npm run dev` at the repo root) so `npm run dev` here gives hot reload
// without duplicating any server logic.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8420',
      '/login': 'http://localhost:8420',
      '/setup': 'http://localhost:8420',
      '/webhooks': 'http://localhost:8420',
    },
  },
});
