import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  root: 'apps/desktop',
  base: './',
  plugins: [
    react(),
    {
      name: 'development-csp',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          // React's development preamble is inline; the built app keeps strict CSP.
          return command === 'serve'
            ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
            : html;
        },
      },
    },
  ],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
}));
