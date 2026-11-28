/**
 * Lightweight Cloudflare Worker relay for cookie-free Umami Cloud analytics.
 *
 * Serves the tracker script at `/app.js` (rewriting `/api/send` -> `/e` and
 * `x-umami-*` -> `x-gt-*`) and forwards sanitized beacons from `/e` to
 * `https://gateway.umami.is/api/send` so browser tracker-blockers do not block
 * `*.umami.is` or `/api/send`, while preserving visitor country (via local
 * Cloudflare edge PoP) and cookieless daily unique-visitor separation (`salt`).
 *
 * Optional Cloudflare Worker Environment Variable:
 * - `ALLOWED_ORIGIN`: e.g. `https://<owner>.github.io` (restricts POST /e to your site)
 */

const UMAMI_SCRIPT_URL = 'https://cloud.umami.is/script.js';
const UMAMI_COLLECT_URL = 'https://gateway.umami.is/api/send';
const SCRIPT_PATH = '/app.js';
const EVENT_PATH = '/e';
const MAX_BODY_BYTES = 16384;

const CORS_ALLOW_HEADERS = [
  'Content-Type',
  'x-gt-website-id',
  'x-gt-hostname',
  'x-gt-cache',
  'x-umami-website-id',
  'x-umami-hostname',
  'x-umami-cache',
].join(', ');

function buildCorsHeaders(requestOrigin) {
  return {
    'Access-Control-Allow-Origin': requestOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function isOriginAllowed(requestOrigin, env) {
  const configured = (env?.ALLOWED_ORIGIN || '').trim();
  if (!configured) return true;
  const allowedList = configured
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return Boolean(requestOrigin && allowedList.includes(requestOrigin));
}

async function computeDailySalt(day, ip, userAgent) {
  const data = new TextEncoder().encode(`${day}|${ip}|${userAgent}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest).slice(0, 8);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS' && url.pathname === EVENT_PATH) {
      if (!isOriginAllowed(requestOrigin, env)) {
        return new Response('Forbidden', { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(requestOrigin),
      });
    }

    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      url.pathname === SCRIPT_PATH
    ) {
      const upstream = await fetch(UMAMI_SCRIPT_URL, {
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
      if (!upstream.ok) {
        return new Response('Upstream unavailable', { status: 502 });
      }
      const rawJs = await upstream.text();
      const rewrittenJs = rawJs
        .replaceAll('/api/send', EVENT_PATH)
        .replaceAll('x-umami-', 'x-gt-');

      return new Response(request.method === 'HEAD' ? null : rewrittenJs, {
        status: 200,
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (request.method === 'POST' && url.pathname === EVENT_PATH) {
      if (!isOriginAllowed(requestOrigin, env)) {
        return new Response('Forbidden', { status: 403 });
      }

      const rawBody = await request.text();
      if (!rawBody || rawBody.length > MAX_BODY_BYTES) {
        return new Response('Bad Request', { status: 400 });
      }

      let parsed;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return new Response('Bad Request', { status: 400 });
      }

      const ip = request.headers.get('cf-connecting-ip') || '';
      const ua = request.headers.get('user-agent') || '';
      if (
        ip &&
        parsed?.payload &&
        typeof parsed.payload === 'object' &&
        !parsed.payload.salt
      ) {
        const day = new Date().toISOString().slice(0, 10);
        parsed.payload.salt = await computeDailySalt(day, ip, ua);
      }

      const outHeaders = new Headers({
        'Content-Type': 'application/json',
      });
      if (ua) outHeaders.set('User-Agent', ua);
      const lang = request.headers.get('accept-language');
      if (lang) outHeaders.set('Accept-Language', lang);
      if (ip) {
        outHeaders.set('X-Forwarded-For', ip);
        outHeaders.set('X-Real-IP', ip);
      }

      const headerPairs = [
        ['x-gt-website-id', 'x-umami-website-id'],
        ['x-gt-hostname', 'x-umami-hostname'],
        ['x-gt-cache', 'x-umami-cache'],
      ];
      for (const [aliasKey, upstreamKey] of headerPairs) {
        const val =
          request.headers.get(aliasKey) || request.headers.get(upstreamKey);
        if (val) outHeaders.set(upstreamKey, val);
      }

      const upstreamResp = await fetch(UMAMI_COLLECT_URL, {
        method: 'POST',
        headers: outHeaders,
        body: JSON.stringify(parsed),
      });

      const respBody = await upstreamResp.text();
      return new Response(respBody, {
        status: upstreamResp.status,
        headers: {
          'Content-Type':
            upstreamResp.headers.get('Content-Type') || 'application/json',
          ...buildCorsHeaders(requestOrigin),
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
