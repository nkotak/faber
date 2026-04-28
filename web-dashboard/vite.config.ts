import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: 'app',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'app/src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7433',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist/app',
    emptyOutDir: true,
    sourcemap: true,
  },
});
