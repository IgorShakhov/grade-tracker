import { STORAGE_KEY } from '../domain/constants.js';
import { createInitialState } from '../domain/templates.js';
import {
  storageService,
  validateTrackerState,
  createMemoryStorage,
  CURRENT_SCHEMA_VERSION,
  SchemaTooNewError,
  isSchemaTooNewError,
} from './storage.js';

let firebaseModPromise = null;
let loadedFirebaseMod = null;

/**
 * Dynamically imports `./firebase.js` on demand (#48) so local-only users and
 * unconfigured builds never preload or download the ~189 KB Firebase SDK chunk.
 * Caches the resolved module synchronously so `signInWithPopup` runs without an
 * extra microtask tick once preloaded on modal open.
 */
export function preloadFirebaseModule() {
  if (loadedFirebaseMod) {
    return Promise.resolve(loadedFirebaseMod);
  }
  if (!firebaseModPromise) {
    firebaseModPromise = import('./firebase.js')
      .then((mod) => {
        loadedFirebaseMod = mod;
        return mod;
      })
      .catch((err) => {
        firebaseModPromise = null;
        throw err;
      });
  }
  return firebaseModPromise;
}

export function isFirebaseModulePreloaded() {
  return Boolean(loadedFirebaseMod || firebaseModPromise);
}

export function resetFirebasePreloadForTests() {
  firebaseModPromise = null;
  loadedFirebaseMod = null;
}

function loadFirebaseServices() {
  if (loadedFirebaseMod) {
    return loadedFirebaseMod.getFirebaseServices();
  }
  return preloadFirebaseModule().then((mod) => mod.getFirebaseServices());
}

export const SYNC_META_KEY = 'grade_tracker_sync_meta_v1';
export const UNSYNCED_BACKUP_KEY = 'grade_tracker_v1_unsynced_backup';
export const LEGACY_GITHUB_SYNC_KEY = 'grade_tracker_cloud_sync_v1';
export const SHARE_TOKEN_REGEX = /^[A-Za-z0-9_-]{22,64}$/;
export const MAX_STATE_JSON_CHARS = 290_000;
const DEFAULT_DEBOUNCE_MS = 1800;

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generates a 192-bit (24-byte -> 32-char base64url) cryptographically random share token.
 */
export function generateShareToken() {
  const bytes = new Uint8Array(24);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    throw new Error('Secure random generator (crypto.getRandomValues) is unavailable.');
  }
  return bytesToBase64Url(bytes);
}

export function isValidShareToken(token) {
  return typeof token === 'string' && SHARE_TOKEN_REGEX.test(token.trim());
}

/**
 * Builds `<origin><pathname>#view=<shareToken>`, keeping the token strictly in the URL
 * fragment (`#`) so it is never transmitted in HTTP request paths, server logs, or Referer headers.
 */
export function buildLiveShareUrl(currentHref, shareToken) {
  const cleanToken = typeof shareToken === 'string' ? shareToken.trim() : '';
  if (!isValidShareToken(cleanToken)) {
    return '';
  }

  const rawFallback =
    typeof window !== 'undefined' && window.location?.href
      ? window.location.href
      : 'http://localhost/';

  let baseUrl;
  try {
    const parsedBase = new URL(rawFallback);
    baseUrl =
      parsedBase.protocol === 'http:' ||
      parsedBase.protocol === 'https:' ||
      parsedBase.protocol === 'file:'
        ? parsedBase
        : new URL('http://localhost/');
  } catch {
    baseUrl = new URL('http://localhost/');
  }

  let url;
  try {
    const candidate =
      typeof currentHref === 'string' && currentHref.trim() !== ''
        ? new URL(currentHref, baseUrl.href)
        : new URL(baseUrl.href);
    url =
      candidate.protocol === 'http:' ||
      candidate.protocol === 'https:' ||
      candidate.protocol === 'file:'
        ? candidate
        : new URL('http://localhost/');
  } catch {
    url = new URL('http://localhost/');
  }

  url.search = '';
  url.hash = `view=${cleanToken}`;
  return url.toString();
}

function readParamFromQueryLike(body, key) {
  if (!body || typeof body !== 'string') return null;
  const candidate =
    body.includes('?') && body.startsWith('/')
      ? body.slice(body.indexOf('?') + 1)
      : body;
  const params = new URLSearchParams(candidate);
  const val = params.get(key);
  if (typeof val === 'string' && isValidShareToken(val.trim())) {
    return val.trim();
  }
  return null;
}

/**
 * Extracts a validated live share token from `#view=<token>` (preferred) or `?view=<token>`.
 */
export function extractLiveViewTokenFromUrl(locationLike) {
  const target =
    arguments.length === 0
      ? typeof window !== 'undefined'
        ? window.location
        : null
      : locationLike;

  if (!target) return null;

  let hash;
  let search;

  if (typeof target === 'string') {
    try {
      const parsed = new URL(target, 'http://localhost/');
      hash = parsed.hash;
      search = parsed.search;
    } catch {
      return null;
    }
  } else if (typeof target === 'object') {
    hash = typeof target.hash === 'string' ? target.hash : '';
    search = typeof target.search === 'string' ? target.search : '';
  } else {
    return null;
  }

  if (hash) {
    const hashBody = hash.startsWith('#') ? hash.slice(1) : hash;
    const fromHash = readParamFromQueryLike(hashBody, 'view');
    if (fromHash) return fromHash;
  }

  if (search) {
    const searchBody = search.startsWith('?') ? search.slice(1) : search;
    const fromSearch = readParamFromQueryLike(searchBody, 'view');
    if (fromSearch) return fromSearch;
  }

  return null;
}

/**
 * Removes `#view` and `?view` from the browser URL bar via history.replaceState.
 */
export function clearLiveViewFromUrl(win) {
  const targetWin =
    arguments.length === 0 ? (typeof window !== 'undefined' ? window : null) : win;

  if (
    !targetWin?.location?.href ||
    typeof targetWin.history?.replaceState !== 'function'
  ) {
    return;
  }

  try {
    const url = new URL(targetWin.location.href);
    url.searchParams.delete('view');

    let nextHash = url.hash;
    if (nextHash) {
      const hashBody = nextHash.startsWith('#') ? nextHash.slice(1) : nextHash;
      const hashParams = new URLSearchParams(hashBody);
      if (hashParams.has('view')) {
        hashParams.delete('view');
        const remaining = hashParams.toString();
        nextHash = remaining ? `#${remaining}` : '';
      }
    }

    const searchStr = url.searchParams.toString();
    const nextRelativeUrl = `${url.pathname}${searchStr ? `?${searchStr}` : ''}${nextHash}`;
    targetWin.history.replaceState(targetWin.history.state ?? null, '', nextRelativeUrl);
  } catch {
    // Ignore malformed location URLs
  }
}

function resolveLocalMetaStorage(explicitStorage) {
  if (
    explicitStorage &&
    typeof explicitStorage.getItem === 'function' &&
    typeof explicitStorage.setItem === 'function'
  ) {
    return explicitStorage;
  }
  try {
    const candidate =
      typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
    if (
      candidate &&
      typeof candidate.getItem === 'function' &&
      typeof candidate.setItem === 'function'
    ) {
      return candidate;
    }
  } catch {
    // Restricted storage environment
  }
  return createMemoryStorage();
}

function createDefaultMeta() {
  return {
    lastSyncedUid: null,
    lastSyncedRev: 0,
    shareToken: null,
    lastSyncedAt: null,
    dirty: false,
  };
}

function isBrowserOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function formatFriendlyError(err) {
  const code = err?.code || '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return null;
  }
  if (code === 'firebase/not-configured') {
    return 'Cloud sync is not configured in this local build. Copy .env.example to .env.local with your VITE_FIREBASE_* values.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Sign-in popup was blocked by your browser. Please allow popups for this site and try again.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'This domain is not yet authorized in Firebase Authentication settings.';
  }
  if (code === 'unavailable' || code === 'auth/network-request-failed') {
    return 'Network unavailable. Changes remain saved locally and will sync when back online.';
  }
  if (code === 'resource-exhausted') {
    return 'Daily free cloud sync quota reached. Local changes remain safe in your browser.';
  }
  return err?.message || 'Cloud sync encountered an unexpected error.';
}

function sanitizeUserForMemory(firebaseUser) {
  if (!firebaseUser || typeof firebaseUser.uid !== 'string') {
    return null;
  }
  return {
    uid: firebaseUser.uid,
    email: typeof firebaseUser.email === 'string' ? firebaseUser.email : null,
    displayName:
      typeof firebaseUser.displayName === 'string' ? firebaseUser.displayName : null,
  };
}

