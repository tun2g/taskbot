import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    TanStackRouterVite({ quoteStyle: 'single', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Use the shared package's TS source so Vite gets native ESM named exports
      // (its dist is CommonJS, which breaks ESM named-import resolution).
      '@tbot/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      // The admin API (apps/admin-api). Same-origin in production too (nginx / reverse proxy).
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
