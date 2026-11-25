import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['@testing-library/jest-dom/vitest'],
    include: ['tests/unit/**/*.test.{js,jsx}'],
  },
});
