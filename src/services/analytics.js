const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DEFAULT_UMAMI_SCRIPT_URL = 'https://cloud.umami.is/script.js';
export const UMAMI_OPT_OUT_KEY = 'umami.disabled';
const BEFORE_SEND_GLOBAL = '__gtUmamiBeforeSend';
const MAX_PENDING_EVENTS = 20;

/**
 * Strict allowlist of anonymized custom events and their permitted enum values (#104).
 * Free-form text, course codes, grades, names, emails, UIDs, and tokens are impossible to emit.
 */
export const EVENT_SCHEMA = Object.freeze({
  session_start: Object.freeze({
    auth_mode: Object.freeze(['guest', 'signed_in']),
    entry_view: Object.freeze(['own_tracker', 'live_share', 'snapshot_share']),
    tracker_state: Object.freeze(['sample', 'customized']),
    term_bucket: Object.freeze(['1', '2-3', '4+']),
    course_bucket: Object.freeze(['0', '1-3', '4-6', '7+']),
  }),
  tracker_engaged: Object.freeze({
    auth_mode: Object.freeze(['guest', 'signed_in']),
  }),
  auth_sign_in: Object.freeze({
    kind: Object.freeze(['first_sync', 'returning']),
  }),
  auth_sign_out: Object.freeze({}),
  sync_conflict_shown: Object.freeze({
    reason: Object.freeze([
      'initial-merge',
      'rev-mismatch',
      'account-switch',
      'remote-deleted',
    ]),
  }),
  what_if_entered: Object.freeze({
    auth_mode: Object.freeze(['guest', 'signed_in']),
    entry_view: Object.freeze(['own_tracker', 'live_share', 'snapshot_share']),
  }),
  course_added: Object.freeze({
    source: Object.freeze(['standard', 'blank', 'duplicate']),
  }),
  term_added: Object.freeze({}),
  scale_customized: Object.freeze({}),
  share_created: Object.freeze({
    kind: Object.freeze(['live_enabled', 'live_rotated', 'snapshot_copied']),
  }),
  shared_copy_saved: Object.freeze({
    source: Object.freeze(['live_share', 'snapshot_share']),
  }),
});

export function bucketTermCount(count) {
  const n = typeof count === 'number' && Number.isFinite(count) ? count : 0;
  if (n <= 1) return '1';
  if (n <= 3) return '2-3';
  return '4+';
}

export function bucketCourseCount(count) {
  const n = typeof count === 'number' && Number.isFinite(count) ? count : 0;
  if (n <= 0) return '0';
  if (n <= 3) return '1-3';
  if (n <= 6) return '4-6';
  return '7+';
}

export function resolveAnalyticsConfig(envObj = import.meta.env) {
  const rawId =
    typeof envObj?.VITE_UMAMI_WEBSITE_ID === 'string'
      ? envObj.VITE_UMAMI_WEBSITE_ID.trim()
      : '';
  if (!rawId || !UUID_RE.test(rawId)) {
    return { enabled: false, websiteId: '', scriptUrl: '', hostUrl: '' };
  }

  const rawScript =
    typeof envObj?.VITE_UMAMI_SCRIPT_URL === 'string' &&
    envObj.VITE_UMAMI_SCRIPT_URL.trim() !== ''
      ? envObj.VITE_UMAMI_SCRIPT_URL.trim()
      : DEFAULT_UMAMI_SCRIPT_URL;

  try {
    const parsed = new URL(rawScript);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return { enabled: false, websiteId: '', scriptUrl: '', hostUrl: '' };
    }
    const normalizedScriptUrl = `${parsed.origin}${parsed.pathname}`;
    return {
      enabled: true,
      websiteId: rawId,
      scriptUrl: normalizedScriptUrl,
      hostUrl:
        normalizedScriptUrl === DEFAULT_UMAMI_SCRIPT_URL ? '' : parsed.origin,
    };
  } catch {
    return { enabled: false, websiteId: '', scriptUrl: '', hostUrl: '' };
  }
}

export function sanitizeUrlPathnameOnly(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return '/';
  }
  try {
    const parsed = new URL(rawUrl, 'https://analytics.invalid');
    return parsed.pathname || '/';
  } catch {
    const withoutHash = rawUrl.split('#')[0] || '/';
    const withoutQuery = withoutHash.split('?')[0] || '/';
    return withoutQuery.startsWith('/') ? withoutQuery : '/';
  }
}

export function sanitizeReferrerUrl(rawReferrer) {
  if (typeof rawReferrer !== 'string' || rawReferrer.trim() === '') {
    return '';
  }
  try {
    const parsed = new URL(rawReferrer);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '';
  }
}

