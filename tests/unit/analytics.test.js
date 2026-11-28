import { describe, it, expect, beforeEach } from 'vitest';
import {
  UMAMI_OPT_OUT_KEY,
  DEFAULT_UMAMI_SCRIPT_URL,
  bucketTermCount,
  bucketCourseCount,
  resolveAnalyticsConfig,
  sanitizeUrlPathnameOnly,
  sanitizeReferrerUrl,
  sanitizeEventProps,
  sanitizeUmamiPayload,
  applyAnalyticsToggleFromUrl,
  shouldEnableAnalytics,
  initAnalytics,
  trackEvent,
  trackSessionStartOnce,
  trackEngagedOnce,
  resetAnalyticsForTests,
} from '../../src/services/analytics.js';

const VALID_WEBSITE_ID = '11111111-2222-4333-8444-555555555555';

describe('Privacy-First Umami Analytics Service (#104)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/grade-tracker/');
    delete window.umami;
    resetAnalyticsForTests(window);
  });

  it('buckets term and course counts into coarse anonymized ranges', () => {
    expect(bucketTermCount(NaN)).toBe('1');
    expect(bucketTermCount(0)).toBe('1');
    expect(bucketTermCount(1)).toBe('1');
    expect(bucketTermCount(2)).toBe('2-3');
    expect(bucketTermCount(3)).toBe('2-3');
    expect(bucketTermCount(4)).toBe('4+');

    expect(bucketCourseCount(-1)).toBe('0');
    expect(bucketCourseCount(0)).toBe('0');
    expect(bucketCourseCount(1)).toBe('1-3');
    expect(bucketCourseCount(3)).toBe('1-3');
    expect(bucketCourseCount(4)).toBe('4-6');
    expect(bucketCourseCount(6)).toBe('4-6');
    expect(bucketCourseCount(7)).toBe('7+');
  });

  it('validates VITE_UMAMI_WEBSITE_ID UUID format, omits hostUrl on default Umami Cloud CDN, and sets hostUrl on custom HTTPS origins', () => {
    expect(resolveAnalyticsConfig({}).enabled).toBe(false);
    expect(
      resolveAnalyticsConfig({ VITE_UMAMI_WEBSITE_ID: 'not-a-uuid' }).enabled,
    ).toBe(false);
    expect(
      resolveAnalyticsConfig({
        VITE_UMAMI_WEBSITE_ID: VALID_WEBSITE_ID,
        VITE_UMAMI_SCRIPT_URL: 'http://cloud.umami.is/script.js',
      }).enabled,
    ).toBe(false);
    expect(
      resolveAnalyticsConfig({
        VITE_UMAMI_WEBSITE_ID: VALID_WEBSITE_ID,
        VITE_UMAMI_SCRIPT_URL: 'https://user:secret@cloud.umami.is/script.js',
      }).enabled,
    ).toBe(false);

    // Default Umami Cloud script omits hostUrl so script.js routes to gateway.umami.is
    const valid = resolveAnalyticsConfig({
      VITE_UMAMI_WEBSITE_ID: ` ${VALID_WEBSITE_ID} `,
    });
    expect(valid).toEqual({
      enabled: true,
      websiteId: VALID_WEBSITE_ID,
      scriptUrl: DEFAULT_UMAMI_SCRIPT_URL,
      hostUrl: '',
    });

    // Custom self-hosted script URL sets hostUrl explicitly
    const custom = resolveAnalyticsConfig({
      VITE_UMAMI_WEBSITE_ID: VALID_WEBSITE_ID,
      VITE_UMAMI_SCRIPT_URL: 'https://stats.example.org/umami.js?cache=1#frag',
    });
    expect(custom).toEqual({
      enabled: true,
      websiteId: VALID_WEBSITE_ID,
      scriptUrl: 'https://stats.example.org/umami.js',
      hostUrl: 'https://stats.example.org',
    });
  });

  it('strips #view=, #share=, ?view=, and ?share= tokens from URLs and referrers and blocks PII or unknown events', () => {
    expect(
      sanitizeUrlPathnameOnly(
        'https://example.github.io/grade-tracker/?view=secretLiveToken#share=z1.secretPayload',
      ),
    ).toBe('/grade-tracker/');
    expect(sanitizeUrlPathnameOnly('/grade-tracker/#view=abc123')).toBe(
      '/grade-tracker/',
    );
    expect(sanitizeUrlPathnameOnly('')).toBe('/');

    expect(
      sanitizeReferrerUrl(
        'https://search.example.com/results?q=private+query#frag',
      ),
    ).toBe('https://search.example.com/results');
    expect(sanitizeReferrerUrl('/grade-tracker/#view=secret')).toBe('');
    expect(sanitizeReferrerUrl('javascript:alert(1)')).toBe('');

    // Pageview payload strips query/hash, clamps title, and removes stray data
    const pageview = sanitizeUmamiPayload('event', {
      website: VALID_WEBSITE_ID,
      url: 'https://example.github.io/grade-tracker/?share=u1.secret#view=secret2',
      referrer: 'https://forum.example.org/post?token=xyz#top',
      title: 'Private Student Name — ECON101',
      data: { studentName: 'Leak' },
    });
    expect(pageview).toEqual({
      website: VALID_WEBSITE_ID,
      url: '/grade-tracker/',
      referrer: 'https://forum.example.org/post',
      title: 'Grade Tracker',
    });

    // Non-event beacon types (identify, performance, error) are unconditionally blocked
    expect(
      sanitizeUmamiPayload('identify', {
        website: VALID_WEBSITE_ID,
        data: { uid: 'u-123' },
      }),
    ).toBe(false);
    expect(sanitizeUmamiPayload('performance', { url: '/' })).toBe(false);

    // Unknown or Object.prototype event names are blocked
    expect(
      sanitizeUmamiPayload('event', {
        url: '/grade-tracker/',
        name: 'custom_unapproved_event',
      }),
    ).toBe(false);
    expect(sanitizeEventProps('toString', {})).toBeNull();
    expect(sanitizeEventProps('constructor', {})).toBeNull();

    // Known event strips every non-allowlisted key and invalid enum value
    const sanitizedEvent = sanitizeUmamiPayload('event', {
      url: '/grade-tracker/#view=secretToken123',
      name: 'session_start',
      data: {
        auth_mode: 'signed_in',
        entry_view: 'live_share',
        tracker_state: 'customized',
        term_bucket: '2-3',
        course_bucket: '999-invalid',
        studentName: 'Should Never Appear',
        code: 'CS101',
        grade: 98.5,
        uid: 'firebase-uid-secret',
        email: 'user@example.com',
      },
    });
    expect(sanitizedEvent).toEqual({
      url: '/grade-tracker/',
      name: 'session_start',
      data: {
        auth_mode: 'signed_in',
        entry_view: 'live_share',
        tracker_state: 'customized',
        term_bucket: '2-3',
      },
    });
  });

  it('respects localhost, test mode, DNT/GPC, ?analytics=off|on, and in-memory opt-out when localStorage throws SecurityError', () => {
    const prodEnv = {
      MODE: 'production',
      VITE_UMAMI_WEBSITE_ID: VALID_WEBSITE_ID,
    };
    const fakeProdWin = {
      document: window.document,
      location: { protocol: 'https:', hostname: 'example.github.io' },
      navigator: { doNotTrack: '0' },
      localStorage: window.localStorage,
    };

    // Disabled by default on localhost and in Vitest test mode
    expect(
      shouldEnableAnalytics({
        envObj: prodEnv,
        win: {
          ...fakeProdWin,
          location: { protocol: 'http:', hostname: 'localhost' },
        },
      }),
    ).toBe(false);
    expect(
      shouldEnableAnalytics({
        envObj: { MODE: 'test', VITE_UMAMI_WEBSITE_ID: VALID_WEBSITE_ID },
        win: fakeProdWin,
      }),
    ).toBe(false);

    // Disabled when Do Not Track ('1' / 'yes' / msDoNotTrack) or Global Privacy Control is set
    expect(
      shouldEnableAnalytics({
        envObj: prodEnv,
        win: { ...fakeProdWin, navigator: { doNotTrack: '1' } },
      }),
    ).toBe(false);
    expect(
      shouldEnableAnalytics({
        envObj: prodEnv,
        win: { ...fakeProdWin, navigator: { doNotTrack: 'yes' } },
      }),
    ).toBe(false);
    expect(
      shouldEnableAnalytics({
        envObj: prodEnv,
        win: { ...fakeProdWin, navigator: { msDoNotTrack: '1' } },
      }),
    ).toBe(false);
    expect(
      shouldEnableAnalytics({
        envObj: prodEnv,
        win: { ...fakeProdWin, navigator: { globalPrivacyControl: true } },
      }),
    ).toBe(false);

    // Enabled on production HTTPS host when configured and not opted out
    expect(shouldEnableAnalytics({ envObj: prodEnv, win: fakeProdWin })).toBe(
      true,
    );

    // ?analytics=off sets localStorage opt-out and strips only `analytics` from URL
    window.history.replaceState(
      {},
      '',
      '/grade-tracker/?analytics=off&keep=1#view=tok1',
    );
    expect(applyAnalyticsToggleFromUrl(window)).toBe('disabled');
    expect(window.localStorage.getItem(UMAMI_OPT_OUT_KEY)).toBe('1');
    expect(window.location.pathname).toBe('/grade-tracker/');
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.hash).toBe('#view=tok1');
    expect(shouldEnableAnalytics({ envObj: prodEnv, win: fakeProdWin })).toBe(
      false,
    );

    // ?analytics=on clears opt-out and strips `analytics` from URL
    window.history.replaceState({}, '', '/grade-tracker/?analytics=on');
    expect(applyAnalyticsToggleFromUrl(window)).toBe('enabled');
    expect(window.localStorage.getItem(UMAMI_OPT_OUT_KEY)).toBeNull();
    expect(window.location.search).toBe('');
    expect(shouldEnableAnalytics({ envObj: prodEnv, win: fakeProdWin })).toBe(
      true,
    );

    // When localStorage throws SecurityError, ?analytics=off still activates session memoryOptOut
    const blockedStorageWin = {
      document: window.document,
      location: {
        href: 'https://example.github.io/grade-tracker/?analytics=off',
        protocol: 'https:',
        hostname: 'example.github.io',
        search: '?analytics=off',
      },
      navigator: { doNotTrack: '0' },
      history: { state: null, replaceState: () => {} },
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('SecurityError');
        },
      },
    };
    expect(applyAnalyticsToggleFromUrl(blockedStorageWin)).toBe('disabled');
    expect(
      shouldEnableAnalytics({ envObj: prodEnv, win: blockedStorageWin }),
    ).toBe(false);
  });

  it('queues up to 20 early events, omits data-host-url on default Cloud CDN, deduplicates session counters, and handles adblocker error + empty surrogate load', () => {
    const envObj = {
      MODE: 'production',
      VITE_UMAMI_WEBSITE_ID: VALID_WEBSITE_ID,
    };

    expect(
      initAnalytics({
        envObj,
        win: window,
        allowLocalhost: true,
        allowTestMode: true,
      }),
    ).toBe(true);

    const script = document.querySelector('script[data-gt-m="true"]');
    expect(script).not.toBeNull();
    expect(script.getAttribute('src')).toBe(DEFAULT_UMAMI_SCRIPT_URL);
    expect(script.getAttribute('data-website-id')).toBe(VALID_WEBSITE_ID);
    expect(script.hasAttribute('data-host-url')).toBe(false);
    expect(window.umamiConfig.hostUrl).toBeUndefined();
    expect(script.getAttribute('data-exclude-search')).toBe('true');
    expect(script.getAttribute('data-exclude-hash')).toBe('true');
    expect(script.getAttribute('data-before-send')).toBe('__gtMetricsBeforeSend');
    expect(typeof window.__gtMetricsBeforeSend).toBe('function');

    // Emit events before script finishes loading -> queued in memory, deduplicated, capped at 20
    expect(
      trackSessionStartOnce(
        {
          auth_mode: 'guest',
          entry_view: 'own_tracker',
          tracker_state: 'sample',
          term_bucket: '1',
          course_bucket: '1-3',
          studentName: 'Blocked',
        },
        window,
      ),
    ).toBe(true);
    expect(trackSessionStartOnce({ auth_mode: 'signed_in' }, window)).toBe(
      false,
    );

    expect(trackEngagedOnce('guest', window)).toBe(true);
    expect(trackEngagedOnce('guest', window)).toBe(false);
    for (let i = 0; i < 18; i += 1) {
      expect(trackEvent('term_added', undefined, window)).toBe(true);
    }
    // 21st queued item beyond MAX_PENDING_EVENTS (20) is dropped safely
    expect(trackEvent('term_added', undefined, window)).toBe(false);

    // Simulate script load and verify all 20 queued events flush cleanly in order
    const trackedCalls = [];
    window.umami = {
      track: (...args) => {
        trackedCalls.push(args);
      },
    };
    script.dispatchEvent(new Event('load'));

    expect(trackedCalls).toHaveLength(20);
    expect(trackedCalls[0]).toEqual([
      'session_start',
      {
        auth_mode: 'guest',
        entry_view: 'own_tracker',
        tracker_state: 'sample',
        term_bucket: '1',
        course_bucket: '1-3',
      },
    ]);
    expect(trackedCalls[1]).toEqual([
      'tracker_engaged',
      { auth_mode: 'guest' },
    ]);
    expect(trackedCalls[2]).toEqual(['term_added']);

    // Custom self-hosted script URL sets data-host-url, and 200-OK empty adblocker surrogate load disables tracking cleanly
    resetAnalyticsForTests(window);
    delete window.umami;
    initAnalytics({
      envObj: {
        MODE: 'production',
        VITE_UMAMI_WEBSITE_ID: VALID_WEBSITE_ID,
        VITE_UMAMI_SCRIPT_URL: 'https://edge.example.org/app.js',
      },
      win: window,
      allowLocalhost: true,
      allowTestMode: true,
    });
    const customScript = document.querySelector('script[data-gt-m="true"]');
    expect(customScript.getAttribute('data-host-url')).toBe(
      'https://edge.example.org',
    );
    expect(trackEvent('term_added', undefined, window)).toBe(true);
    customScript.dispatchEvent(new Event('load')); // window.umami still undefined (empty surrogate)
    expect(trackEvent('term_added', undefined, window)).toBe(false);

    // Reset and verify script `error` (network/CSP block) also disables tracking silently
    resetAnalyticsForTests(window);
    initAnalytics({
      envObj,
      win: window,
      allowLocalhost: true,
      allowTestMode: true,
    });
    const blockedScript = document.querySelector('script[data-gt-m="true"]');
    blockedScript.dispatchEvent(new Event('error'));
    expect(trackEvent('term_added', undefined, window)).toBe(false);
  });

  it('resolves custom Vite CSP origin and relays /app.js + /e cleanly in umami-proxy-worker.mjs', async () => {
    const { resolveCustomUmamiCspOrigin } = await import('../../vite.config.js');
    const workerMod = await import('../../scripts/umami-proxy-worker.mjs');
    const worker = workerMod.default;

    expect(resolveCustomUmamiCspOrigin('')).toBe('');
    expect(resolveCustomUmamiCspOrigin('https://cloud.umami.is/script.js')).toBe(
      '',
    );
    expect(resolveCustomUmamiCspOrigin('http://edge.example.org/app.js')).toBe(
      '',
    );
    expect(
      resolveCustomUmamiCspOrigin('https://gt-edge.example.workers.dev/app.js'),
    ).toBe('https://gt-edge.example.workers.dev');

    const upstreamCalls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      upstreamCalls.push({ url, init });
      if (url === 'https://cloud.umami.is/script.js') {
        return new Response(
          'const ep="/api/send";const h={"x-umami-website-id":id,"x-umami-cache":c};',
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ cache: 'tok-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      // 1. GET /app.js rewrites /api/send -> /e and x-umami-* -> x-gt-*
      const scriptResp = await worker.fetch(
        new Request('https://gt-edge.example.workers.dev/app.js'),
        {},
      );
      const jsBody = await scriptResp.text();
      expect(scriptResp.status).toBe(200);
      expect(jsBody).toContain('"/e"');
      expect(jsBody).not.toContain('/api/send');
      expect(jsBody).toContain('"x-gt-website-id"');
      expect(jsBody).not.toContain('x-umami-');

      // 2. POST /e enforces ALLOWED_ORIGIN, adds cookieless daily salt, and maps x-gt-* back to x-umami-*
      const blockedResp = await worker.fetch(
        new Request('https://gt-edge.example.workers.dev/e', {
          method: 'POST',
          headers: { Origin: 'https://evil.example.com' },
          body: '{}',
        }),
        { ALLOWED_ORIGIN: 'https://allowed.example.io' },
      );
      expect(blockedResp.status).toBe(403);

      const okResp = await worker.fetch(
        new Request('https://gt-edge.example.workers.dev/e', {
          method: 'POST',
          headers: {
            Origin: 'https://allowed.example.io',
            'Content-Type': 'application/json',
            'cf-connecting-ip': '203.0.113.42',
            'user-agent': 'Mozilla/5.0 TestBrowser',
            'x-gt-website-id': VALID_WEBSITE_ID,
            'x-gt-hostname': 'allowed.example.io',
            'x-gt-cache': 'cached-jwt',
          },
          body: JSON.stringify({
            type: 'event',
            payload: { website: VALID_WEBSITE_ID, url: '/grade-tracker/' },
          }),
        }),
        { ALLOWED_ORIGIN: 'https://allowed.example.io' },
      );
      expect(okResp.status).toBe(200);
      expect(okResp.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://allowed.example.io',
      );

      const collectCall = upstreamCalls[1];
      expect(collectCall.url).toBe('https://gateway.umami.is/api/send');
      expect(collectCall.init.headers.get('x-umami-website-id')).toBe(
        VALID_WEBSITE_ID,
      );
      expect(collectCall.init.headers.get('x-umami-cache')).toBe('cached-jwt');
      expect(collectCall.init.headers.get('X-Forwarded-For')).toBe(
        '203.0.113.42',
      );
      const forwardedBody = JSON.parse(collectCall.init.body);
      expect(forwardedBody.payload.salt).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
