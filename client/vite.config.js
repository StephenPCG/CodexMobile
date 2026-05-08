import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = Number(process.env.CODEXMOBILE_API_PORT || process.env.PORT || 3321);
const clientPort = Number(process.env.CODEXMOBILE_CLIENT_PORT || process.env.VITE_PORT || 5173);
const clientHost = process.env.CODEXMOBILE_CLIENT_HOST || '0.0.0.0';
const apiTarget = `http://127.0.0.1:${apiPort}`;
const wsTarget = `ws://127.0.0.1:${apiPort}`;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    host: clientHost,
    port: clientPort,
    allowedHosts: true,
    proxy: {
      '/api': apiTarget,
      '/ws': {
        target: wsTarget,
        ws: true
      }
    }
  }
});