export function sanitizeEventProps(eventName, rawProps) {
  if (!Object.hasOwn(EVENT_SCHEMA, eventName)) {
    return null;
  }
  const allowedDefs = EVENT_SCHEMA[eventName];
  const clean = {};
  if (!rawProps || typeof rawProps !== 'object') {
    return clean;
  }
  for (const [key, allowedValues] of Object.entries(allowedDefs)) {
    const candidate = rawProps[key];
    if (typeof candidate === 'string' && allowedValues.includes(candidate)) {
      clean[key] = candidate;
    }
  }
  return clean;
}

/**
 * Mandatory `beforeSend` sanitizer invoked by Umami before any beacon leaves the browser.
 * Strips `?search` and `#hash` (`#view=`, `#share=`, `?view=`, `?share=`) and enforces
 * the strict enum allowlist on event payloads (#104).
 */
export function sanitizeUmamiPayload(type, payload) {
  if (type && type !== 'event') {
    return false;
  }
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const next = { ...payload };
  next.url = sanitizeUrlPathnameOnly(
    typeof payload.url === 'string' && payload.url
      ? payload.url
      : typeof window !== 'undefined'
        ? window.location?.pathname || '/'
        : '/',
  );

  if ('referrer' in next) {
    next.referrer = sanitizeReferrerUrl(payload.referrer);
  }

  if ('title' in next) {
    next.title = 'Grade Tracker';
  }

  if (typeof next.name === 'string' && next.name !== '') {
    const cleanData = sanitizeEventProps(next.name, next.data);
    if (cleanData === null) {
      return false;
    }
    if (Object.keys(cleanData).length > 0) {
      next.data = cleanData;
    } else {
      delete next.data;
    }
  } else if ('data' in next) {
    delete next.data;
  }

  return next;
}

let initialized = false;
let activeEnabled = false;
let scriptFailed = false;
let memoryOptOut = false;
let sessionStartTracked = false;
let engagedTracked = false;
let pendingQueue = [];

/**
 * Supports `?analytics=off` / `?analytics=on` in the address bar so the site owner
 * can exclude or re-enable their own browser (`localStorage['umami.disabled'] = '1'`)
 * and immediately strips the query parameter via `history.replaceState`.
 */
export function applyAnalyticsToggleFromUrl(
  win = typeof window !== 'undefined' ? window : null,
) {
  if (!win?.location) return null;
  let searchParams;
  try {
    searchParams = new URLSearchParams(win.location.search || '');
  } catch {
    return null;
  }
  if (!searchParams.has('analytics')) return null;

  const raw = (searchParams.get('analytics') || '').trim().toLowerCase();
  let outcome = null;
  if (raw === 'off' || raw === '0' || raw === 'false') {
    memoryOptOut = true;
    outcome = 'disabled';
    try {
      win.localStorage?.setItem(UMAMI_OPT_OUT_KEY, '1');
    } catch {
      // In-memory opt-out remains active for the session when storage is blocked
    }
  } else if (raw === 'on' || raw === '1' || raw === 'true') {
    memoryOptOut = false;
    outcome = 'enabled';
    try {
      win.localStorage?.removeItem(UMAMI_OPT_OUT_KEY);
    } catch {
      // Ignore storage access errors in private-browsing modes
    }
  }

  try {
    if (typeof win.history?.replaceState === 'function') {
      const parsed = new URL(win.location.href);
      parsed.searchParams.delete('analytics');
      win.history.replaceState(
        win.history.state ?? null,
        '',
        `${parsed.pathname}${parsed.search}${parsed.hash}`,
      );
    }
  } catch {
    // Ignore URL normalization errors
  }

  return outcome;
}

