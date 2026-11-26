import { storageService, validateTrackerState } from './storage.js';

export const SYNC_CONFIG_STORAGE_KEY = 'grade_tracker_cloud_sync_v1';
export const DEFAULT_SYNC_BRANCH = 'grade-data';

const GITHUB_API_BASE = 'https://api.github.com';
const BASE64_CHUNK_SIZE = 0x8000;

function createDefaultSyncConfig() {
  return {
    enabled: false,
    repo: '',
    branch: DEFAULT_SYNC_BRANCH,
    profileId: '',
    token: '',
    lastSyncedSha: null,
    lastSyncedAt: null,
    pendingSync: false,
  };
}

function normalizeSyncConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createDefaultSyncConfig();
  }

  return {
    enabled: Boolean(raw.enabled),
    repo: typeof raw.repo === 'string' ? raw.repo.trim() : '',
    branch:
      typeof raw.branch === 'string' && raw.branch.trim() !== ''
        ? raw.branch.trim()
        : DEFAULT_SYNC_BRANCH,
    profileId: typeof raw.profileId === 'string' ? raw.profileId.trim() : '',
    token: typeof raw.token === 'string' ? raw.token.trim() : '',
    lastSyncedSha:
      typeof raw.lastSyncedSha === 'string' && raw.lastSyncedSha.trim() !== ''
        ? raw.lastSyncedSha.trim()
        : null,
    lastSyncedAt:
      typeof raw.lastSyncedAt === 'string' && raw.lastSyncedAt.trim() !== ''
        ? raw.lastSyncedAt.trim()
        : null,
    pendingSync: Boolean(raw.pendingSync),
  };
}

function resolveConfigStorage(storage) {
  if (
    storage &&
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function'
  ) {
    return storage;
  }

  try {
    const candidate = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
    if (
      candidate &&
      typeof candidate.getItem === 'function' &&
      typeof candidate.setItem === 'function'
    ) {
      return candidate;
    }
  } catch {
    // Ignore restricted localStorage access errors
  }

  return null;
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const slice = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    chunks.push(String.fromCharCode.apply(null, slice));
  }
  return btoa(chunks.join(''));
}

