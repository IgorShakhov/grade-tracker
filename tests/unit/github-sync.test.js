import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialState } from '../../src/domain/templates.js';
import { StorageService, createMemoryStorage } from '../../src/services/storage.js';
import {
  SYNC_CONFIG_STORAGE_KEY,
  DEFAULT_SYNC_BRANCH,
  generateProfileId,
  isValidProfileId,
  isValidRepoSlug,
  inferRepoFromLocation,
  extractLiveProfileParams,
  buildLiveProfileUrl,
  clearLiveProfileParamsFromUrl,
  loadSyncConfig,
  saveSyncConfig,
  clearSyncConfig,
  fetchRemoteProfile,
  pushRemoteProfile,
  GitHubSyncManager,
} from '../../src/services/githubSync.js';

function encodeUtf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeUtf8Base64(b64) {
  const binary = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function jsonResponse(body, status = 200, statusText = 'OK') {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GitHub Cloud Sync Service (githubSync.js)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (typeof navigator !== 'undefined') {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true,
      });
    }
  });

  describe('Pure ID, repo, and URL helpers', () => {
    it('generateProfileId returns a 10-char lowercase hex string and uses Math.random fallback', () => {
      const id1 = generateProfileId();
      const id2 = generateProfileId();
      expect(id1).toMatch(/^[0-9a-f]{10}$/);
      expect(id2).toMatch(/^[0-9a-f]{10}$/);
      expect(isValidProfileId(id1)).toBe(true);

      const origCrypto = globalThis.crypto;
      try {
        Object.defineProperty(globalThis, 'crypto', {
          configurable: true,
          value: undefined,
        });
        const fallbackId = generateProfileId();
        expect(fallbackId).toMatch(/^[0-9a-f]{10}$/);
      } finally {
        Object.defineProperty(globalThis, 'crypto', {
          configurable: true,
          value: origCrypto,
        });
      }
    });

    it('isValidProfileId accepts valid profile IDs and rejects path traversal or invalid inputs', () => {
      expect(isValidProfileId('abc')).toBe(true);
      expect(isValidProfileId('a1b2c3d4e5')).toBe(true);
      expect(isValidProfileId('my_profile-2026')).toBe(true);
      expect(isValidProfileId('  user-1  ')).toBe(true);

      expect(isValidProfileId('../etc')).toBe(false);
      expect(isValidProfileId('../../secret')).toBe(false);
      expect(isValidProfileId('a/b')).toBe(false);
      expect(isValidProfileId('ab')).toBe(false);
      expect(isValidProfileId('-starts-with-dash')).toBe(false);
      expect(isValidProfileId('_starts-with-underscore')).toBe(false);
      expect(isValidProfileId('a'.repeat(65))).toBe(false);
      expect(isValidProfileId('')).toBe(false);
      expect(isValidProfileId(null)).toBe(false);
      expect(isValidProfileId(12345)).toBe(false);
    });

    it('isValidRepoSlug validates owner/repo slugs', () => {
      expect(isValidRepoSlug('exampleuser/grade-tracker')).toBe(true);
      expect(isValidRepoSlug('org.name/repo_1.2')).toBe(true);
      expect(isValidRepoSlug('noslash')).toBe(false);
      expect(isValidRepoSlug('a/b/c')).toBe(false);
      expect(isValidRepoSlug('bad owner/repo')).toBe(false);
      expect(isValidRepoSlug(null)).toBe(false);
    });

    it('inferRepoFromLocation extracts owner/repo from github.io URLs', () => {
      expect(inferRepoFromLocation('https://exampleuser.github.io/grade-tracker/')).toBe(
        'exampleuser/grade-tracker',
      );
      expect(
        inferRepoFromLocation({
          hostname: 'ExampleUser.GITHUB.IO',
          pathname: '/grade-tracker/index.html',
        }),
      ).toBe('ExampleUser/grade-tracker');
      expect(inferRepoFromLocation('https://exampleuser.github.io/')).toBe('');
      expect(inferRepoFromLocation('https://localhost:5173/grade-tracker/')).toBe('');
      expect(inferRepoFromLocation(null)).toBe('');
    });

    it('extractLiveProfileParams parses search and hash params and infers repo', () => {
      expect(
        extractLiveProfileParams('https://exampleuser.github.io/grade-tracker/?profile=abc123def0'),
      ).toEqual({
        profileId: 'abc123def0',
        repo: 'exampleuser/grade-tracker',
        branch: DEFAULT_SYNC_BRANCH,
      });

      expect(
        extractLiveProfileParams(
          'https://example.com/app/?profile=study-1&repo=custom-owner/custom-repo&branch=sync-alt',
        ),
      ).toEqual({
        profileId: 'study-1',
        repo: 'custom-owner/custom-repo',
        branch: 'sync-alt',
      });

      expect(
        extractLiveProfileParams(
          'https://exampleuser.github.io/grade-tracker/#/view?profile=hash-prof&branch=dev-data',
        ),
      ).toEqual({
        profileId: 'hash-prof',
        repo: 'exampleuser/grade-tracker',
        branch: 'dev-data',
      });

      expect(extractLiveProfileParams('https://exampleuser.github.io/grade-tracker/?profile=../etc')).toBeNull();
      expect(extractLiveProfileParams('https://exampleuser.github.io/grade-tracker/')).toBeNull();
    });

    it('buildLiveProfileUrl strips share params and omits default repo/branch when redundant', () => {
      const sameOrigin = buildLiveProfileUrl(
        'https://exampleuser.github.io/grade-tracker/?share=oldtoken#share=oldhash',
        {
          profileId: 'abc123def0',
          repo: 'ExampleUser/grade-tracker',
          branch: DEFAULT_SYNC_BRANCH,
        },
      );
      expect(sameOrigin).toBe('https://exampleuser.github.io/grade-tracker/?profile=abc123def0');

      const customRepoAndBranch = buildLiveProfileUrl('https://localhost:5173/app/?share=tok', {
        profileId: 'user-profile',
        repo: 'exampleuser/grade-tracker',
        branch: 'custom-branch',
      });
      expect(customRepoAndBranch).toBe(
        'https://localhost:5173/app/?profile=user-profile&repo=exampleuser%2Fgrade-tracker&branch=custom-branch',
      );
    });

    it('clearLiveProfileParamsFromUrl removes profile, repo, and branch via history.replaceState', () => {
      const replaceState = vi.fn();
      const fakeWin = {
        location: {
          href: 'https://exampleuser.github.io/grade-tracker/?profile=abc123&repo=a/b&branch=x&keep=1#section',
        },
        history: {
          state: { page: 1 },
          replaceState,
        },
      };

      clearLiveProfileParamsFromUrl(fakeWin);
      expect(replaceState).toHaveBeenCalledTimes(1);
      expect(replaceState).toHaveBeenCalledWith(
        { page: 1 },
        '',
        '/grade-tracker/?keep=1#section',
      );
    });
  });

  describe('Local sync config persistence', () => {
    it('loads defaults on missing or corrupt storage and saves/clears cleanly', () => {
      const mem = createMemoryStorage();

      expect(loadSyncConfig(mem)).toEqual({
        enabled: false,
        repo: '',
        branch: DEFAULT_SYNC_BRANCH,
        profileId: '',
        token: '',
        lastSyncedSha: null,
        lastSyncedAt: null,
        pendingSync: false,
      });

      mem.setItem(SYNC_CONFIG_STORAGE_KEY, '{corrupt json');
      expect(loadSyncConfig(mem).enabled).toBe(false);

      const saved = saveSyncConfig(
        {
          enabled: true,
          repo: ' exampleuser/grade-tracker ',
          branch: '',
          profileId: ' prof123 ',
          token: ' ghp_secret ',
          lastSyncedSha: 'sha-1',
          lastSyncedAt: '2026-11-25T10:00:00.000Z',
          pendingSync: true,
        },
        mem,
      );
      expect(saved).toEqual({
        enabled: true,
        repo: 'exampleuser/grade-tracker',
        branch: DEFAULT_SYNC_BRANCH,
        profileId: 'prof123',
        token: 'ghp_secret',
        lastSyncedSha: 'sha-1',
        lastSyncedAt: '2026-11-25T10:00:00.000Z',
        pendingSync: true,
      });

      expect(loadSyncConfig(mem)).toEqual(saved);

      clearSyncConfig(mem);
      expect(mem.getItem(SYNC_CONFIG_STORAGE_KEY)).toBeNull();
      expect(loadSyncConfig(mem).enabled).toBe(false);
    });
  });

  describe('GitHub REST Contents API functions', () => {
    it('fetchRemoteProfile decodes UTF-8 base64 with newlines and validates tracker state', async () => {
      const state = createInitialState();
      state.studentName = 'Alex — Ångström 📚';
      state.terms[0].name = 'Fall Term — Résumé';

      const rawBase64 = encodeUtf8Base64(JSON.stringify(state, null, 2));
      const chunkedWithNewlines = rawBase64.match(/.{1,32}/g).join('\n') + '\n';

      const mockFetch = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          sha: 'blob-sha-200',
          content: chunkedWithNewlines,
        }),
      );

      const res = await fetchRemoteProfile({
        repo: 'exampleuser/grade-tracker',
        profileId: 'prof123',
        token: 'ghp_tok123',
        fetchImpl: mockFetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe(
        'https://api.github.com/repos/exampleuser/grade-tracker/contents/data/prof123.json?ref=grade-data',
      );
      expect(calledInit.cache).toBe('no-store');
      expect(calledInit.headers).toEqual({
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ghp_tok123',
      });

      expect(res.exists).toBe(true);
      expect(res.sha).toBe('blob-sha-200');
      expect(res.state.studentName).toBe('Alex — Ångström 📚');
      expect(res.state.terms[0].name).toBe('Fall Term — Résumé');
    });

    it('fetchRemoteProfile returns { exists: false } on 404 and throws descriptive error on 401', async () => {
      const mockFetch404 = vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404));
      const missing = await fetchRemoteProfile({
        repo: 'exampleuser/grade-tracker',
        profileId: 'prof123',
        fetchImpl: mockFetch404,
      });
      expect(missing).toEqual({ exists: false, state: null, sha: null });

      const mockFetch401 = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ message: 'Bad credentials' }, 401, 'Unauthorized'));
      await expect(
        fetchRemoteProfile({
          repo: 'exampleuser/grade-tracker',
          profileId: 'prof123',
          token: 'bad-token',
          fetchImpl: mockFetch401,
        }),
      ).rejects.toThrow('GitHub API error (401): Bad credentials');
    });

    it('fetchRemoteProfile validates repo slug and profile ID before calling fetch', async () => {
      const mockFetch = vi.fn();
      await expect(
        fetchRemoteProfile({
          repo: 'invalid-slug',
          profileId: 'prof123',
          fetchImpl: mockFetch,
        }),
      ).rejects.toThrow(/repository slug/i);
      await expect(
        fetchRemoteProfile({
          repo: 'exampleuser/grade-tracker',
          profileId: '../etc',
          fetchImpl: mockFetch,
        }),
      ).rejects.toThrow(/profile ID/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('pushRemoteProfile handles initial creation without expectedSha', async () => {
      const state = createInitialState();
      state.studentName = 'Sam — Café';

      const mockFetch = vi
        .fn()
        // Initial check: GET file -> 404 (file doesn't exist yet)
        .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404))
        // PUT file -> 201 Created
        .mockResolvedValueOnce(jsonResponse({ content: { sha: 'new-sha-1' } }, 201));

      const res = await pushRemoteProfile({
        repo: 'exampleuser/grade-tracker',
        profileId: 'prof-create',
        token: 'ghp_tok',
        state,
        fetchImpl: mockFetch,
      });

      expect(res.status).toBe('ok');
      expect(res.sha).toBe('new-sha-1');
      expect(typeof res.syncedAt).toBe('string');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [putUrl, putInit] = mockFetch.mock.calls[1];
      expect(putUrl).toBe(
        'https://api.github.com/repos/exampleuser/grade-tracker/contents/data/prof-create.json',
      );
      expect(putInit.method).toBe('PUT');
      const putBody = JSON.parse(putInit.body);
      expect(putBody.branch).toBe('grade-data');
      expect(putBody.sha).toBeUndefined();
      expect(putBody.message).toBe('sync(prof-create): update tracker state');
      expect(JSON.parse(decodeUtf8Base64(putBody.content)).studentName).toBe('Sam — Café');
    });

    it('pushRemoteProfile sends sha on update and auto-creates missing branch on PUT 404', async () => {
      const state = createInitialState();

      const mockFetch = vi
        .fn()
        // PUT with expectedSha -> 404 because branch grade-data does not exist
        .mockResolvedValueOnce(jsonResponse({ message: 'Branch not found' }, 404))
        // ensureBranchExists: GET repo -> default_branch: main
        .mockResolvedValueOnce(jsonResponse({ default_branch: 'main' }, 200))
        // ensureBranchExists: GET ref heads/main -> baseSha
        .mockResolvedValueOnce(jsonResponse({ object: { sha: 'main-head-sha' } }, 200))
        // ensureBranchExists: POST git/refs -> 201
        .mockResolvedValueOnce(jsonResponse({ ref: 'refs/heads/grade-data' }, 201))
        // Retry PUT -> 200 OK
        .mockResolvedValueOnce(jsonResponse({ content: { sha: 'updated-sha-2' } }, 200));

      const res = await pushRemoteProfile({
        repo: 'exampleuser/grade-tracker',
        profileId: 'prof-update',
        token: 'ghp_tok',
        state,
        expectedSha: 'prev-sha-1',
        fetchImpl: mockFetch,
      });

      expect(res.status).toBe('ok');
      expect(res.sha).toBe('updated-sha-2');
      expect(mockFetch).toHaveBeenCalledTimes(5);

      const [createRefUrl, createRefInit] = mockFetch.mock.calls[3];
      expect(createRefUrl).toBe(
        'https://api.github.com/repos/exampleuser/grade-tracker/git/refs',
      );
      expect(JSON.parse(createRefInit.body)).toEqual({
        ref: 'refs/heads/grade-data',
        sha: 'main-head-sha',
      });

      const retryPutBody = JSON.parse(mockFetch.mock.calls[4][1].body);
      expect(retryPutBody.sha).toBe('prev-sha-1');
    });

    it('pushRemoteProfile detects 409 conflicts and pre-existing remote state when !force', async () => {
      const localState = createInitialState();
      localState.studentName = 'Local Student';
      const remoteState = createInitialState();
      remoteState.studentName = 'Remote Student';

      // Case 1: 409 conflict during PUT with stale expectedSha
      const mockFetch409 = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ message: 'Conflict' }, 409))
        .mockResolvedValueOnce(
          jsonResponse({
            sha: 'remote-sha-99',
            content: encodeUtf8Base64(JSON.stringify(remoteState)),
          }),
        );

      const conflictRes = await pushRemoteProfile({
        repo: 'exampleuser/grade-tracker',
        profileId: 'prof-conflict',
        token: 'ghp_tok',
        state: localState,
        expectedSha: 'stale-sha',
        fetchImpl: mockFetch409,
      });

      expect(conflictRes.status).toBe('conflict');
      expect(conflictRes.remoteSha).toBe('remote-sha-99');
      expect(conflictRes.remoteState.studentName).toBe('Remote Student');

      // Case 2: No expectedSha provided, remote already exists and force = false
      const mockFetchExisting = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          sha: 'existing-sha-10',
          content: encodeUtf8Base64(JSON.stringify(remoteState)),
        }),
      );

      const existingConflict = await pushRemoteProfile({
        repo: 'exampleuser/grade-tracker',
        profileId: 'prof-conflict',
        token: 'ghp_tok',
        state: localState,
        force: false,
        fetchImpl: mockFetchExisting,
      });

      expect(existingConflict.status).toBe('conflict');
      expect(existingConflict.remoteSha).toBe('existing-sha-10');
      expect(mockFetchExisting).toHaveBeenCalledTimes(1);
    });
  });

  describe('GitHubSyncManager & StorageService integration', () => {
    it('connect pulls existing remote profile and updates StorageService without feedback loop', async () => {
      const storageMem = createMemoryStorage();
      const configMem = createMemoryStorage();
      const svc = new StorageService({ storage: storageMem });

      const localState = createInitialState();
      localState.studentName = 'Local';
      svc.save(localState, { touchTimestamp: false });

      const remoteState = createInitialState();
      remoteState.studentName = 'Remote Pulled';

      const mockFetch = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          sha: 'remote-sha-1',
          content: encodeUtf8Base64(JSON.stringify(remoteState)),
        }),
      );

      const manager = new GitHubSyncManager({
        storageServiceInstance: svc,
        configStorage: configMem,
        fetchImpl: mockFetch,
        debounceMs: 50,
      });

      const uiListener = vi.fn();
      svc.subscribe(uiListener);
      const statusListener = vi.fn();
      manager.subscribe(statusListener);

      const result = await manager.connect(
        {
          repo: 'exampleuser/grade-tracker',
          profileId: 'prof-pull',
          token: 'ghp_abc',
        },
        localState,
      );

      expect(result.mode).toBe('pulled');
      expect(result.state.studentName).toBe('Remote Pulled');
      expect(svc.load().studentName).toBe('Remote Pulled');
      expect(uiListener).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const snap = manager.getSnapshot();
      expect(snap.status).toBe('synced');
      expect(snap.config.enabled).toBe(true);
      expect(snap.config.lastSyncedSha).toBe('remote-sha-1');
      expect(snap.config.pendingSync).toBe(false);
      expect(statusListener).toHaveBeenCalled();
    });

    it('connect creates new remote profile when remote returns 404', async () => {
      const svc = new StorageService({ storage: createMemoryStorage() });
      const configMem = createMemoryStorage();
      const localState = createInitialState();
      localState.studentName = 'New Cloud Profile';

      const mockFetch = vi
        .fn()
        // connect -> fetchRemoteProfile -> 404
        .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404))
        // pushRemoteProfile (force: true, expectedSha: null) -> fetchRemoteProfile -> 404
        .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404))
        // PUT -> 201 Created
        .mockResolvedValueOnce(jsonResponse({ content: { sha: 'created-sha-1' } }, 201));

      const manager = new GitHubSyncManager({
        storageServiceInstance: svc,
        configStorage: configMem,
        fetchImpl: mockFetch,
      });

      const result = await manager.connect(
        {
          repo: 'exampleuser/grade-tracker',
          profileId: 'prof-new',
          token: 'ghp_abc',
        },
        localState,
      );

      expect(result.mode).toBe('created');
      expect(result.state.studentName).toBe('New Cloud Profile');
      expect(manager.getSnapshot().status).toBe('synced');
      expect(manager.getSnapshot().config.lastSyncedSha).toBe('created-sha-1');
    });

    it('debounces auto-save triggered via StorageService.save()', async () => {
      vi.useFakeTimers();

      const svc = new StorageService({ storage: createMemoryStorage() });
      const configMem = createMemoryStorage();
      saveSyncConfig(
        {
          enabled: true,
          repo: 'exampleuser/grade-tracker',
          branch: DEFAULT_SYNC_BRANCH,
          profileId: 'prof-auto',
          token: 'ghp_abc',
          lastSyncedSha: 'sha-1',
          lastSyncedAt: '2026-11-25T10:00:00.000Z',
          pendingSync: false,
        },
        configMem,
      );

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ content: { sha: 'sha-2' } }, 200));

      const manager = new GitHubSyncManager({
        storageServiceInstance: svc,
        configStorage: configMem,
        fetchImpl: mockFetch,
        debounceMs: 300,
      });

      const state1 = createInitialState();
      state1.studentName = 'Edit 1';
      const state2 = createInitialState();
      state2.studentName = 'Edit 2';

      svc.save(state1);
      await Promise.resolve();
      expect(manager.getSnapshot().status).toBe('pending');
      expect(manager.getSnapshot().config.pendingSync).toBe(true);

      svc.save(state2);
      await Promise.resolve();
      expect(mockFetch).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(350);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const putBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(putBody.sha).toBe('sha-1');
      expect(JSON.parse(decodeUtf8Base64(putBody.content)).studentName).toBe('Edit 2');

      expect(manager.getSnapshot().status).toBe('synced');
      expect(manager.getSnapshot().config.lastSyncedSha).toBe('sha-2');
      expect(manager.getSnapshot().config.pendingSync).toBe(false);
    });

    it('records offline pending status when navigator.onLine is false and pushes on syncNow', async () => {
      const svc = new StorageService({ storage: createMemoryStorage() });
      const configMem = createMemoryStorage();
      saveSyncConfig(
        {
          enabled: true,
          repo: 'exampleuser/grade-tracker',
          branch: DEFAULT_SYNC_BRANCH,
          profileId: 'prof-offline',
          token: 'ghp_abc',
          lastSyncedSha: 'sha-1',
          lastSyncedAt: '2026-11-25T10:00:00.000Z',
          pendingSync: false,
        },
        configMem,
      );

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ content: { sha: 'sha-online-2' } }, 200));

      const manager = new GitHubSyncManager({
        storageServiceInstance: svc,
        configStorage: configMem,
        fetchImpl: mockFetch,
        debounceMs: 10,
      });

      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: false,
      });

      const localState = createInitialState();
      localState.studentName = 'Offline Edit';

      await manager.scheduleSave(localState);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(manager.getSnapshot().status).toBe('offline');
      expect(manager.getSnapshot().config.pendingSync).toBe(true);

      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true,
      });

      await manager.syncNow(localState);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(manager.getSnapshot().status).toBe('synced');
      expect(manager.getSnapshot().config.pendingSync).toBe(false);
      expect(manager.getSnapshot().config.lastSyncedSha).toBe('sha-online-2');
    });

    it('resolves conflicts with both keep-local and use-remote', async () => {
      const svc = new StorageService({ storage: createMemoryStorage() });
      const configMem = createMemoryStorage();

      const localState = createInitialState();
      localState.studentName = 'Local Winner';
      const remoteState = createInitialState();
      remoteState.studentName = 'Remote Winner';

      saveSyncConfig(
        {
          enabled: true,
          repo: 'exampleuser/grade-tracker',
          branch: DEFAULT_SYNC_BRANCH,
          profileId: 'prof-res',
          token: 'ghp_abc',
          lastSyncedSha: 'sha-1',
          lastSyncedAt: '2026-11-25T10:00:00.000Z',
          pendingSync: false,
        },
        configMem,
      );

      const mockFetch = vi
        .fn()
        // 1. pushLocalState hits 409
        .mockResolvedValueOnce(jsonResponse({ message: 'Conflict' }, 409))
        // 2. fetchRemoteProfile retrieves remote copy
        .mockResolvedValueOnce(
          jsonResponse({
            sha: 'sha-remote-2',
            content: encodeUtf8Base64(JSON.stringify(remoteState)),
          }),
        )
        // 3. resolveConflict('keep-local') pushes with conflictRemoteSha
        .mockResolvedValueOnce(jsonResponse({ content: { sha: 'sha-local-3' } }, 200))
        // 4. Another push hits 409
        .mockResolvedValueOnce(jsonResponse({ message: 'Conflict' }, 409))
        // 5. fetchRemoteProfile retrieves newer remote copy
        .mockResolvedValueOnce(
          jsonResponse({
            sha: 'sha-remote-4',
            content: encodeUtf8Base64(JSON.stringify(remoteState)),
          }),
        );

      const manager = new GitHubSyncManager({
        storageServiceInstance: svc,
        configStorage: configMem,
        fetchImpl: mockFetch,
      });

      // Trigger conflict #1 and resolve with 'keep-local'
      await manager.pushLocalState(localState);
      expect(manager.getSnapshot().status).toBe('conflict');
      expect(manager.getSnapshot().conflictRemoteSha).toBe('sha-remote-2');
      expect(manager.getSnapshot().conflictRemoteState.studentName).toBe('Remote Winner');

      await manager.resolveConflict('keep-local', localState);
      expect(manager.getSnapshot().status).toBe('synced');
      expect(manager.getSnapshot().config.lastSyncedSha).toBe('sha-local-3');
      expect(manager.getSnapshot().config.pendingSync).toBe(false);
      expect(manager.getSnapshot().conflictRemoteState).toBeNull();

      const keepLocalPutBody = JSON.parse(mockFetch.mock.calls[2][1].body);
      expect(keepLocalPutBody.sha).toBe('sha-remote-2');
      expect(JSON.parse(decodeUtf8Base64(keepLocalPutBody.content)).studentName).toBe(
        'Local Winner',
      );

      // Trigger conflict #2 and resolve with 'use-remote'
      await manager.pushLocalState(localState);
      expect(manager.getSnapshot().status).toBe('conflict');
      expect(manager.getSnapshot().conflictRemoteSha).toBe('sha-remote-4');

      await manager.resolveConflict('use-remote', localState);
      expect(manager.getSnapshot().status).toBe('synced');
      expect(manager.getSnapshot().config.lastSyncedSha).toBe('sha-remote-4');
      expect(manager.getSnapshot().config.pendingSync).toBe(false);
      expect(manager.getSnapshot().conflictRemoteState).toBeNull();
      expect(svc.load().studentName).toBe('Remote Winner');
    });

    it('disconnect clears config, cancels pending timer, and resets snapshot', async () => {
      vi.useFakeTimers();
      const svc = new StorageService({ storage: createMemoryStorage() });
      const configMem = createMemoryStorage();
      saveSyncConfig(
        {
          enabled: true,
          repo: 'exampleuser/grade-tracker',
          profileId: 'prof-disc',
          token: 'ghp_abc',
        },
        configMem,
      );

      const mockFetch = vi.fn();
      const manager = new GitHubSyncManager({
        storageServiceInstance: svc,
        configStorage: configMem,
        fetchImpl: mockFetch,
        debounceMs: 500,
      });

      const pendingPromise = manager.scheduleSave(createInitialState());
      expect(manager.getSnapshot().status).toBe('pending');

      manager.disconnect();
      await pendingPromise;
      await vi.advanceTimersByTimeAsync(600);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(manager.getSnapshot().status).toBe('disconnected');
      expect(manager.getSnapshot().config.enabled).toBe(false);
      expect(configMem.getItem(SYNC_CONFIG_STORAGE_KEY)).toBeNull();
    });
  });
});
