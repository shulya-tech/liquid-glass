import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shulya/liquid-glass/react': path.resolve(__dirname, '../dist/react.mjs'),
      '@shulya/liquid-glass': path.resolve(__dirname, '../dist/index.mjs'),
      'liquid-glass-ui/react': path.resolve(__dirname, '../dist/react.mjs'),
      'liquid-glass-ui': path.resolve(__dirname, '../dist/index.mjs')
    }
  },
  server: {
    port: 5173,
    open: false
  }
});
