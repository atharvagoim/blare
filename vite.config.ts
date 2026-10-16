import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.app'],
    // Local API (scripts/dev-server.ts) mirrors the Vercel routes.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: false },
});
