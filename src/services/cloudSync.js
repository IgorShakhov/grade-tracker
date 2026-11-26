import { STORAGE_KEY } from '../domain/constants.js';
import { createInitialState } from '../domain/templates.js';
import {
  storageService,
  validateTrackerState,
  createMemoryStorage,
} from './storage.js';
import { getFirebaseServices } from './firebase.js';

export const SYNC_META_KEY = 'grade_tracker_sync_meta_v1';
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

  let hash = '';
  let search = '';

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
export async function fetchSharedView(shareToken, firebaseFactory = getFirebaseServices) {
  if (!isValidShareToken(shareToken)) {
    throw new Error('Invalid share link token.');
  }
  const fb = firebaseFactory();
  const snap = await fb.getDoc(fb.doc('shares', shareToken.trim()));
  if (!snap.exists()) {
    return { exists: false, state: null };
  }
  const data = snap.data() || {};
  if (typeof data.stateJson !== 'string') {
    throw new Error('Shared tracker data is malformed.');
  }
  const parsed = JSON.parse(data.stateJson);
  const validated = validateTrackerState(parsed);
  return {
    exists: true,
    state: validated,
  };
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
    this.firebaseFactory = options.firebaseFactory || getFirebaseServices;
    this.storage = resolveLocalMetaStorage(options.storage);
    this.storageSvc = options.storageSvc || storageService;
    this.debounceMs =
      typeof options.debounceMs === 'number' ? options.debounceMs : DEFAULT_DEBOUNCE_MS;

    this.meta = this.loadMeta();
    this.status = 'disconnected';
    this.currentUser = null;
    this.error = null;
    this.conflict = null;
    this.listeners = new Set();

    this.debounceTimer = null;
    this.latestLocalState = null;
    this.inFlightPromise = null;
    this.queuedFlushAfterFlight = false;
    this.usesBrowserLocalStorage =
      !options.storage ||
      (typeof globalThis !== 'undefined' &&
        options.storage === globalThis.localStorage);
    this.boundStorageListener = null;
    this.authUnsubscribe = null;
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

  /**
   * Connects CloudSyncManager to `StorageService` and starts listening to Firebase Auth state.
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
      try {
        const fb = this.firebaseFactory();
        this.authUnsubscribe = fb.onAuthStateChanged(
          (fbUser) => {
            this.handleAuthStateChanged(fbUser).catch((err) => {
              const msg = formatFriendlyError(err);
              this.status = isBrowserOffline() ? 'offline' : 'error';
              this.error = msg;
              this.emit();
            });
          },
          (err) => {
            this.status = 'error';
            this.error = formatFriendlyError(err);
            this.emit();
          },
        );
      } catch (err) {
        if (err?.code === 'firebase/not-configured') {
          this.status = 'disconnected';
          this.error = null;
        } else {
          this.status = 'error';
          this.error = formatFriendlyError(err);
        }
        this.emit();
      }
    }

    return () => this.stop();
  }

  stop() {
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
      const reloaded = this.storageSvc.load();
      this.latestLocalState = reloaded;
      this.storageSvc.notify(reloaded);
      this.emit();
      return;
    }

    if (event.key === SYNC_META_KEY) {
      this.meta = this.loadMeta();
      if (!this.meta.dirty && this.status === 'pending') {
        this.cancelDebounce();
        if (this.currentUser) {
          this.status = 'synced';
        }
      }
      this.emit();
      return;
    }

    if (event.key === trackerKey) {
      const reloaded = this.storageSvc.load();
      this.latestLocalState = reloaded;
      this.storageSvc.notify(reloaded);
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
    this.storageSvc.saveLocalOnly(validated);
    this.storageSvc.notify(validated);
    return validated;
  }

  resetLocalTrackerClean() {
    try {
      this.storage.removeItem(STORAGE_KEY);
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
      this.authEpoch += 1;
      this.reconcilingUid = null;
      this.reconcilePromise = null;
      this.queuedFlushAfterFlight = false;
      this.cancelDebounce();
      this.currentUser = null;
      this.conflict = null;
      this.error = null;
      this.status = 'disconnected';
      if (wasSignedIn) {
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
   * cross-account localStorage bleed (`E2`) and stale overwrites (`R4`).
   */
  async reconcileOnSignIn(uid, expectedEpoch = this.authEpoch) {
    this.status = 'syncing';
    this.conflict = null;
    this.error = null;
    this.emit();

    const fb = this.firebaseFactory();
    const userRef = fb.doc('users', uid);
    const snap = await fb.getDoc(userRef);

    if (expectedEpoch !== this.authEpoch || this.currentUser?.uid !== uid) {
      return;
    }

    const localState = this.latestLocalState || this.storageSvc.load();
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
        this.status = 'synced';
        this.emit();
        return;
      }

      // Case B: Never synced on this browser before (`lastSyncedUid === null`)
      if (!lastSyncedUid) {
        const hasCustomLocalData = !areTrackerStatesEquivalent(
          localState,
          createInitialState(),
        );
        const differsFromRemote = !areTrackerStatesEquivalent(localState, remoteState);

        if (hasCustomLocalData && differsFromRemote) {
          this.status = 'conflict';
          this.conflict = {
            reason: 'initial-merge',
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
        this.status = 'synced';
        this.emit();
        return;
      }

      // Case C: Returning same user (`lastSyncedUid === uid`)
      if (dirty) {
        if (lastSyncedRev === remoteRev) {
          this.saveMeta({
            lastSyncedUid: uid,
            lastSyncedRev: remoteRev,
            shareToken: remoteShareToken,
          });
          await this.pushStateToCloud(localState);
          return;
        }
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

      this.saveMeta({
        lastSyncedUid: uid,
        lastSyncedRev: remoteRev,
        shareToken: remoteShareToken,
        lastSyncedAt: new Date().toISOString(),
        dirty: false,
      });
      this.applyRemoteStateLocally(remoteState);
      this.status = 'synced';
      this.emit();
      return;
    }

    // Cloud document `users/{uid}` does NOT exist yet!
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

    // First-time cloud setup for this user -> create `users/{uid}` at `rev: 1`
    this.saveMeta({
      lastSyncedUid: uid,
      lastSyncedRev: 0,
      shareToken: null,
    });
    await this.pushStateToCloud(localState);
  }

  async signInWithGoogle() {
    this.error = null;
    this.emit();
    try {
      const fb = this.firebaseFactory();
      const cred = await fb.signInWithGooglePopup();
      if (cred?.user) {
        await this.handleAuthStateChanged(cred.user);
      }
      return this.getSnapshot();
    } catch (err) {
      const msg = formatFriendlyError(err);
      if (msg) {
        this.status = this.currentUser ? this.status : 'disconnected';
        this.error = msg;
        this.emit();
        throw new Error(msg);
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
    if (!forceDiscard && this.currentUser) {
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
        (this.meta.dirty ||
          this.status === 'conflict' ||
          this.hasUnreconciledCustomLocalCourses())
      ) {
        return { signedOut: false, requiresDiscardConfirm: true };
      }
    }

    this.authEpoch += 1;
    this.reconcilingUid = null;
    this.reconcilePromise = null;
    this.queuedFlushAfterFlight = false;
    this.cancelDebounce();

    if (this.inFlightPromise) {
      await this.inFlightPromise.catch(() => {});
    }

    const fb = this.firebaseFactory();
    try {
      await fb.signOutAuth();
    } finally {
      this.authEpoch += 1;
      this.currentUser = null;
      this.conflict = null;
      this.error = null;
      this.status = 'disconnected';
      this.clearMeta();
      this.resetLocalTrackerClean();
      this.emit();
    }
    return { signedOut: true, requiresDiscardConfirm: false };
  }

  async flushPendingSave() {
    await Promise.resolve();
    if (this.reconcilePromise) {
      await this.reconcilePromise.catch(() => {});
    }
    if (!this.currentUser || this.status === 'conflict') {
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
    { allowMissingRecreateRetry = true, pushedSeq = this.localMutationSeq } = {},
  ) {
    if (!this.currentUser) return;

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
      if (!this.isSessionCurrent(uid, startEpoch)) return;
      this.status = 'syncing';
      this.error = null;
      this.emit();

      const validated = validateTrackerState(rawState);
      const stateJson = JSON.stringify(validated);
      if (stateJson.length >= MAX_STATE_JSON_CHARS) {
        throw new Error(
          'Tracker data exceeds the 300 KB cloud document limit. Remove unused terms or courses.',
        );
      }

      const fb = this.firebaseFactory();
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

      try {
        await batch.commit();
        if (!this.isSessionCurrent(uid, startEpoch)) return;
        const hasNewerLocalEdits = this.localMutationSeq !== pushedSeq;
        this.saveMeta({
          lastSyncedUid: uid,
          lastSyncedRev: nextRev,
          shareToken: activeShareToken,
          lastSyncedAt: new Date().toISOString(),
          dirty: hasNewerLocalEdits,
        });
        this.conflict = null;
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
        if (err?.code === 'permission-denied') {
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
            const remoteState = validateTrackerState(JSON.parse(data.stateJson));
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
          if (allowMissingRecreateRetry && (this.meta.lastSyncedRev || 0) > 0) {
            this.saveMeta({ lastSyncedRev: 0, shareToken: null });
            this.inFlightPromise = null;
            await this.pushStateToCloud(validated, {
              allowMissingRecreateRetry: false,
              pushedSeq,
            });
            return;
          }
        }

        if (isBrowserOffline() || err?.code === 'unavailable') {
          this.status = 'offline';
          this.error = null;
          this.emit();
          return;
        }

        this.status = 'error';
        this.error = formatFriendlyError(err);
        this.emit();
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
        this.status !== 'conflict'
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
    if (currentLocalState && !this.latestLocalState) {
      this.latestLocalState = currentLocalState;
    }

    if (this.reconcilePromise) {
      await this.reconcilePromise.catch(() => {});
    }
    if (this.inFlightPromise) {
      await this.inFlightPromise.catch(() => {});
    }
    if (!this.currentUser || this.status === 'conflict') {
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
      const fb = this.firebaseFactory();
      const snap = await fb.getDoc(fb.doc('users', uid));
      if (!this.isSessionCurrent(uid, startEpoch)) {
        return this.getSnapshot();
      }
      const localState = this.latestLocalState || this.storageSvc.load();

      if (!snap.exists()) {
        this.saveMeta({
          lastSyncedUid: uid,
          lastSyncedRev: 0,
          shareToken: null,
        });
        await this.pushStateToCloud(localState, { allowMissingRecreateRetry: false });
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

      const revChanged = remoteRev !== this.meta.lastSyncedRev;
      this.saveMeta({
        lastSyncedUid: uid,
        lastSyncedRev: remoteRev,
        shareToken: remoteShareToken,
        lastSyncedAt: new Date().toISOString(),
        dirty: false,
      });
      if (revChanged) {
        this.applyRemoteStateLocally(remoteState);
      }
      this.conflict = null;
      this.status = 'synced';
      this.emit();
      return this.getSnapshot();
    } catch (err) {
      if (!this.isSessionCurrent(uid, startEpoch)) {
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
    if (!this.currentUser || !this.conflict) return;
    const uid = this.currentUser.uid;
    const activeConflict = this.conflict;

    if (strategy === 'use-remote') {
      this.conflict = null;
      if (activeConflict.remoteState) {
        this.saveMeta({
          lastSyncedUid: uid,
          lastSyncedRev: activeConflict.remoteRev,
          shareToken: activeConflict.remoteShareToken,
          lastSyncedAt: new Date().toISOString(),
          dirty: false,
        });
        this.applyRemoteStateLocally(activeConflict.remoteState);
        this.status = 'synced';
        this.error = null;
        this.emit();
      } else {
        // New account on shared computer chose to discard previous user's local courses & start fresh
        const fresh = this.resetLocalTrackerClean();
        this.saveMeta({
          lastSyncedUid: uid,
          lastSyncedRev: 0,
          shareToken: null,
          dirty: false,
        });
        await this.pushStateToCloud(fresh);
      }
      return;
    }

    if (strategy === 'keep-local') {
      const chosenLocal =
        currentLocalState || this.latestLocalState || this.storageSvc.load();
      this.conflict = null;
      this.saveMeta({
        lastSyncedUid: uid,
        lastSyncedRev: activeConflict.remoteRev || 0,
        shareToken: activeConflict.remoteShareToken || null,
        dirty: true,
      });
      await this.pushStateToCloud(chosenLocal);
    }
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

    const uid = this.currentUser.uid;
    const startEpoch = this.authEpoch;
    let createdToken = null;

    const run = async () => {
      const pushedSeq = this.localMutationSeq;
      let effectiveState = validateTrackerState(
        this.latestLocalState || currentLocalState || this.storageSvc.load(),
      );

      const fb = this.firebaseFactory();
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
        const remoteState = validateTrackerState(JSON.parse(data.stateJson));

        if ((this.meta.lastSyncedRev || 0) !== baseRev) {
          if (this.meta.dirty || this.localMutationSeq !== pushedSeq) {
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
          effectiveState = this.applyRemoteStateLocally(remoteState);
        }
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
        this.status !== 'conflict'
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

    const uid = this.currentUser.uid;
    const startEpoch = this.authEpoch;

    const run = async () => {
      const pushedSeq = this.localMutationSeq;
      let effectiveState = validateTrackerState(
        this.latestLocalState || currentLocalState || this.storageSvc.load(),
      );

      const fb = this.firebaseFactory();
      const userRef = fb.doc('users', uid);
      const userSnap = await fb.getDoc(userRef);
      if (!this.isSessionCurrent(uid, startEpoch)) return;
      if (!userSnap.exists()) {
        this.saveMeta({ shareToken: null });
        this.emit();
        return;
      }

      const data = userSnap.data() || {};
      const baseRev = typeof data.rev === 'number' && Number.isInteger(data.rev) ? data.rev : 0;
      const oldToken = isValidShareToken(data.shareToken)
        ? data.shareToken.trim()
        : this.meta.shareToken;
      const remoteState = validateTrackerState(JSON.parse(data.stateJson));

      if ((this.meta.lastSyncedRev || 0) !== baseRev) {
        if (this.meta.dirty || this.localMutationSeq !== pushedSeq) {
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
        effectiveState = this.applyRemoteStateLocally(remoteState);
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
        this.status !== 'conflict'
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
    if (!this.currentUser) return;
    this.cancelDebounce();
    if (this.reconcilePromise) {
      await this.reconcilePromise.catch(() => {});
    }
    if (this.inFlightPromise) {
      await this.inFlightPromise.catch(() => {});
    }
    if (!this.currentUser) return;

    const uid = this.currentUser.uid;
    const fb = this.firebaseFactory();
    const userRef = fb.doc('users', uid);
    const userSnap = await fb.getDoc(userRef);

    const batch = fb.writeBatch();
    let hasDeletes = false;

    if (userSnap.exists()) {
      const data = userSnap.data() || {};
      const token = isValidShareToken(data.shareToken)
        ? data.shareToken.trim()
        : this.meta.shareToken;
      if (token) {
        const shareSnap = await fb.getDoc(fb.doc('shares', token));
        if (shareSnap.exists() && shareSnap.data()?.ownerUid === uid) {
          batch.delete(fb.doc('shares', token));
          hasDeletes = true;
        }
      }
      batch.delete(userRef);
      hasDeletes = true;
    }

    if (hasDeletes) {
      await batch.commit();
    }

    await this.signOutUser({ forceDiscard: true });
  }
}

export const cloudSyncManager = new CloudSyncManager();