/**
 * Produces a deterministic content fingerprint of a validated TrackerState,
 * ignoring volatile metadata (`lastUpdated`, generated IDs, `activeTermId`, `collapsed`)
 * so untouched sample states and identical trackers compare equal (#13).
 */
export function canonicalTrackerFingerprint(rawState) {
  const s = validateTrackerState(rawState);
  return JSON.stringify({
    studentName: s.studentName,
    gradeScale: s.gradeScale.map((b) => [b.min, b.max, b.letter, b.gpa]),
    terms: s.terms.map((t) => ({
      name: t.name,
      courses: t.courses.map((c) => ({
        code: c.code,
        title: c.title,
        units: c.units,
        duration: c.duration,
        passFail: c.passFail,
        targetPct: c.targetPct,
        categories: c.categories.map((cat) => [cat.name, cat.weight, cat.grade]),
      })),
    })),
  });
}

export function areTrackerStatesEquivalent(stateA, stateB) {
  try {
    return canonicalTrackerFingerprint(stateA) === canonicalTrackerFingerprint(stateB);
  } catch {
    return false;
  }
}

/**
 * Fetches and strictly validates a read-only shared view (`shares/{token}`).
 * Works without signing in when the caller knows the exact 192-bit token.
 */
export async function fetchSharedView(
  shareToken,
  firebaseFactory = loadFirebaseServices,
) {
  if (!isValidShareToken(shareToken)) {
    throw new Error('Invalid share link token.');
  }
  const fb = await firebaseFactory();
  const snap = await fb.getDoc(fb.doc('shares', shareToken.trim()));
  if (!snap.exists()) {
    return { exists: false, state: null };
  }
  const data = snap.data() || {};
  if (typeof data.stateJson !== 'string') {
    throw new Error('Shared tracker data is malformed.');
  }
  const parsed = JSON.parse(data.stateJson);
  try {
    const validated = validateTrackerState(parsed);
    return {
      exists: true,
      state: validated,
    };
  } catch (err) {
    if (isSchemaTooNewError(err)) {
      throw new Error(
        'This shared tracker uses a newer Grade Tracker format. Reload the page to view it.',
        { cause: err },
      );
    }
    throw err;
  }
}

/**
 * CloudSyncManager coordinates Google Sign-In (`signInWithPopup`), debounced atomic
 * `writeBatch` saves to Firestore (`users/{uid}` + optional `shares/{token}`),
 * monotonic `rev` optimistic concurrency control, and multi-account `lastSyncedUid` isolation.
 *
 * Zero PII (no email, displayName, or photoURL) is ever written to Firestore or localStorage.
 */
