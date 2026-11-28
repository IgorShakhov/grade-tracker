import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

process.env.TZ = 'UTC';

export function resolveCustomUmamiCspOrigin(rawScriptUrl) {
  if (typeof rawScriptUrl !== 'string' || rawScriptUrl.trim() === '') {
    return '';
  }
  try {
    const parsed = new URL(rawScriptUrl.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return '';
    }
    if (parsed.origin === 'https://cloud.umami.is') {
      return '';
    }
    return parsed.origin;
  } catch {
    return '';
  }
}

function createUmamiCspPlugin(customOrigin) {
  return {
    name: 'umami-custom-csp-origin',
    transformIndexHtml(html) {
      if (!customOrigin) return html;
      return html
        .replace(
          'https://cloud.umami.is;',
          `https://cloud.umami.is ${customOrigin};`,
        )
        .replace(
          'https://*.umami.dev;',
          `https://*.umami.dev ${customOrigin};`,
        );
    },
  };
}

const devHmrCspPlugin = {
  name: 'dev-hmr-csp',
  apply: 'serve',
  transformIndexHtml(html) {
    return html
      .replace(
        "script-src 'self'",
        "script-src 'self' 'unsafe-inline'",
      )
      .replace(
        "connect-src 'self'",
        "connect-src 'self' ws: wss:",
      );
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const rawScriptUrl =
    process.env.VITE_UMAMI_SCRIPT_URL || env.VITE_UMAMI_SCRIPT_URL || '';
  const customUmamiOrigin = resolveCustomUmamiCspOrigin(rawScriptUrl);

  return {
    base: './',
    plugins: [
      react(),
      createUmamiCspPlugin(customUmamiOrigin),
      devHmrCspPlugin,
    ],
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
  };
});
