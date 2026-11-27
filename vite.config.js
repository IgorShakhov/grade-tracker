import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

process.env.TZ = 'UTC';

export default defineConfig({
  base: './',
  plugins: [react()],
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
    host: true,
    port: 5173,
    allowedHosts: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    env: {
      TZ: 'UTC',
    },
    setupFiles: ['@testing-library/jest-dom/vitest'],
    include: ['tests/unit/**/*.test.{js,jsx}'],
  },
});