export class CloudSyncManager {
  constructor(options = {}) {
    this.hasCustomFirebaseFactory = typeof options.firebaseFactory === 'function';
    this.firebaseFactory = options.firebaseFactory || loadFirebaseServices;
    this.storage = resolveLocalMetaStorage(options.storage);
    this.storageSvc = options.storageSvc || storageService;
    this.debounceMs =
      typeof options.debounceMs === 'number' ? options.debounceMs : DEFAULT_DEBOUNCE_MS;

    this.meta = this.loadMeta();
    this.status = 'disconnected';
    this.currentUser = null;
    this.error = null;
    this.conflict = null;
    this.schemaTooNew = false;
    this.explicitSignOutInProgress = false;
    this.listeners = new Set();

    this.debounceTimer = null;
    this.latestLocalState = null;
    this.lastSyncedStateSnapshot = null;
    this.inFlightPromise = null;
    this.queuedFlushAfterFlight = false;
    this.usesBrowserLocalStorage =
      !options.storage ||
      (typeof globalThis !== 'undefined' &&
        options.storage === globalThis.localStorage);
    this.boundStorageListener = null;
    this.authUnsubscribe = null;
    this.authAttachPromise = null;
    this.lifecycleEpoch = 0;
    this.storageAdapterDetach = null;
    this.initialized = false;
    this.authEpoch = 0;
    this.localMutationSeq = 0;
    this.reconcilingUid = null;
    this.reconcilePromise = null;

    // Clean up any obsolete GitHub token sync entry from earlier milestone versions
    try {
      this.storage.removeItem(LEGACY_GITHUB_SYNC_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  async getFirebase() {
    return await this.firebaseFactory();
  }

  isSchemaBlocked() {
    return Boolean(this.schemaTooNew || this.storageSvc?.schemaTooNew);
  }

  enterSchemaTooNewState(err) {
    this.cancelDebounce();
    this.queuedFlushAfterFlight = false;
    this.schemaTooNew = true;
    this.conflict = null;
    this.status = 'error';
    this.error =
      err?.message ||
      'App update required — reload the page to load newer cloud data safely.';
    this.emit();
  }

  saveUnsyncedBackup(uid, state) {
    if (!uid || !state) return;
    try {
      const validated = validateTrackerState(state);
      this.storage.setItem(
        UNSYNCED_BACKUP_KEY,
        JSON.stringify({
          uid,
          savedAt: new Date().toISOString(),
          state: validated,
        }),
      );
    } catch {
      // Ignore storage quota or validation errors on backup
    }
  }

  getUnsyncedBackup() {
    try {
      const raw = this.storage.getItem(UNSYNCED_BACKUP_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.uid !== 'string' || !parsed.state) {
        return null;
      }
      return {
        uid: parsed.uid,
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null,
        state: validateTrackerState(parsed.state),
      };
    } catch {
      return null;
    }
  }

  clearUnsyncedBackupForUid(uid) {
    try {
      const existing = this.getUnsyncedBackup();
      if (existing && (!uid || existing.uid === uid)) {
        this.storage.removeItem(UNSYNCED_BACKUP_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }

  loadMeta() {
    try {
      const raw = this.storage.getItem(SYNC_META_KEY);
      if (!raw) return createDefaultMeta();
      const parsed = JSON.parse(raw);
      return {
        lastSyncedUid:
          typeof parsed?.lastSyncedUid === 'string' && parsed.lastSyncedUid
            ? parsed.lastSyncedUid
            : null,
        lastSyncedRev:
          typeof parsed?.lastSyncedRev === 'number' &&
          Number.isInteger(parsed.lastSyncedRev) &&
          parsed.lastSyncedRev >= 0
            ? parsed.lastSyncedRev
            : 0,
        shareToken: isValidShareToken(parsed?.shareToken)
          ? parsed.shareToken.trim()
          : null,
        lastSyncedAt:
          typeof parsed?.lastSyncedAt === 'string' ? parsed.lastSyncedAt : null,
        dirty: Boolean(parsed?.dirty),
      };
    } catch {
      return createDefaultMeta();
    }
  }

  saveMeta(nextMeta) {
    this.meta = { ...this.meta, ...nextMeta };
    try {
      this.storage.setItem(SYNC_META_KEY, JSON.stringify(this.meta));
    } catch {
      // Ignore QuotaExceededError / SecurityError
    }
  }

  clearMeta() {
    this.meta = createDefaultMeta();
    this.lastSyncedStateSnapshot = null;
    try {
      this.storage.removeItem(SYNC_META_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  getSnapshot() {
    return {
      status: this.status,
      user: this.currentUser ? { ...this.currentUser } : null,
      lastSyncedAt: this.meta.lastSyncedAt,
      shareToken: this.meta.shareToken,
      rev: this.meta.lastSyncedRev,
      dirty: this.meta.dirty,
      error: this.error,
      schemaTooNew: this.isSchemaBlocked(),
      conflict: this.conflict
        ? {
            ...this.conflict,
            remoteState: this.conflict.remoteState
              ? structuredClone(this.conflict.remoteState)
              : null,
          }
        : null,
    };
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit() {
    const snap = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snap);
      } catch (err) {
        console.error('CloudSyncManager listener error:', err);
      }
    }
  }

  attachAuthObserver(fb) {
    if (this.authUnsubscribe) return fb;
    this.authUnsubscribe = fb.onAuthStateChanged(
      (fbUser) => {
        this.handleAuthStateChanged(fbUser).catch((err) => {
          if (!this.currentUser || this.status !== 'syncing') return;
          const offline = isBrowserOffline() || err?.code === 'unavailable';
          this.status = offline ? 'offline' : 'error';
          this.error = offline ? null : formatFriendlyError(err);
          this.emit();
        });
      },
      (err) => {
        this.status = 'error';
        this.error = formatFriendlyError(err);
        this.emit();
      },
    );
    return fb;
  }

  handleFirebaseInitError(err) {
    if (err?.code === 'firebase/not-configured') {
      this.status = 'disconnected';
      this.error = null;
    } else {
      this.status = 'error';
      this.error = formatFriendlyError(err);
    }
    this.emit();
  }

  ensureAuthListenerAttached({ throwOnError = false } = {}) {
    if (this.authAttachPromise) {
      return throwOnError
        ? this.authAttachPromise
        : this.authAttachPromise.catch(() => null);
    }

    const attachEpoch = this.lifecycleEpoch;
    let maybeFb;
    try {
      maybeFb = this.firebaseFactory();
    } catch (err) {
      this.handleFirebaseInitError(err);
      return throwOnError ? Promise.reject(err) : Promise.resolve(null);
    }

    if (maybeFb && typeof maybeFb.then === 'function') {
      const p = maybeFb
        .then((fb) => {
          if (this.authAttachPromise === p) {
            this.authAttachPromise = null;
          }
          if (!this.initialized || this.lifecycleEpoch !== attachEpoch) {
            return fb;
          }
          return this.attachAuthObserver(fb);
        })
        .catch((err) => {
          if (this.authAttachPromise === p) {
            this.authAttachPromise = null;
          }
          if (this.initialized && this.lifecycleEpoch === attachEpoch) {
            this.handleFirebaseInitError(err);
          }
          throw err;
        });
      this.authAttachPromise = p;
      return throwOnError ? p : p.catch(() => null);
    }

    try {
      if (this.initialized) {
        this.attachAuthObserver(maybeFb);
      }
      return maybeFb;
    } catch (err) {
      this.handleFirebaseInitError(err);
      return throwOnError ? Promise.reject(err) : Promise.resolve(null);
    }
  }

  /**
   * Pre-warms `./firebase.js` and `getAuth(app)` when the user opens `CloudSyncModal`
   * so Safari/iOS/mobile `_popupRedirectResolver` initializes its auth iframe before
   * the user taps "Sign in with Google" (#48, QA M-01).
   */
  prepareSignIn() {
    return this.ensureAuthListenerAttached({ throwOnError: false });
  }

  /**
   * Connects CloudSyncManager to `StorageService` and starts listening to Firebase Auth state
   * when a returning cloud session hint exists (`lastSyncedUid` or `unsyncedBackup`) (#48).
   * Safe to call multiple times; returns a cleanup function.
   */
  start() {
    if (!this.storageAdapterDetach && this.storageSvc) {
      this.storageAdapterDetach = this.storageSvc.registerCloudAdapter({
        save: (nextState) => this.handleLocalStateSaved(nextState),
      });
    }

    if (
      this.usesBrowserLocalStorage &&
      typeof window !== 'undefined' &&
      !this.boundStorageListener
    ) {
      this.boundStorageListener = (e) => this.handleExternalStorageEvent(e);
      window.addEventListener('storage', this.boundStorageListener);
    }

    if (!this.initialized) {
      this.initialized = true;
      this.lifecycleEpoch += 1;
      this.meta = this.loadMeta();
      const shouldEagerlyRestoreSession =
        this.hasCustomFirebaseFactory ||
        Boolean(this.meta.lastSyncedUid || this.getUnsyncedBackup());

      if (shouldEagerlyRestoreSession) {
        this.ensureAuthListenerAttached({ throwOnError: false });
      }
    }

    return () => this.stop();
  }

  stop() {
    this.lifecycleEpoch += 1;
    this.authAttachPromise = null;
    this.cancelDebounce();
    if (this.boundStorageListener && typeof window !== 'undefined') {
      window.removeEventListener('storage', this.boundStorageListener);
      this.boundStorageListener = null;
    }
    if (typeof this.authUnsubscribe === 'function') {
      try {
        this.authUnsubscribe();
      } catch {
        // Ignore cleanup errors
      }
      this.authUnsubscribe = null;
    }
    if (typeof this.storageAdapterDetach === 'function') {
      this.storageAdapterDetach();
      this.storageAdapterDetach = null;
    }
    this.initialized = false;
  }

  /**
   * Synchronizes in-memory state and metadata across browser tabs when another tab
   * wipes storage on Sign Out or saves updated courses/revisions (#11).
   */
  handleExternalStorageEvent(event) {
    const trackerKey = this.storageSvc?.storageKey || STORAGE_KEY;

    if (!event || event.key === null || (event.key === SYNC_META_KEY && event.newValue === null)) {
      this.cancelDebounce();
      this.queuedFlushAfterFlight = false;
      this.meta = this.loadMeta();
      this.conflict = null;
      this.lastSyncedStateSnapshot = null;
      const reloaded = this.storageSvc.load();
      this.latestLocalState = reloaded;
      this.storageSvc.notify(reloaded);
      this.emit();
      return;
    }

    if (event.key === SYNC_META_KEY) {
      this.meta = this.loadMeta();
      if (this.initialized && this.meta.lastSyncedUid && !this.authUnsubscribe) {
        this.ensureAuthListenerAttached({ throwOnError: false });
      }
      if (!this.meta.dirty) {
        if (this.status === 'pending') {
          this.cancelDebounce();
          if (this.currentUser) {
            this.status = 'synced';
          }
        } else if (
          this.status === 'conflict' &&
          this.currentUser &&
          this.meta.lastSyncedUid === this.currentUser.uid &&
          this.meta.lastSyncedRev > 0 &&
          !this.inFlightPromise
        ) {
          this.cancelDebounce();
          this.conflict = null;
          this.error = null;
          this.status = 'synced';
        }
      }
      this.emit();
      return;
    }

    if (event.key === trackerKey) {
      const prevLocal = this.latestLocalState;
      const reloaded = this.storageSvc.load();
      if (this.storageSvc?.schemaTooNew) {
        this.enterSchemaTooNewState(this.storageSvc.schemaTooNewError);
        return;
      }
      this.latestLocalState = reloaded;
      if (
        event.newValue === null ||
        !prevLocal ||
        !areTrackerStatesEquivalent(prevLocal, reloaded)
      ) {
        this.storageSvc.notify(reloaded);
      }
    }
  }

  cancelDebounce() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  applyRemoteStateLocally(remoteState) {
    const validated = validateTrackerState(remoteState);
    this.latestLocalState = validated;
    this.lastSyncedStateSnapshot = validated;
    this.storageSvc.saveLocalOnly(validated);
    this.storageSvc.notify(validated);
    return validated;
  }

  resetLocalTrackerClean() {
    this.lastSyncedStateSnapshot = null;
    if (typeof this.storageSvc?.resetClean === 'function') {
      const fresh = this.storageSvc.resetClean();
      this.latestLocalState = fresh;
      return fresh;
    }
    try {
      this.storage.removeItem(this.storageSvc?.storageKey || STORAGE_KEY);
    } catch {
      // Ignore
    }
    const fresh = createInitialState();
    this.latestLocalState = fresh;
    this.storageSvc.saveLocalOnly(fresh);
    this.storageSvc.notify(fresh);
    return fresh;
  }

  scheduleFollowUpFlushIfNeeded() {
    if (
      !this.currentUser ||
      !this.meta.dirty ||
      this.status === 'conflict' ||
      isBrowserOffline() ||
      this.debounceTimer !== null
    ) {
      return;
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushPendingSave().catch(() => {});
    }, this.debounceMs);
  }

  /**
   * Invoked automatically whenever the user saves an edit through `storageService.save(...)`.
   */
  handleLocalStateSaved(nextState) {
    if (this.isSchemaBlocked()) {
      return Promise.resolve();
    }

    if (
      !this.meta.dirty &&
      this.currentUser &&
      this.meta.lastSyncedUid === this.currentUser.uid &&
      this.lastSyncedStateSnapshot &&
      areTrackerStatesEquivalent(this.lastSyncedStateSnapshot, nextState)
    ) {
      this.latestLocalState = nextState;
      return Promise.resolve();
    }

    this.localMutationSeq += 1;
    this.latestLocalState = nextState;
    this.saveMeta({ dirty: true });

    if (!this.currentUser) {
      return Promise.resolve();
    }

    if (this.status === 'conflict') {
      this.emit();
      return Promise.resolve();
    }

    if (isBrowserOffline()) {
      this.status = 'offline';
      this.error = null;
      this.emit();
      return Promise.resolve();
    }

    this.status = 'pending';
    this.error = null;
    this.emit();

    this.cancelDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushPendingSave().catch(() => {});
    }, this.debounceMs);

    return Promise.resolve();
  }

  async handleAuthStateChanged(fbUser) {
    const sanitized = sanitizeUserForMemory(fbUser);

    if (!sanitized) {
      const wasSignedIn = Boolean(this.currentUser);
      const previousUid = this.currentUser?.uid || this.meta.lastSyncedUid;
      const persistedMetaRaw = (() => {
        try {
          return this.storage.getItem(SYNC_META_KEY);
        } catch {
          return null;
        }
      })();
      const persistedMeta = persistedMetaRaw ? this.loadMeta() : null;
      const rawStoredTracker = (() => {
        try {
          return this.storage.getItem(this.storageSvc?.storageKey || STORAGE_KEY);
        } catch {
          return null;
        }
      })();
      // If another tab already wiped SYNC_META_KEY on explicit Sign Out, do NOT create a backup (#3)
      const shouldBackupUnsynced =
        wasSignedIn &&
        !this.explicitSignOutInProgress &&
        !this.isSchemaBlocked() &&
        rawStoredTracker !== null &&
        ((persistedMeta && persistedMeta.dirty) ||
          (persistedMetaRaw === null &&
            this.meta.dirty &&
            !this.usesBrowserLocalStorage) ||
          (!this.meta.lastSyncedUid && this.hasUnreconciledCustomLocalCourses()));
      const stateForBackup = shouldBackupUnsynced
        ? this.latestLocalState || this.storageSvc.load()
        : null;

      this.authEpoch += 1;
      this.reconcilingUid = null;
      this.reconcilePromise = null;
      this.queuedFlushAfterFlight = false;
      this.cancelDebounce();
      this.currentUser = null;
      this.conflict = null;
      this.error = null;
      this.schemaTooNew = false;
      this.status = 'disconnected';
      if (wasSignedIn) {
        if (shouldBackupUnsynced && previousUid && stateForBackup) {
          this.saveUnsyncedBackup(previousUid, stateForBackup);
        }
        this.clearMeta();
        this.resetLocalTrackerClean();
      }
      this.emit();
      return;
    }

    if (this.reconcilingUid === sanitized.uid && this.reconcilePromise) {
      await this.reconcilePromise;
      return;
    }

    if (
      this.currentUser?.uid === sanitized.uid &&
      !this.reconcilePromise &&
      (this.status === 'synced' ||
        this.status === 'conflict' ||
        this.status === 'pending')
    ) {
      this.currentUser = sanitized;
      this.emit();
      return;
    }

    this.authEpoch += 1;
    const myEpoch = this.authEpoch;
    this.currentUser = sanitized;
    this.error = null;
    this.reconcilingUid = sanitized.uid;

    const p = this.reconcileOnSignIn(sanitized.uid, myEpoch).finally(() => {
      if (this.reconcilePromise === p) {
        this.reconcilePromise = null;
        this.reconcilingUid = null;
      }
    });
    this.reconcilePromise = p;
    await p;
  }

  /**
   * Reconciles cloud vs. local tracker on sign-in while strictly preventing
   * cross-account localStorage bleed (`E2`), stale overwrites (`R4`), and
   * newer-schema stripping (`#37`).
   */
  async reconcileOnSignIn(uid, expectedEpoch = this.authEpoch) {
    if (this.storageSvc?.schemaTooNew) {
      this.enterSchemaTooNewState(this.storageSvc.schemaTooNewError);
      return;
    }

    this.status = 'syncing';
    this.conflict = null;
    this.error = null;
    this.emit();

    try {
      const preFetchHadSyncedRev =
        this.meta.lastSyncedUid === uid && (this.meta.lastSyncedRev || 0) > 0;
      const fb = await this.getFirebase();
      const userRef = fb.doc('users', uid);
      let snap = await fb.getDoc(userRef);

      if (expectedEpoch !== this.authEpoch || this.currentUser?.uid !== uid) {
        return;
      }

      if (
        !snap.exists() &&
        !preFetchHadSyncedRev &&
        this.meta.lastSyncedUid === uid &&
        (this.meta.lastSyncedRev || 0) > 0
      ) {
        // Another tab just created `users/{uid}` while our initial getDoc was in flight
        snap = await fb.getDoc(userRef);
        if (expectedEpoch !== this.authEpoch || this.currentUser?.uid !== uid) {
          return;
        }
      }

      let localState = this.latestLocalState || this.storageSvc.load();
      let hadRecoveredBackup = false;
      const unsyncedBackup = this.getUnsyncedBackup();
      if (unsyncedBackup && unsyncedBackup.uid === uid) {
        const hasPostSignOutLocalEdits =
          !this.meta.lastSyncedUid &&
          !areTrackerStatesEquivalent(localState, createInitialState());
        if (!hasPostSignOutLocalEdits) {
          localState = unsyncedBackup.state;
          hadRecoveredBackup = true;
          this.latestLocalState = localState;
          this.storageSvc.saveLocalOnly(localState);
          this.storageSvc.notify(localState);
          // Clear any different-account meta marker since this backup is verified as `uid`'s own,
          // and keep UNSYNCED_BACKUP_KEY intact until sync/conflict resolution completes!
          this.saveMeta({
            lastSyncedUid:
              this.meta.lastSyncedUid === uid ? uid : null,
            lastSyncedRev:
              this.meta.lastSyncedUid === uid ? this.meta.lastSyncedRev : 0,
            shareToken:
              this.meta.lastSyncedUid === uid ? this.meta.shareToken : null,
            dirty: true,
          });
        }
      }

      const { lastSyncedUid, lastSyncedRev, dirty } = this.meta;
      const isDifferentPreviousOwner =
        Boolean(lastSyncedUid) && lastSyncedUid !== uid;

      if (snap.exists()) {
        const data = snap.data() || {};
        const remoteRev =
          typeof data.rev === 'number' && Number.isInteger(data.rev) ? data.rev : 1;
        const remoteShareToken = isValidShareToken(data.shareToken)
          ? data.shareToken.trim()
          : null;
        const remoteState = validateTrackerState(JSON.parse(data.stateJson));

        // Case A: Local storage belonged to a DIFFERENT Google account -> never auto-upload!
        if (isDifferentPreviousOwner) {
          if (dirty) {
            this.status = 'conflict';
            this.conflict = {
              reason: 'account-switch',
              remoteState,
              remoteRev,
              remoteShareToken,
            };
            this.emit();
            return;
          }
          this.saveMeta({
            lastSyncedUid: uid,
            lastSyncedRev: remoteRev,
            shareToken: remoteShareToken,
            lastSyncedAt: new Date().toISOString(),
            dirty: false,
          });
          this.applyRemoteStateLocally(remoteState);
          this.clearUnsyncedBackupForUid(uid);
          this.status = 'synced';
          this.emit();
          return;
        }

        // Case B: Never synced on this browser before (`lastSyncedUid === null`)
        if (!lastSyncedUid) {
          const hasCustomLocalData =
            hadRecoveredBackup ||
            !areTrackerStatesEquivalent(localState, createInitialState());
          const differsFromRemote = !areTrackerStatesEquivalent(
            localState,
            remoteState,
          );

          if (hasCustomLocalData && differsFromRemote) {
            this.status = 'conflict';
            this.conflict = {
              reason: hadRecoveredBackup ? 'rev-mismatch' : 'initial-merge',
              remoteState,
              remoteRev,
              remoteShareToken,
            };
            this.emit();
            return;
          }
          this.saveMeta({
            lastSyncedUid: uid,
            lastSyncedRev: remoteRev,
            shareToken: remoteShareToken,
            lastSyncedAt: new Date().toISOString(),
            dirty: false,
          });
          this.applyRemoteStateLocally(remoteState);
          this.clearUnsyncedBackupForUid(uid);
          this.status = 'synced';
          this.emit();
          return;
        }

        // Case C: Returning same user (`lastSyncedUid === uid`)
        if (dirty || hadRecoveredBackup) {
          if (lastSyncedRev === remoteRev) {
            this.saveMeta({
              lastSyncedUid: uid,
              lastSyncedRev: remoteRev,
              shareToken: remoteShareToken,
            });
            await this.pushStateToCloud(localState);
            return;
          }
          if (!areTrackerStatesEquivalent(localState, remoteState)) {
            this.status = 'conflict';
            this.conflict = {
              reason: 'rev-mismatch',
              remoteState,
              remoteRev,
              remoteShareToken,
            };
            this.emit();
            return;
          }
        }

        const sameAsRemote = areTrackerStatesEquivalent(localState, remoteState);
        this.lastSyncedStateSnapshot = remoteState;
        this.saveMeta({
          lastSyncedUid: uid,
          lastSyncedRev: remoteRev,
          shareToken: remoteShareToken,
          lastSyncedAt: new Date().toISOString(),
          dirty: false,
        });
        if (!sameAsRemote) {
          this.applyRemoteStateLocally(remoteState);
        }
        this.clearUnsyncedBackupForUid(uid);
        this.status = 'synced';
        this.emit();
        return;
      }

      // Cloud document `users/{uid}` does NOT exist!
      if (isDifferentPreviousOwner) {
        // Never auto-upload another user's leftover localStorage into a brand-new account (`E2`)
        this.status = 'conflict';
        this.conflict = {
          reason: 'account-switch',
          remoteState: null,
          remoteRev: 0,
          remoteShareToken: null,
        };
        this.emit();
        return;
      }

      // Same account previously synced (`lastSyncedRev > 0`), meaning cloud data was deleted on another device (#15)
      if (lastSyncedUid === uid && (lastSyncedRev || 0) > 0) {
        this.status = 'conflict';
        this.conflict = {
          reason: 'remote-deleted',
          remoteState: null,
          remoteRev: 0,
          remoteShareToken: null,
        };
        this.emit();
        return;
      }

      // First-time cloud setup for this user -> create `users/{uid}` at `rev: 1`.
      // Leave `lastSyncedUid` unset until `pushStateToCloud` commits so failed initial pushes
      // never strip `hasUnreconciledCustomLocalCourses()` protection.
      this.saveMeta({
        lastSyncedRev: 0,
        shareToken: null,
      });
      await this.pushStateToCloud(localState);
    } catch (err) {
      if (expectedEpoch === this.authEpoch && this.currentUser?.uid === uid) {
        if (isSchemaTooNewError(err)) {
          this.enterSchemaTooNewState(err);
          return;
        }
        if (isBrowserOffline() || err?.code === 'unavailable') {
          this.status = 'offline';
          this.error = null;
        } else {
          this.status = 'error';
          this.error = formatFriendlyError(err);
        }
        this.emit();
      }
      throw err;
    }
  }

  async signInWithGoogle() {
    this.error = null;
    this.emit();
    try {
      const maybeFb = this.ensureAuthListenerAttached({ throwOnError: true });
      const fb =
        maybeFb && typeof maybeFb.then === 'function' ? await maybeFb : maybeFb;
      const cred = await fb.signInWithGooglePopup();
      if (cred?.user) {
        await this.handleAuthStateChanged(cred.user);
      }
      return this.getSnapshot();
    } catch (err) {
      const msg = formatFriendlyError(err);
      const nextStatus = !this.currentUser
        ? 'disconnected'
        : isBrowserOffline() || err?.code === 'unavailable'
          ? 'offline'
          : 'error';
      if (msg) {
        this.status = nextStatus;
        this.error = msg;
        this.emit();
        throw new Error(msg, { cause: err });
      }
      if (this.status === 'syncing' || !this.currentUser) {
        this.status = nextStatus;
        this.emit();
      }
      return this.getSnapshot();
    }
  }

  isSessionCurrent(uid, epoch) {
    return this.authEpoch === epoch && this.currentUser?.uid === uid;
  }

  hasUnreconciledCustomLocalCourses() {
    if (this.meta.lastSyncedUid) return false;
    const current = this.latestLocalState || this.storageSvc.load();
    return !areTrackerStatesEquivalent(current, createInitialState());
  }

  /**
   * Signs out of Firebase Auth AND wipes local grade storage + sync metadata (`E2`).
   * Unless `forceDiscard` is true, flushes any pending debounced edits to Firestore first;
   * if unsynced edits still remain (offline, conflict, push failure, or failed initial
   * reconciliation over custom local courses), aborts sign-out and returns
   * `{ signedOut: false, requiresDiscardConfirm: true }` (#9).
   */
  async signOutUser({ forceDiscard = false } = {}) {
    await Promise.resolve();
    if (!forceDiscard && this.currentUser && !this.isSchemaBlocked()) {
      if (this.reconcilePromise) {
        await this.reconcilePromise.catch(() => {});
      }
      if (this.inFlightPromise) {
        await this.inFlightPromise.catch(() => {});
      }

      const needsFlush =
        this.meta.dirty ||
        this.debounceTimer !== null ||
        this.hasUnreconciledCustomLocalCourses();

      if (this.currentUser && needsFlush) {
        this.cancelDebounce();
        if (!isBrowserOffline() && this.status !== 'conflict') {
          try {
            await this.flushPendingSave();
          } catch {
            // Leave unsynced state intact so confirmation prompt triggers below
          }
          if (this.inFlightPromise) {
            await this.inFlightPromise.catch(() => {});
          }
        }
      }

      if (
        this.currentUser &&
        !this.isSchemaBlocked() &&
        (this.meta.dirty ||
          this.status === 'conflict' ||
          this.hasUnreconciledCustomLocalCourses())
      ) {
        return { signedOut: false, requiresDiscardConfirm: true };
      }
    }

    const signingOutUid = this.currentUser?.uid || this.meta.lastSyncedUid;
    this.authEpoch += 1;
    this.reconcilingUid = null;
    this.reconcilePromise = null;
    this.queuedFlushAfterFlight = false;
    this.cancelDebounce();

    if (this.inFlightPromise) {
      await this.inFlightPromise.catch(() => {});
    }

    // Wipe metadata, unsynced backup, and local tracker BEFORE signOutAuth() as well as in finally
    // so sibling tabs receiving onAuthStateChanged(null) never write UNSYNCED_BACKUP_KEY on explicit Sign Out (#3)
    if (signingOutUid) {
      this.clearUnsyncedBackupForUid(signingOutUid);
    }
    this.clearMeta();
    this.resetLocalTrackerClean();

    this.explicitSignOutInProgress = true;
    const fb = await this.getFirebase();
    try {
      await fb.signOutAuth();
    } finally {
      this.explicitSignOutInProgress = false;
      this.authEpoch += 1;
      this.currentUser = null;
      this.conflict = null;
      this.error = null;
      this.schemaTooNew = false;
      this.status = 'disconnected';
      if (signingOutUid) {
        this.clearUnsyncedBackupForUid(signingOutUid);
      }
      this.clearMeta();
      this.resetLocalTrackerClean();
      this.emit();
    }
    return { signedOut: true, requiresDiscardConfirm: false };
  }

  async flushPendingSave() {
    await Promise.resolve();
    if (this.isSchemaBlocked()) {
      return;
    }
    if (this.reconcilePromise) {
      await this.reconcilePromise.catch(() => {});
    }
    if (!this.currentUser || this.status === 'conflict' || this.isSchemaBlocked()) {
      return;
    }
    if (this.meta.lastSyncedUid !== this.currentUser.uid) {
      await this.reconcileOnSignIn(this.currentUser.uid, this.authEpoch);
      return;
    }
    const pushedSeq = this.localMutationSeq;
    const stateToSave = this.latestLocalState || this.storageSvc.load();
    await this.pushStateToCloud(stateToSave, { pushedSeq });
  }

  async pushStateToCloud(
    rawState,
    { pushedSeq = this.localMutationSeq, resolvingConflict = false } = {},
  ) {
    if (!this.currentUser || this.isSchemaBlocked()) return;

    if (this.inFlightPromise) {
      this.queuedFlushAfterFlight = true;
      await this.inFlightPromise;
      return;
    }

    if (pushedSeq === this.localMutationSeq) {
      this.cancelDebounce();
    }

    const uid = this.currentUser.uid;
    const startEpoch = this.authEpoch;

    const run = async () => {
      if (!this.isSessionCurrent(uid, startEpoch) || this.isSchemaBlocked()) return;
      if (!resolvingConflict) {
        this.status = 'syncing';
        this.error = null;
        this.emit();
      }

      try {
        const validated = validateTrackerState(rawState);
        const stateJson = JSON.stringify(validated);
        if (stateJson.length >= MAX_STATE_JSON_CHARS) {
          throw new Error(
            'Tracker data exceeds the 300 KB cloud document limit. Remove unused terms or courses.',
          );
        }

        const fb = await this.getFirebase();
        const nextRev = (this.meta.lastSyncedRev || 0) + 1;
        const activeShareToken = isValidShareToken(this.meta.shareToken)
          ? this.meta.shareToken.trim()
          : null;

        const batch = fb.writeBatch();
        batch.set(fb.doc('users', uid), {
          stateJson,
          updatedAt: fb.serverTimestamp(),
          rev: nextRev,
          shareToken: activeShareToken,
        });

        if (activeShareToken) {
          batch.set(fb.doc('shares', activeShareToken), {
            ownerUid: uid,
            stateJson,
            updatedAt: fb.serverTimestamp(),
          });
        }

        await batch.commit();
        if (!this.isSessionCurrent(uid, startEpoch)) return;
        const hasNewerLocalEdits = this.localMutationSeq !== pushedSeq;
        this.lastSyncedStateSnapshot = validated;
        this.saveMeta({
          lastSyncedUid: uid,
          lastSyncedRev: nextRev,
          shareToken: activeShareToken,
          lastSyncedAt: new Date().toISOString(),
          dirty: hasNewerLocalEdits,
        });
        this.conflict = null;
        if (!hasNewerLocalEdits) {
          this.clearUnsyncedBackupForUid(uid);
        }
        this.status = hasNewerLocalEdits
          ? isBrowserOffline()
            ? 'offline'
            : 'pending'
          : 'synced';
        this.error = null;
        this.emit();
        if (hasNewerLocalEdits) {
          this.scheduleFollowUpFlushIfNeeded();
        }
      } catch (err) {
        if (!this.isSessionCurrent(uid, startEpoch)) return;
        if (isSchemaTooNewError(err)) {
          this.enterSchemaTooNewState(err);
          return;
        }
        if (err?.code === 'permission-denied') {
          const fb = await this.getFirebase();
          const snap = await fb.getDoc(fb.doc('users', uid));
          if (!this.isSessionCurrent(uid, startEpoch)) return;
          if (snap.exists()) {
            const data = snap.data() || {};
            const remoteRev =
              typeof data.rev === 'number' && Number.isInteger(data.rev)
                ? data.rev
                : 1;
            const remoteShareToken = isValidShareToken(data.shareToken)
              ? data.shareToken.trim()
              : null;
            let remoteState;
            try {
              remoteState = validateTrackerState(JSON.parse(data.stateJson));
            } catch (parseErr) {
              if (isSchemaTooNewError(parseErr)) {
                this.enterSchemaTooNewState(parseErr);
                return;
              }
              throw parseErr;
            }
            const currentLocal = this.latestLocalState || this.storageSvc.load();

            if (areTrackerStatesEquivalent(currentLocal, remoteState)) {
              const hasNewerLocalEdits = this.localMutationSeq !== pushedSeq;
              this.lastSyncedStateSnapshot = remoteState;
              this.saveMeta({
                lastSyncedUid: uid,
                lastSyncedRev: remoteRev,
                shareToken: remoteShareToken,
                lastSyncedAt: new Date().toISOString(),
                dirty: hasNewerLocalEdits,
              });
              this.conflict = null;
              if (!hasNewerLocalEdits) {
                this.clearUnsyncedBackupForUid(uid);
              }
              this.status = hasNewerLocalEdits
                ? isBrowserOffline()
                  ? 'offline'
                  : 'pending'
                : 'synced';
              this.error = null;
              this.emit();
              if (hasNewerLocalEdits) {
                this.scheduleFollowUpFlushIfNeeded();
              }
              return;
            }

            this.status = 'conflict';
            this.conflict = {
              reason: 'rev-mismatch',
              remoteState,
              remoteRev,
              remoteShareToken,
            };
            this.error = null;
            this.emit();
            return;
          }
          if ((this.meta.lastSyncedRev || 0) > 0) {
            this.status = 'conflict';
            this.conflict = {
              reason: 'remote-deleted',
              remoteState: null,
              remoteRev: 0,
              remoteShareToken: null,
            };
            this.error = null;
            this.emit();
            return;
          }
        }

        if (isBrowserOffline() || err?.code === 'unavailable') {
          if (resolvingConflict) {
            this.conflict = null;
          }
          this.status = 'offline';
          this.error = null;
          this.emit();
          return;
        }

        if (!resolvingConflict) {
          this.status = 'error';
          this.error = formatFriendlyError(err);
          this.emit();
        }
        throw err;
      }
    };

    this.inFlightPromise = run();
    try {
      await this.inFlightPromise;
    } finally {
      this.inFlightPromise = null;
      if (
        this.queuedFlushAfterFlight &&
        this.isSessionCurrent(uid, startEpoch) &&
        this.status !== 'conflict' &&
        !this.isSchemaBlocked()
      ) {
        this.queuedFlushAfterFlight = false;
        const nextSeq = this.localMutationSeq;
        const latest = this.latestLocalState || this.storageSvc.load();
        await this.pushStateToCloud(latest, { pushedSeq: nextSeq });
      } else {
        this.queuedFlushAfterFlight = false;
      }
    }
  }

  /**
   * Manually syncs with Firestore (also used on window focus / network reconnect).
   */
  async syncNow(currentLocalState) {
    await Promise.resolve();
    if (!this.currentUser) return null;
    this.cancelDebounce();
    if (this.isSchemaBlocked()) {
      return this.getSnapshot();
    }
    if (currentLocalState && !this.latestLocalState) {
      this.latestLocalState = currentLocalState;
    }

    if (this.reconcilePromise) {
      await this.reconcilePromise.catch(() => {});
    }
    if (this.inFlightPromise) {
      await this.inFlightPromise.catch(() => {});
    }
    if (!this.currentUser || this.status === 'conflict' || this.isSchemaBlocked()) {
      return this.getSnapshot();
    }

    const uid = this.currentUser.uid;
    if (this.meta.lastSyncedUid !== uid) {
      await this.reconcileOnSignIn(uid, this.authEpoch);
      return this.getSnapshot();
    }

    const startEpoch = this.authEpoch;
    this.status = 'syncing';
    this.error = null;
    this.emit();

    try {
      const fb = await this.getFirebase();
      const snap = await fb.getDoc(fb.doc('users', uid));
      if (!this.isSessionCurrent(uid, startEpoch)) {
        return this.getSnapshot();
      }
      const localState = this.latestLocalState || this.storageSvc.load();

      if (!snap.exists()) {
        if ((this.meta.lastSyncedRev || 0) > 0) {
          this.status = 'conflict';
          this.conflict = {
            reason: 'remote-deleted',
            remoteState: null,
            remoteRev: 0,
            remoteShareToken: null,
          };
          this.error = null;
          this.emit();
          return this.getSnapshot();
        }
        this.saveMeta({
          lastSyncedRev: 0,
          shareToken: null,
        });
        await this.pushStateToCloud(localState);
        return this.getSnapshot();
      }

      const data = snap.data() || {};
      const remoteRev =
        typeof data.rev === 'number' && Number.isInteger(data.rev) ? data.rev : 1;
      const remoteShareToken = isValidShareToken(data.shareToken)
        ? data.shareToken.trim()
        : null;
      const remoteState = validateTrackerState(JSON.parse(data.stateJson));

      if (this.meta.dirty) {
        if ((this.meta.lastSyncedRev || 0) === remoteRev) {
          this.saveMeta({
            lastSyncedUid: uid,
            lastSyncedRev: remoteRev,
            shareToken: remoteShareToken,
          });
          await this.pushStateToCloud(localState);
          return this.getSnapshot();
        }
        if (!areTrackerStatesEquivalent(localState, remoteState)) {
          this.status = 'conflict';
          this.conflict = {
            reason: 'rev-mismatch',
            remoteState,
            remoteRev,
            remoteShareToken,
          };
          this.emit();
          return this.getSnapshot();
        }
      }

      const revChanged =
        remoteRev !== this.meta.lastSyncedRev || Boolean(this.meta.dirty);
      const sameAsRemote = areTrackerStatesEquivalent(localState, remoteState);
      this.lastSyncedStateSnapshot = remoteState;
      this.saveMeta({
        lastSyncedUid: uid,
        lastSyncedRev: remoteRev,
        shareToken: remoteShareToken,
        lastSyncedAt: new Date().toISOString(),
        dirty: false,
      });
      if (revChanged && !sameAsRemote) {
        this.applyRemoteStateLocally(remoteState);
      }
      this.clearUnsyncedBackupForUid(uid);
      this.conflict = null;
      this.status = 'synced';
      this.emit();
      return this.getSnapshot();
    } catch (err) {
      if (!this.isSessionCurrent(uid, startEpoch)) {
        return this.getSnapshot();
      }
      if (isSchemaTooNewError(err)) {
        this.enterSchemaTooNewState(err);
        return this.getSnapshot();
      }
      if (isBrowserOffline() || err?.code === 'unavailable') {
        this.status = 'offline';
        this.error = null;
      } else {
        this.status = 'error';
        this.error = formatFriendlyError(err);
      }
      this.emit();
      throw err;
    }
  }

  /**
   * Resolves a sync conflict (`'use-remote'` or `'keep-local'`).
   */
  async resolveConflict(strategy, currentLocalState) {
    await Promise.resolve();
    while (this.inFlightPromise) {
      await this.inFlightPromise.catch(() => {});
    }
    if (!this.currentUser || !this.conflict || this.isSchemaBlocked()) {
      return this.getSnapshot();
    }
    const uid = this.currentUser.uid;
    const startEpoch = this.authEpoch;
    const activeConflict = this.conflict;
    const prevMeta = { ...this.meta };

    if (strategy === 'use-remote') {
      if (activeConflict.reason === 'remote-deleted') {
        await this.signOutUser({ forceDiscard: true });
        return this.getSnapshot();
      }
      if (activeConflict.remoteState) {
        this.conflict = null;
        this.saveMeta({
          lastSyncedUid: uid,
          lastSyncedRev: activeConflict.remoteRev,
          shareToken: activeConflict.remoteShareToken,
          lastSyncedAt: new Date().toISOString(),
          dirty: false,
        });
        this.applyRemoteStateLocally(activeConflict.remoteState);
        this.clearUnsyncedBackupForUid(uid);
        this.status = 'synced';
        this.error = null;
        this.emit();
        return this.getSnapshot();
      }

      // New account on shared computer chose to discard previous user's local courses & start fresh.
      // Keep `this.conflict` & `this.status === 'conflict'` while commit is in flight (`resolvingConflict: true`)
      // so `<SyncConflictModal>` stays mounted and preserves its busy/error state.
      const fresh = createInitialState();
      this.saveMeta({
        lastSyncedUid: uid,
        lastSyncedRev: 0,
        shareToken: null,
        dirty: true,
      });
      try {
        await this.pushStateToCloud(fresh, { resolvingConflict: true });
        if (this.isSessionCurrent(uid, startEpoch) && this.status !== 'conflict') {
          this.applyRemoteStateLocally(fresh);
        }
        return this.getSnapshot();
      } catch (err) {
        if (this.isSessionCurrent(uid, startEpoch)) {
          this.saveMeta(prevMeta);
          if (this.status !== 'conflict' || !this.conflict) {
            this.conflict = activeConflict;
            this.status = 'conflict';
            this.emit();
          }
        }
        throw new Error(
          formatFriendlyError(err) || 'Could not resolve sync conflict.',
          { cause: err },
        );
      }
    }

    if (strategy === 'keep-local') {
      const chosenLocal = validateTrackerState(
        currentLocalState || this.latestLocalState || this.storageSvc.load(),
      );
      this.latestLocalState = chosenLocal;
      this.storageSvc.saveLocalOnly(chosenLocal);
      this.saveMeta({
        lastSyncedUid: uid,
        lastSyncedRev:
          activeConflict.reason === 'remote-deleted'
            ? 0
            : activeConflict.remoteRev || 0,
        shareToken:
          activeConflict.reason === 'remote-deleted'
            ? null
            : activeConflict.remoteShareToken || null,
        dirty: true,
      });
      try {
        await this.pushStateToCloud(chosenLocal, { resolvingConflict: true });
        return this.getSnapshot();
      } catch (err) {
        if (this.isSessionCurrent(uid, startEpoch)) {
          this.saveMeta(prevMeta);
          if (this.status !== 'conflict' || !this.conflict) {
            this.conflict = activeConflict;
            this.status = 'conflict';
            this.emit();
          }
        }
        throw new Error(
          formatFriendlyError(err) || 'Could not resolve sync conflict.',
          { cause: err },
        );
      }
    }

    return this.getSnapshot();
  }

  /**
   * Enables a new live read-only share link or rotates an existing one in a single
   * atomic `writeBatch` (creating `shares/{newToken}`, updating `users/{uid}.shareToken`,
   * and deleting `shares/{oldToken}` so zero orphan share documents ever remain).
   */
  async enableOrRotateShare(currentLocalState) {
    await Promise.resolve();
    if (!this.currentUser) {
      throw new Error('Sign in with Google first to enable a live share link.');
    }
    if (this.isSchemaBlocked()) {
      throw new SchemaTooNewError(
        CURRENT_SCHEMA_VERSION + 1,
        CURRENT_SCHEMA_VERSION,
      );
    }
    this.cancelDebounce();
    if (this.reconcilePromise) {
      await this.reconcilePromise;
    }
    while (this.inFlightPromise) {
      await this.inFlightPromise;
    }
    if (!this.currentUser) {
      throw new Error('Sign in with Google first to enable a live share link.');
    }
    if (this.isSchemaBlocked()) {
      throw new SchemaTooNewError(
        CURRENT_SCHEMA_VERSION + 1,
        CURRENT_SCHEMA_VERSION,
      );
    }

    const uid = this.currentUser.uid;
    const startEpoch = this.authEpoch;
    let createdToken = null;

    const run = async () => {
      const pushedSeq = this.localMutationSeq;
      let effectiveState = validateTrackerState(
        this.latestLocalState || currentLocalState || this.storageSvc.load(),
      );

      const fb = await this.getFirebase();
      const userRef = fb.doc('users', uid);
      const userSnap = await fb.getDoc(userRef);
      if (!this.isSessionCurrent(uid, startEpoch)) {
        throw new Error('Account session changed.');
      }

      let baseRev = 0;
      let oldToken = this.meta.shareToken;

      if (userSnap.exists()) {
        const data = userSnap.data() || {};
        baseRev = typeof data.rev === 'number' && Number.isInteger(data.rev) ? data.rev : 0;
        oldToken = isValidShareToken(data.shareToken) ? data.shareToken.trim() : null;
        let remoteState;
        try {
          remoteState = validateTrackerState(JSON.parse(data.stateJson));
        } catch (err) {
          if (isSchemaTooNewError(err)) {
            this.enterSchemaTooNewState(err);
          }
          throw err;
        }

        if ((this.meta.lastSyncedRev || 0) !== baseRev) {
          const sameAsRemote = areTrackerStatesEquivalent(
            effectiveState,
            remoteState,
          );
          if (
            (this.meta.dirty || this.localMutationSeq !== pushedSeq) &&
            !sameAsRemote
          ) {
            this.status = 'conflict';
            this.conflict = {
              reason: 'rev-mismatch',
              remoteState,
              remoteRev: baseRev,
              remoteShareToken: oldToken,
            };
            this.emit();
            throw new Error(
              'Cloud grades were updated on another device. Please resolve the sync conflict first.',
            );
          }
          if (!sameAsRemote) {
            effectiveState = this.applyRemoteStateLocally(remoteState);
          } else {
            this.lastSyncedStateSnapshot = remoteState;
          }
        }
      } else if ((this.meta.lastSyncedRev || 0) > 0) {
        this.status = 'conflict';
        this.conflict = {
          reason: 'remote-deleted',
          remoteState: null,
          remoteRev: 0,
          remoteShareToken: null,
        };
        this.error = null;
        this.emit();
        throw new Error(
          'Saved cloud courses were deleted on another device. Please resolve the sync prompt first.',
        );
      }

      const stateJson = JSON.stringify(effectiveState);
      if (stateJson.length >= MAX_STATE_JSON_CHARS) {
        throw new Error('Tracker data exceeds the 300 KB cloud document limit.');
      }

      const newToken = generateShareToken();
      const nextRev = baseRev + 1;

      let shouldDeleteOldShare = false;
      if (oldToken && oldToken !== newToken) {
        const oldShareSnap = await fb.getDoc(fb.doc('shares', oldToken));
        if (!this.isSessionCurrent(uid, startEpoch)) {
          throw new Error('Account session changed.');
        }
        shouldDeleteOldShare =
          oldShareSnap.exists() && oldShareSnap.data()?.ownerUid === uid;
      }

      const batch = fb.writeBatch();
      batch.set(userRef, {
        stateJson,
        updatedAt: fb.serverTimestamp(),
        rev: nextRev,
        shareToken: newToken,
      });
      batch.set(fb.doc('shares', newToken), {
        ownerUid: uid,
        stateJson,
        updatedAt: fb.serverTimestamp(),
      });
      if (shouldDeleteOldShare) {
        batch.delete(fb.doc('shares', oldToken));
      }

      await batch.commit();
      if (!this.isSessionCurrent(uid, startEpoch)) {
        throw new Error('Account session changed.');
      }

      const hasNewerLocalEdits = this.localMutationSeq !== pushedSeq;
      this.lastSyncedStateSnapshot = effectiveState;
      this.saveMeta({
        lastSyncedUid: uid,
        lastSyncedRev: nextRev,
        shareToken: newToken,
        lastSyncedAt: new Date().toISOString(),
        dirty: hasNewerLocalEdits,
      });
      this.status = hasNewerLocalEdits
        ? isBrowserOffline()
          ? 'offline'
          : 'pending'
        : 'synced';
      this.error = null;
      this.emit();
      if (hasNewerLocalEdits) {
        this.scheduleFollowUpFlushIfNeeded();
      }
      createdToken = newToken;
    };

    this.inFlightPromise = run();
    try {
      await this.inFlightPromise;
      return createdToken;
    } finally {
      this.inFlightPromise = null;
      if (
        this.queuedFlushAfterFlight &&
        this.isSessionCurrent(uid, startEpoch) &&
        this.status !== 'conflict' &&
        !this.isSchemaBlocked()
      ) {
        this.queuedFlushAfterFlight = false;
        const nextSeq = this.localMutationSeq;
        const latest = this.latestLocalState || this.storageSvc.load();
        await this.pushStateToCloud(latest, { pushedSeq: nextSeq });
      } else {
        this.queuedFlushAfterFlight = false;
      }
    }
  }

  /**
   * Disables the active live share link in a single atomic `writeBatch`
   * (setting `users/{uid}.shareToken = null` and deleting `shares/{oldToken}`).
   */
  async disableShare(currentLocalState) {
    await Promise.resolve();
    if (!this.currentUser) {
      throw new Error('Not signed in.');
    }
    if (this.isSchemaBlocked()) {
      throw new SchemaTooNewError(
        CURRENT_SCHEMA_VERSION + 1,
        CURRENT_SCHEMA_VERSION,
      );
    }
    this.cancelDebounce();
    if (this.reconcilePromise) {
      await this.reconcilePromise;
    }
    while (this.inFlightPromise) {
      await this.inFlightPromise;
    }
    if (!this.currentUser) {
      throw new Error('Not signed in.');
    }
    if (this.isSchemaBlocked()) {
      throw new SchemaTooNewError(
        CURRENT_SCHEMA_VERSION + 1,
        CURRENT_SCHEMA_VERSION,
      );
    }

    const uid = this.currentUser.uid;
    const startEpoch = this.authEpoch;

    const run = async () => {
      const pushedSeq = this.localMutationSeq;
      let effectiveState = validateTrackerState(
        this.latestLocalState || currentLocalState || this.storageSvc.load(),
      );

      const fb = await this.getFirebase();
      const userRef = fb.doc('users', uid);
      const userSnap = await fb.getDoc(userRef);
      if (!this.isSessionCurrent(uid, startEpoch)) return;
      if (!userSnap.exists()) {
        if ((this.meta.lastSyncedRev || 0) > 0) {
          this.status = 'conflict';
          this.conflict = {
            reason: 'remote-deleted',
            remoteState: null,
            remoteRev: 0,
            remoteShareToken: null,
          };
          this.error = null;
          this.emit();
          throw new Error(
            'Saved cloud courses were deleted on another device. Please resolve the sync prompt first.',
          );
        }
        this.saveMeta({ shareToken: null });
        this.emit();
        return;
      }

      const data = userSnap.data() || {};
      const baseRev = typeof data.rev === 'number' && Number.isInteger(data.rev) ? data.rev : 0;
      const oldToken = isValidShareToken(data.shareToken)
        ? data.shareToken.trim()
        : this.meta.shareToken;
      let remoteState;
      try {
        remoteState = validateTrackerState(JSON.parse(data.stateJson));
      } catch (err) {
        if (isSchemaTooNewError(err)) {
          this.enterSchemaTooNewState(err);
        }
        throw err;
      }

      if ((this.meta.lastSyncedRev || 0) !== baseRev) {
        const sameAsRemote = areTrackerStatesEquivalent(
          effectiveState,
          remoteState,
        );
        if (
          (this.meta.dirty || this.localMutationSeq !== pushedSeq) &&
          !sameAsRemote
        ) {
          this.status = 'conflict';
          this.conflict = {
            reason: 'rev-mismatch',
            remoteState,
            remoteRev: baseRev,
            remoteShareToken: oldToken,
          };
          this.emit();
          throw new Error(
            'Cloud grades were updated on another device. Please resolve the sync conflict first.',
          );
        }
        if (!sameAsRemote) {
          effectiveState = this.applyRemoteStateLocally(remoteState);
        } else {
          this.lastSyncedStateSnapshot = remoteState;
        }
      }

      const stateJson = JSON.stringify(effectiveState);
      if (stateJson.length >= MAX_STATE_JSON_CHARS) {
        throw new Error('Tracker data exceeds the 300 KB cloud document limit.');
      }

      let shouldDeleteOldShare = false;
      if (oldToken) {
        const oldShareSnap = await fb.getDoc(fb.doc('shares', oldToken));
        if (!this.isSessionCurrent(uid, startEpoch)) return;
        shouldDeleteOldShare =
          oldShareSnap.exists() && oldShareSnap.data()?.ownerUid === uid;
      }

      const nextRev = baseRev + 1;
      const batch = fb.writeBatch();
      batch.set(userRef, {
        stateJson,
        updatedAt: fb.serverTimestamp(),
        rev: nextRev,
        shareToken: null,
      });
      if (shouldDeleteOldShare) {
        batch.delete(fb.doc('shares', oldToken));
      }

      await batch.commit();
      if (!this.isSessionCurrent(uid, startEpoch)) return;

      const hasNewerLocalEdits = this.localMutationSeq !== pushedSeq;
      this.lastSyncedStateSnapshot = effectiveState;
      this.saveMeta({
        lastSyncedUid: uid,
        lastSyncedRev: nextRev,
        shareToken: null,
        lastSyncedAt: new Date().toISOString(),
        dirty: hasNewerLocalEdits,
      });
      this.status = hasNewerLocalEdits
        ? isBrowserOffline()
          ? 'offline'
          : 'pending'
        : 'synced';
      this.error = null;
      this.emit();
      if (hasNewerLocalEdits) {
        this.scheduleFollowUpFlushIfNeeded();
      }
    };

    this.inFlightPromise = run();
    try {
      await this.inFlightPromise;
    } finally {
      this.inFlightPromise = null;
      if (
        this.queuedFlushAfterFlight &&
        this.isSessionCurrent(uid, startEpoch) &&
        this.status !== 'conflict' &&
        !this.isSchemaBlocked()
      ) {
        this.queuedFlushAfterFlight = false;
        const nextSeq = this.localMutationSeq;
        const latest = this.latestLocalState || this.storageSvc.load();
        await this.pushStateToCloud(latest, { pushedSeq: nextSeq });
      } else {
        this.queuedFlushAfterFlight = false;
      }
    }
  }

  /**
   * Permanently deletes the user's cloud documents (`shares/{shareToken}` + `users/{uid}`),
   * signs out, and wipes local browser storage (`E7`).
   */
  async deleteCloudData() {
    await Promise.resolve();
    if (!this.currentUser) return false;
    this.cancelDebounce();
    if (this.reconcilePromise) {
      await this.reconcilePromise.catch(() => {});
    }
    while (this.inFlightPromise) {
      await this.inFlightPromise.catch(() => {});
    }
    if (!this.currentUser) return false;

    const uid = this.currentUser.uid;
    const startEpoch = this.authEpoch;

    const run = async () => {
      if (!this.isSessionCurrent(uid, startEpoch)) return false;
      const fb = await this.getFirebase();
      const userRef = fb.doc('users', uid);
      const userSnap = await fb.getDoc(userRef);
      if (!this.isSessionCurrent(uid, startEpoch)) return false;

      const batch = fb.writeBatch();
      let hasDeletes = false;

      if (userSnap.exists()) {
        const data = userSnap.data() || {};
        const token = isValidShareToken(data.shareToken)
          ? data.shareToken.trim()
          : this.meta.shareToken;
        if (token) {
          const shareSnap = await fb.getDoc(fb.doc('shares', token));
          if (!this.isSessionCurrent(uid, startEpoch)) return false;
          if (shareSnap.exists() && shareSnap.data()?.ownerUid === uid) {
            batch.delete(fb.doc('shares', token));
          }
        }
        batch.delete(userRef);
        hasDeletes = true;
      }

      if (hasDeletes) {
        await batch.commit();
        if (!this.isSessionCurrent(uid, startEpoch)) return false;
      }
      return true;
    };

    this.inFlightPromise = run();
    let shouldSignOut;
    try {
      shouldSignOut = await this.inFlightPromise;
    } catch (err) {
      throw new Error(
        formatFriendlyError(err) || 'Could not delete cloud data.',
        { cause: err },
      );
    } finally {
      this.inFlightPromise = null;
    }

    if (shouldSignOut && this.isSessionCurrent(uid, startEpoch)) {
      await this.signOutUser({ forceDiscard: true });
      return true;
    }
    return false;
  }
}

export const cloudSyncManager = new CloudSyncManager();