function isLocalhostHost(hostname) {
  return (
    !hostname ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}

function isBrowserPrivacySignalSet(win) {
  const dnt = win?.navigator?.doNotTrack ?? win?.doNotTrack;
  if (dnt === '1' || dnt === 'yes') return true;
  if (win?.navigator?.msDoNotTrack === '1') return true;
  if (win?.navigator?.globalPrivacyControl === true) return true;
  return false;
}

export function shouldEnableAnalytics({
  envObj = import.meta.env,
  win = typeof window !== 'undefined' ? window : null,
  allowLocalhost = false,
  allowTestMode = false,
} = {}) {
  const config = resolveAnalyticsConfig(envObj);
  if (!config.enabled || !win?.document) return false;
  if (!allowTestMode && envObj?.MODE === 'test') return false;
  if (win.location?.protocol === 'file:') return false;
  if (!allowLocalhost && isLocalhostHost(win.location?.hostname || '')) {
    return false;
  }
  if (isBrowserPrivacySignalSet(win)) {
    return false;
  }
  if (memoryOptOut) {
    return false;
  }
  try {
    if (win.localStorage?.getItem(UMAMI_OPT_OUT_KEY) === '1') {
      return false;
    }
  } catch {
    // Ignore storage read errors
  }
  return true;
}

function flushPendingEvents(win) {
  if (!win || typeof win.umami?.track !== 'function') return;
  const queued = pendingQueue;
  pendingQueue = [];
  for (const item of queued) {
    try {
      if (Object.keys(item.data).length > 0) {
        win.umami.track(item.name, item.data);
      } else {
        win.umami.track(item.name);
      }
    } catch {
      // Never allow third-party analytics failures to impact app UX
    }
  }
}

export function initAnalytics(options = {}) {
  if (initialized) return activeEnabled;
  initialized = true;

  const envObj = options.envObj || import.meta.env;
  const win = options.win || (typeof window !== 'undefined' ? window : null);
  if (
    !shouldEnableAnalytics({
      envObj,
      win,
      allowLocalhost: Boolean(options.allowLocalhost),
      allowTestMode: Boolean(options.allowTestMode),
    })
  ) {
    activeEnabled = false;
    return false;
  }

  const config = resolveAnalyticsConfig(envObj);
  activeEnabled = true;
  scriptFailed = false;

  try {
    win[BEFORE_SEND_GLOBAL] = sanitizeUmamiPayload;
    const umamiCfg = {
      websiteId: config.websiteId,
      excludeSearch: true,
      excludeHash: true,
      doNotTrack: true,
      beforeSend: sanitizeUmamiPayload,
    };
    if (config.hostUrl) {
      umamiCfg.hostUrl = config.hostUrl;
    }
    win.umamiConfig = umamiCfg;

    if (typeof win.umami?.track === 'function') {
      flushPendingEvents(win);
      return true;
    }

    const existing = win.document.querySelector('script[data-gt-umami="true"]');
    if (!existing) {
      const script = win.document.createElement('script');
      script.async = true;
      script.defer = true;
      script.src = config.scriptUrl;
      script.setAttribute('data-gt-umami', 'true');
      script.setAttribute('data-website-id', config.websiteId);
      if (config.hostUrl) {
        script.setAttribute('data-host-url', config.hostUrl);
      }
      script.setAttribute('data-exclude-search', 'true');
      script.setAttribute('data-exclude-hash', 'true');
      script.setAttribute('data-do-not-track', 'true');
      script.setAttribute('data-before-send', BEFORE_SEND_GLOBAL);
      script.addEventListener('load', () => {
        if (typeof win.umami?.track === 'function') {
          flushPendingEvents(win);
        } else {
          scriptFailed = true;
          pendingQueue = [];
        }
      });
      script.addEventListener('error', () => {
        scriptFailed = true;
        pendingQueue = [];
      });
      win.document.head.appendChild(script);
    }
    return true;
  } catch {
    activeEnabled = false;
    pendingQueue = [];
    return false;
  }
}

export function trackEvent(
  eventName,
  rawProps = undefined,
  win = typeof window !== 'undefined' ? window : null,
) {
  if (!activeEnabled || scriptFailed) return false;
  const cleanData = sanitizeEventProps(eventName, rawProps);
  if (cleanData === null) return false;

  if (win && typeof win.umami?.track === 'function') {
    try {
      if (Object.keys(cleanData).length > 0) {
        win.umami.track(eventName, cleanData);
      } else {
        win.umami.track(eventName);
      }
      return true;
    } catch {
      return false;
    }
  }

  if (pendingQueue.length < MAX_PENDING_EVENTS) {
    pendingQueue.push({ name: eventName, data: cleanData });
    return true;
  }
  return false;
}

export function trackSessionStartOnce(props, win) {
  if (sessionStartTracked) return false;
  sessionStartTracked = true;
  return trackEvent('session_start', props, win);
}

export function trackEngagedOnce(authMode, win) {
  if (engagedTracked) return false;
  engagedTracked = true;
  return trackEvent(
    'tracker_engaged',
    { auth_mode: authMode === 'signed_in' ? 'signed_in' : 'guest' },
    win,
  );
}

export function resetAnalyticsForTests(
  win = typeof window !== 'undefined' ? window : null,
) {
  initialized = false;
  activeEnabled = false;
  scriptFailed = false;
  memoryOptOut = false;
  sessionStartTracked = false;
  engagedTracked = false;
  pendingQueue = [];
  if (win?.document) {
    win.document
      .querySelectorAll('script[data-gt-umami="true"]')
      .forEach((el) => el.remove());
  }
  if (win) {
    delete win[BEFORE_SEND_GLOBAL];
    delete win.umamiConfig;
  }
}