function base64ToUtf8(base64) {
  const clean = String(base64 || '').replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function readErrorMessage(res) {
  try {
    const data = await res.json();
    if (data && typeof data.message === 'string' && data.message.trim() !== '') {
      return data.message.trim();
    }
  } catch {
    // Ignore non-JSON error body
  }
  return res.statusText || 'Request failed';
}

function isNetworkError(err) {
  if (!err) return false;
  if (err instanceof TypeError || err.name === 'TypeError') {
    return true;
  }
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function parseLocationLike(locationLike) {
  if (!locationLike) return null;

  if (typeof locationLike === 'string') {
    try {
      return new URL(locationLike, 'http://localhost/');
    } catch {
      return null;
    }
  }

  if (typeof locationLike === 'object') {
    if (typeof locationLike.href === 'string' && locationLike.href.trim() !== '') {
      try {
        return new URL(locationLike.href, 'http://localhost/');
      } catch {
        // Fall through to reading individual properties
      }
    }
    return {
      hostname: typeof locationLike.hostname === 'string' ? locationLike.hostname : '',
      pathname: typeof locationLike.pathname === 'string' ? locationLike.pathname : '',
      search: typeof locationLike.search === 'string' ? locationLike.search : '',
      hash: typeof locationLike.hash === 'string' ? locationLike.hash : '',
    };
  }

  return null;
}

function readParamsFromBody(body) {
  if (!body || typeof body !== 'string') return null;
  const queryBody = body.includes('?') ? body.slice(body.indexOf('?') + 1) : body;
  if (!queryBody) return null;
  return new URLSearchParams(queryBody);
}

export function generateProfileId() {
  const bytes = new Uint8Array(5);
  if (typeof globalThis !== 'undefined' && typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isValidProfileId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{2,63}$/i.test(id.trim());
}

export function isValidRepoSlug(repo) {
  return typeof repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.trim());
}

export function inferRepoFromLocation(locationLike) {
  const target =
    arguments.length === 0
      ? typeof window !== 'undefined'
        ? window.location
        : null
      : locationLike;

  const parsed = parseLocationLike(target);
  const hostname = typeof parsed?.hostname === 'string' ? parsed.hostname.trim() : '';
  if (!hostname || !hostname.toLowerCase().endsWith('.github.io')) {
    return '';
  }

  const owner = hostname.slice(0, -'.github.io'.length);
  const pathname = typeof parsed?.pathname === 'string' ? parsed.pathname : '';
  const repo = pathname.split('/').filter(Boolean)[0] || '';

  if (!owner || !repo || owner === '.' || owner === '..' || repo === '.' || repo === '..') {
    return '';
  }

  const candidate = `${owner}/${repo}`;
  return isValidRepoSlug(candidate) ? candidate : '';
}

export function extractLiveProfileParams(locationLike) {
  const target =
    arguments.length === 0
      ? typeof window !== 'undefined'
        ? window.location
        : null
      : locationLike;

  const parsed = parseLocationLike(target);
  if (!parsed) return null;

  const searchStr = typeof parsed.search === 'string' ? parsed.search : '';
  const hashStr = typeof parsed.hash === 'string' ? parsed.hash : '';

  const searchParams = readParamsFromBody(
    searchStr.startsWith('?') ? searchStr.slice(1) : searchStr,
  );
  const hashParams = readParamsFromBody(hashStr.startsWith('#') ? hashStr.slice(1) : hashStr);

  const rawProfile = searchParams?.get('profile') ?? hashParams?.get('profile') ?? '';
  if (!isValidProfileId(rawProfile)) {
    return null;
  }

  const rawRepo = searchParams?.get('repo') ?? hashParams?.get('repo') ?? '';
  const rawBranch = searchParams?.get('branch') ?? hashParams?.get('branch') ?? '';

  return {
    profileId: rawProfile.trim(),
    repo: (rawRepo || '').trim() || inferRepoFromLocation(parsed),
    branch: (rawBranch || '').trim() || DEFAULT_SYNC_BRANCH,
  };
}

export function buildLiveProfileUrl(currentHref, { profileId, repo = '', branch = DEFAULT_SYNC_BRANCH }) {
  if (!isValidProfileId(profileId)) {
    throw new Error('Invalid profile ID.');
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

  url.searchParams.delete('share');
  url.searchParams.delete('profile');
  url.searchParams.delete('repo');
  url.searchParams.delete('branch');

  if (url.hash) {
    const hashBody = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const hashParams = new URLSearchParams(hashBody);
    if (hashParams.has('share')) {
      hashParams.delete('share');
      const remaining = hashParams.toString();
      url.hash = remaining ? `#${remaining}` : '';
    }
  }

  url.searchParams.set('profile', profileId.trim());

  const trimmedRepo = typeof repo === 'string' ? repo.trim() : '';
  const inferredRepo = inferRepoFromLocation(url);
  if (
    trimmedRepo &&
    (!inferredRepo || trimmedRepo.toLowerCase() !== inferredRepo.toLowerCase())
  ) {
    url.searchParams.set('repo', trimmedRepo);
  }

  const trimmedBranch = typeof branch === 'string' ? branch.trim() : '';
  if (trimmedBranch && trimmedBranch !== DEFAULT_SYNC_BRANCH) {
    url.searchParams.set('branch', trimmedBranch);
  }

  return url.toString();
}

export function clearLiveProfileParamsFromUrl(win) {
  const targetWin =
    arguments.length === 0
      ? typeof window !== 'undefined'
        ? window
        : null
      : win;

  if (!targetWin?.location?.href || typeof targetWin.history?.replaceState !== 'function') {
    return;
  }

  try {
    const url = new URL(targetWin.location.href);
    url.searchParams.delete('profile');
    url.searchParams.delete('repo');
    url.searchParams.delete('branch');

    const searchStr = url.searchParams.toString();
    const nextRelativeUrl = `${url.pathname}${searchStr ? `?${searchStr}` : ''}${url.hash}`;
    targetWin.history.replaceState(targetWin.history.state ?? null, '', nextRelativeUrl);
  } catch {
    // Ignore malformed location URLs
  }
}

export function loadSyncConfig(storage) {
  const resolved = resolveConfigStorage(storage);
  if (!resolved) {
    return createDefaultSyncConfig();
  }

  try {
    const raw = resolved.getItem(SYNC_CONFIG_STORAGE_KEY);
    if (!raw) {
      return createDefaultSyncConfig();
    }
    const parsed = JSON.parse(raw);
    return normalizeSyncConfig(parsed);
  } catch {
    return createDefaultSyncConfig();
  }
}

export function saveSyncConfig(config, storage) {
  const normalized = normalizeSyncConfig(config);
  const resolved = resolveConfigStorage(storage);
  if (resolved) {
    try {
      resolved.setItem(SYNC_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore storage quota or security errors
    }
  }
  return normalized;
}

export function clearSyncConfig(storage) {
  const resolved = resolveConfigStorage(storage);
  if (resolved && typeof resolved.removeItem === 'function') {
    try {
      resolved.removeItem(SYNC_CONFIG_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
  return createDefaultSyncConfig();
}

function assertValidRemoteTarget(repo, profileId) {
  if (!isValidRepoSlug(repo)) {
    throw new Error('Invalid GitHub repository slug. Expected "owner/repo".');
  }
  const [owner, repoName] = repo.trim().split('/');
  if (owner === '.' || owner === '..' || repoName === '.' || repoName === '..') {
    throw new Error('Invalid GitHub repository slug. Expected "owner/repo".');
  }
  if (!isValidProfileId(profileId)) {
    throw new Error('Invalid profile ID.');
  }
  return {
    owner,
    repoName,
    safeProfileId: profileId.trim(),
  };
}

export async function fetchRemoteProfile({
  repo,
  branch = DEFAULT_SYNC_BRANCH,
  profileId,
  token = '',
  fetchImpl = globalThis.fetch,
}) {
  const { owner, repoName, safeProfileId } = assertValidRemoteTarget(repo, profileId);
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch implementation is unavailable.');
  }

  const safeBranch =
    typeof branch === 'string' && branch.trim() !== '' ? branch.trim() : DEFAULT_SYNC_BRANCH;
  const safeToken = typeof token === 'string' ? token.trim() : '';

  const url = `${GITHUB_API_BASE}/repos/${owner}/${repoName}/contents/data/${encodeURIComponent(
    safeProfileId,
  )}.json?ref=${encodeURIComponent(safeBranch)}`;

  const headers = {
    Accept: 'application/vnd.github+json',
    ...(safeToken ? { Authorization: `Bearer ${safeToken}` } : {}),
  };

  const res = await fetchImpl(url, {
    method: 'GET',
    cache: 'no-store',
    headers,
  });

  if (res.status === 404) {
    return { exists: false, state: null, sha: null };
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(`GitHub API error (${res.status}): ${message}`);
  }

  const json = await res.json();
  if (!json || typeof json.content !== 'string') {
    throw new Error('GitHub API error: missing file content in response.');
  }

  const decodedText = base64ToUtf8(json.content);
  const parsed = JSON.parse(decodedText);
  const validated = validateTrackerState(parsed);

  return {
    exists: true,
    state: validated,
    sha: typeof json.sha === 'string' ? json.sha : null,
  };
}

export async function pushRemoteProfile({
  repo,
  branch = DEFAULT_SYNC_BRANCH,
  profileId,
  token,
  state,
  expectedSha = null,
  force = false,
  fetchImpl = globalThis.fetch,
}) {
  const { owner, repoName, safeProfileId } = assertValidRemoteTarget(repo, profileId);
  const safeToken = typeof token === 'string' ? token.trim() : '';
  if (!safeToken) {
    throw new Error('GitHub personal access token is required to push profile state.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch implementation is unavailable.');
  }

  const safeBranch =
    typeof branch === 'string' && branch.trim() !== '' ? branch.trim() : DEFAULT_SYNC_BRANCH;
  const validatedState = validateTrackerState(state);

  const authHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${safeToken}`,
  };

  async function ensureBranchExists() {
    const repoRes = await fetchImpl(`${GITHUB_API_BASE}/repos/${owner}/${repoName}`, {
      method: 'GET',
      cache: 'no-store',
      headers: authHeaders,
    });
    if (!repoRes.ok) {
      const message = await readErrorMessage(repoRes);
      throw new Error(`GitHub API error (${repoRes.status}): ${message}`);
    }
    const repoJson = await repoRes.json();
    const defaultBranch = repoJson?.default_branch;
    if (typeof defaultBranch !== 'string' || defaultBranch.trim() === '') {
      throw new Error('GitHub API error: repository has no default_branch.');
    }

    const refRes = await fetchImpl(
      `${GITHUB_API_BASE}/repos/${owner}/${repoName}/git/ref/heads/${encodeURIComponent(
        defaultBranch,
      )}`,
      {
        method: 'GET',
        cache: 'no-store',
        headers: authHeaders,
      },
    );
    if (!refRes.ok) {
      const message = await readErrorMessage(refRes);
      throw new Error(`GitHub API error (${refRes.status}): ${message}`);
    }
    const refJson = await refRes.json();
    const baseSha = refJson?.object?.sha;
    if (typeof baseSha !== 'string' || baseSha.trim() === '') {
      throw new Error('GitHub API error: default branch head SHA is unavailable.');
    }

    const createRes = await fetchImpl(`${GITHUB_API_BASE}/repos/${owner}/${repoName}/git/refs`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: `refs/heads/${safeBranch}`,
        sha: baseSha,
      }),
    });
    if (!createRes.ok && createRes.status !== 422) {
      const message = await readErrorMessage(createRes);
      throw new Error(`GitHub API error (${createRes.status}): ${message}`);
    }
  }

  let shaToUse = typeof expectedSha === 'string' && expectedSha.trim() !== '' ? expectedSha.trim() : null;
  if (!shaToUse) {
    const remote = await fetchRemoteProfile({
      repo,
      branch: safeBranch,
      profileId: safeProfileId,
      token: safeToken,
      fetchImpl,
    });
    if (remote.exists) {
      if (!force) {
        return {
          status: 'conflict',
          remoteState: remote.state,
          remoteSha: remote.sha,
        };
      }
      shaToUse = remote.sha;
    }
  }

  const putUrl = `${GITHUB_API_BASE}/repos/${owner}/${repoName}/contents/data/${encodeURIComponent(
    safeProfileId,
  )}.json`;
  const contentBase64 = utf8ToBase64(`${JSON.stringify(validatedState, null, 2)}\n`);

  const sendPut = () =>
    fetchImpl(putUrl, {
      method: 'PUT',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `sync(${safeProfileId}): update tracker state`,
        content: contentBase64,
        branch: safeBranch,
        ...(shaToUse ? { sha: shaToUse } : {}),
      }),
    });

  let res = await sendPut();
  if (res.status === 404) {
    await ensureBranchExists();
    res = await sendPut();
  }

  if (res.status === 409 || res.status === 422) {
    const remote = await fetchRemoteProfile({
      repo,
      branch: safeBranch,
      profileId: safeProfileId,
      token: safeToken,
      fetchImpl,
    });
    return {
      status: 'conflict',
      remoteState: remote.state,
      remoteSha: remote.sha,
    };
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(`GitHub API error (${res.status}): ${message}`);
  }

  const respJson = await res.json();
  return {
    status: 'ok',
    sha: respJson?.content?.sha || null,
    syncedAt: new Date().toISOString(),
  };
}

export class GitHubSyncManager {
  constructor({
    storageServiceInstance = storageService,
    configStorage = null,
    fetchImpl = null,
    debounceMs = 1200,
  } = {}) {
    this.storageService = storageServiceInstance;
    this.configStorage = configStorage;
    this.fetchImpl = fetchImpl;
    this.debounceMs =
      typeof debounceMs === 'number' && Number.isFinite(debounceMs) && debounceMs >= 0
        ? debounceMs
        : 1200;

    this.debounceTimer = null;
    this._pendingScheduleResolve = null;
    this.remoteStateCallback = null;
    this.suppressNextSave = false;
    this.listeners = new Set();

    const initialConfig = loadSyncConfig(this.configStorage);
    const initialStatus =
      initialConfig.enabled && initialConfig.token
        ? initialConfig.pendingSync
          ? 'pending'
          : 'synced'
        : 'disconnected';

    this.snapshot = {
      status: initialStatus,
      error: null,
      config: initialConfig,
      conflictRemoteState: null,
      conflictRemoteSha: null,
    };

    if (this.storageService && typeof this.storageService.registerCloudAdapter === 'function') {
      this.storageService.registerCloudAdapter({
        save: (st) => this.scheduleSave(st),
        subscribe: (cb) => {
          this.remoteStateCallback = cb;
          return () => {
            if (this.remoteStateCallback === cb) {
              this.remoteStateCallback = null;
            }
          };
        },
      });
    }
  }

  _getFetchImpl() {
    return this.fetchImpl || globalThis.fetch;
  }

  _setSnapshot(patch) {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      config: patch.config ? { ...patch.config } : { ...this.snapshot.config },
    };
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        // Isolate subscriber errors
      }
    }
  }

  _clearDebounceTimer() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this._pendingScheduleResolve) {
      this._pendingScheduleResolve();
      this._pendingScheduleResolve = null;
    }
  }

  _invokeRemoteStateCallback(state) {
    if (typeof this.remoteStateCallback !== 'function') {
      return;
    }
    this.suppressNextSave = true;
    try {
      this.remoteStateCallback(state);
    } finally {
      this.suppressNextSave = false;
    }
  }

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  scheduleSave(state) {
    const { config } = this.snapshot;
    if (!config.enabled || !config.token || this.suppressNextSave) {
      return Promise.resolve();
    }

    this._clearDebounceTimer();

    const nextConfig = saveSyncConfig({ ...config, pendingSync: true }, this.configStorage);
    this._setSnapshot({
      status: 'pending',
      error: null,
      config: nextConfig,
    });

    return new Promise((resolve) => {
      this._pendingScheduleResolve = resolve;
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        const done = this._pendingScheduleResolve;
        this._pendingScheduleResolve = null;
        this.pushLocalState(state).finally(() => {
          if (done) done();
        });
      }, this.debounceMs);
    });
  }

  async pushLocalState(state) {
    const { config } = this.snapshot;
    if (!config.enabled || !config.token) {
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const nextConfig = saveSyncConfig({ ...config, pendingSync: true }, this.configStorage);
      this._setSnapshot({
        status: 'offline',
        error: null,
        config: nextConfig,
      });
      return;
    }

    this._setSnapshot({
      status: 'syncing',
      error: null,
    });

    try {
      const result = await pushRemoteProfile({
        repo: config.repo,
        branch: config.branch,
        profileId: config.profileId,
        token: config.token,
        state,
        expectedSha: config.lastSyncedSha,
        fetchImpl: this._getFetchImpl(),
      });

      if (!this.snapshot.config.enabled) {
        return;
      }

      if (result.status === 'ok') {
        const nextConfig = saveSyncConfig(
          {
            ...this.snapshot.config,
            lastSyncedSha: result.sha,
            lastSyncedAt: result.syncedAt,
            pendingSync: false,
          },
          this.configStorage,
        );
        this._setSnapshot({
          status: 'synced',
          error: null,
          config: nextConfig,
          conflictRemoteState: null,
          conflictRemoteSha: null,
        });
      } else if (result.status === 'conflict') {
        this._setSnapshot({
          status: 'conflict',
          error: null,
          conflictRemoteState: result.remoteState,
          conflictRemoteSha: result.remoteSha,
        });
      }
    } catch (err) {
      if (!this.snapshot.config.enabled) {
        return;
      }
      const nextConfig = saveSyncConfig(
        { ...this.snapshot.config, pendingSync: true },
        this.configStorage,
      );
      if (isNetworkError(err)) {
        this._setSnapshot({
          status: 'offline',
          error: err.message,
          config: nextConfig,
        });
      } else {
        this._setSnapshot({
          status: 'error',
          error: err?.message || 'Sync failed',
          config: nextConfig,
        });
      }
    }
  }

  async connect({ repo, branch = DEFAULT_SYNC_BRANCH, profileId, token }, currentLocalState) {
    this._clearDebounceTimer();

    const trimmedRepo = typeof repo === 'string' ? repo.trim() : '';
    const trimmedBranch =
      typeof branch === 'string' && branch.trim() !== '' ? branch.trim() : DEFAULT_SYNC_BRANCH;
    const trimmedProfileId = typeof profileId === 'string' ? profileId.trim() : '';
    const trimmedToken = typeof token === 'string' ? token.trim() : '';

    this._setSnapshot({
      status: 'syncing',
      error: null,
      conflictRemoteState: null,
      conflictRemoteSha: null,
    });

    try {
      if (!trimmedToken) {
        throw new Error('GitHub personal access token is required to connect.');
      }

      const remote = await fetchRemoteProfile({
        repo: trimmedRepo,
        branch: trimmedBranch,
        profileId: trimmedProfileId,
        token: trimmedToken,
        fetchImpl: this._getFetchImpl(),
      });

      if (remote.exists) {
        const nextConfig = saveSyncConfig(
          {
            enabled: true,
            repo: trimmedRepo,
            branch: trimmedBranch,
            profileId: trimmedProfileId,
            token: trimmedToken,
            lastSyncedSha: remote.sha,
            lastSyncedAt: new Date().toISOString(),
            pendingSync: false,
          },
          this.configStorage,
        );

        this._invokeRemoteStateCallback(remote.state);
        this._setSnapshot({
          status: 'synced',
          error: null,
          config: nextConfig,
          conflictRemoteState: null,
          conflictRemoteSha: null,
        });

        return { mode: 'pulled', state: remote.state };
      }

      const pushRes = await pushRemoteProfile({
        repo: trimmedRepo,
        branch: trimmedBranch,
        profileId: trimmedProfileId,
        token: trimmedToken,
        state: currentLocalState,
        force: true,
        fetchImpl: this._getFetchImpl(),
      });

      const nextConfig = saveSyncConfig(
        {
          enabled: true,
          repo: trimmedRepo,
          branch: trimmedBranch,
          profileId: trimmedProfileId,
          token: trimmedToken,
          lastSyncedSha: pushRes.sha,
          lastSyncedAt: pushRes.syncedAt,
          pendingSync: false,
        },
        this.configStorage,
      );

      this._setSnapshot({
        status: 'synced',
        error: null,
        config: nextConfig,
        conflictRemoteState: null,
        conflictRemoteSha: null,
      });

      return { mode: 'created', state: currentLocalState };
    } catch (err) {
      this._setSnapshot({
        status: isNetworkError(err) ? 'offline' : 'error',
        error: err?.message || 'Failed to connect',
      });
      throw err;
    }
  }

  disconnect() {
    this._clearDebounceTimer();
    const cleared = clearSyncConfig(this.configStorage);
    this._setSnapshot({
      status: 'disconnected',
      error: null,
      config: cleared,
      conflictRemoteState: null,
      conflictRemoteSha: null,
    });
  }

  async syncNow(currentLocalState) {
    const { config } = this.snapshot;
    if (!config.enabled || !config.token) {
      return;
    }
    this._clearDebounceTimer();
    if (config.pendingSync) {
      return this.pushLocalState(currentLocalState);
    }
    return this.pullLatest();
  }

  async pullLatest() {
    const { config } = this.snapshot;
    if (!config.enabled || !config.token) {
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this._setSnapshot({
        status: 'offline',
        error: null,
      });
      return;
    }

    this._setSnapshot({
      status: 'syncing',
      error: null,
    });

    try {
      const remote = await fetchRemoteProfile({
        repo: config.repo,
        branch: config.branch,
        profileId: config.profileId,
        token: config.token,
        fetchImpl: this._getFetchImpl(),
      });

      if (!this.snapshot.config.enabled) {
        return;
      }

      if (remote.exists && remote.sha && remote.sha !== this.snapshot.config.lastSyncedSha) {
        if (this.snapshot.config.pendingSync) {
          this._setSnapshot({
            status: 'conflict',
            error: null,
            conflictRemoteState: remote.state,
            conflictRemoteSha: remote.sha,
          });
        } else {
          const nextConfig = saveSyncConfig(
            {
              ...this.snapshot.config,
              lastSyncedSha: remote.sha,
              lastSyncedAt: new Date().toISOString(),
            },
            this.configStorage,
          );
          this._invokeRemoteStateCallback(remote.state);
          this._setSnapshot({
            status: 'synced',
            error: null,
            config: nextConfig,
            conflictRemoteState: null,
            conflictRemoteSha: null,
          });
        }
      } else {
        this._setSnapshot({
          status: 'synced',
          error: null,
        });
      }
    } catch (err) {
      if (!this.snapshot.config.enabled) {
        return;
      }
      if (isNetworkError(err)) {
        this._setSnapshot({
          status: 'offline',
          error: err.message,
        });
      } else {
        this._setSnapshot({
          status: 'error',
          error: err?.message || 'Pull failed',
        });
      }
    }
  }

  async resolveConflict(choice, currentLocalState) {
    const { config, conflictRemoteState, conflictRemoteSha } = this.snapshot;
    if (!config.enabled || !config.token) {
      return;
    }

    if (choice === 'keep-local') {
      this._setSnapshot({
        status: 'syncing',
        error: null,
      });

      try {
        const result = await pushRemoteProfile({
          repo: config.repo,
          branch: config.branch,
          profileId: config.profileId,
          token: config.token,
          state: currentLocalState,
          expectedSha: conflictRemoteSha,
          force: true,
          fetchImpl: this._getFetchImpl(),
        });

        if (result.status === 'ok') {
          const nextConfig = saveSyncConfig(
            {
              ...this.snapshot.config,
              lastSyncedSha: result.sha,
              lastSyncedAt: result.syncedAt,
              pendingSync: false,
            },
            this.configStorage,
          );
          this._setSnapshot({
            status: 'synced',
            error: null,
            config: nextConfig,
            conflictRemoteState: null,
            conflictRemoteSha: null,
          });
        } else if (result.status === 'conflict') {
          this._setSnapshot({
            status: 'conflict',
            error: null,
            conflictRemoteState: result.remoteState,
            conflictRemoteSha: result.remoteSha,
          });
        }
      } catch (err) {
        if (isNetworkError(err)) {
          this._setSnapshot({
            status: 'offline',
            error: err.message,
          });
        } else {
          this._setSnapshot({
            status: 'error',
            error: err?.message || 'Conflict resolution failed',
          });
        }
      }
      return;
    }

    if (choice === 'use-remote') {
      if (!conflictRemoteState) {
        return;
      }
      const nextConfig = saveSyncConfig(
        {
          ...config,
          lastSyncedSha: conflictRemoteSha,
          lastSyncedAt: new Date().toISOString(),
          pendingSync: false,
        },
        this.configStorage,
      );

      this._invokeRemoteStateCallback(conflictRemoteState);
      this._setSnapshot({
        status: 'synced',
        error: null,
        config: nextConfig,
        conflictRemoteState: null,
        conflictRemoteSha: null,
      });
      return;
    }

    throw new Error(`Unsupported conflict resolution choice: ${String(choice)}`);
  }
}

export const githubSyncManager = new GitHubSyncManager();
