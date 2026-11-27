import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

process.env.TZ = 'UTC';

const devHmrCspPlugin = {
  name: 'dev-hmr-csp',
  apply: 'serve',
  transformIndexHtml(html) {
    return html
      .replace(
        "script-src 'self' https://apis.google.com;",
        "script-src 'self' 'unsafe-inline' https://apis.google.com;",
      )
      .replace(
        "connect-src 'self'",
        "connect-src 'self' ws: wss:",
      );
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), devHmrCspPlugin],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'firebase',
              test: /[\\/]node_modules[\\/]@?firebase[\\/]/,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    env: {
      TZ: 'UTC',
    },
    setupFiles: ['@testing-library/jest-dom/vitest'],
    include: ['tests/unit/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx', 'src/services/firebase.js'],
    },
  },
});
