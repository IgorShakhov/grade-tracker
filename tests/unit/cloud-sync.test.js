import { describe, it, expect } from 'vitest';
import { STORAGE_KEY } from '../../src/domain/constants.js';
import { createInitialState } from '../../src/domain/templates.js';
import { StorageService, createMemoryStorage } from '../../src/services/storage.js';
import {
  CloudSyncManager,
  SYNC_META_KEY,
  LEGACY_GITHUB_SYNC_KEY,
  generateShareToken,
  isValidShareToken,
  buildLiveShareUrl,
  extractLiveViewTokenFromUrl,
  clearLiveViewFromUrl,
  fetchSharedView,
} from '../../src/services/cloudSync.js';
import {
  resolveFirebaseConfig,
  isFirebaseConfigComplete,
} from '../../src/services/firebase.js';

const SERVER_TS_SENTINEL = Symbol('serverTimestamp');

/**
 * In-memory Firebase Auth + Firestore emulator that strictly enforces EVERY
 * constraint in `firestore.rules` (v2):
 *  - `users/{uid}`: owner-only get/delete, `rev == 1` on create, `rev == old.rev + 1` on update,
 *    `updatedAt == request.time`, `stateJson < 300000`, `hasAll` & `hasOnly`, valid optional `shareToken`.
 *  - `shares/{token}`: public `get` for valid 22..64 token, `getAfter` verifying
 *    `users/{uid}.shareToken == token`, `ownerUid == auth.uid`, non-null `resource` on `delete`.
 */
function createRulesEnforcingFirebaseMock() {
  const docs = new Map();
  let currentAuthUser = null;
  const authListeners = new Set();

  function permissionDenied(reason) {
    const err = new Error(`Firestore Rules Denied: ${reason}`);
    err.code = 'permission-denied';
    return err;
  }

  function validToken(t) {
    return typeof t === 'string' && /^[A-Za-z0-9_-]{22,64}$/.test(t);
  }

  function validState(d, commitTime) {
    return (
      typeof d.stateJson === 'string' &&
      d.stateJson.length < 300_000 &&
      d.updatedAt === commitTime
    );
  }

  function hasExactAllowedKeys(obj, requiredKeys, allowedKeys) {
    const keys = Object.keys(obj);
    return (
      requiredKeys.every((k) => keys.includes(k)) &&
      keys.every((k) => allowedKeys.includes(k))
    );
  }

  let popupUser = null;

  return {
    docs,
    setPopupUser(user) {
      popupUser = user;
    },
    emitAuth(user) {
      currentAuthUser = user;
      for (const cb of authListeners) {
        cb(user);
      }
    },
    seedDirect(path, data) {
      docs.set(path, structuredClone(data));
    },
    service: {
      onAuthStateChanged(cb) {
        authListeners.add(cb);
        const initialSnap = currentAuthUser;
        Promise.resolve().then(() => {
          if (authListeners.has(cb) && currentAuthUser === initialSnap) {
            cb(initialSnap);
          }
        });
        return () => authListeners.delete(cb);
      },
      async signInWithGooglePopup() {
        if (!popupUser) {
          const err = new Error('Popup closed');
          err.code = 'auth/popup-closed-by-user';
          throw err;
        }
        currentAuthUser = popupUser;
        for (const cb of authListeners) {
          cb(currentAuthUser);
        }
        return { user: currentAuthUser };
      },
      async signOutAuth() {
        currentAuthUser = null;
        for (const cb of authListeners) {
          cb(null);
        }
      },
      doc(...segments) {
        return { path: segments.join('/'), segments };
      },
      serverTimestamp() {
        return SERVER_TS_SENTINEL;
      },
      async getDoc(ref) {
        const [col, id] = ref.segments;
        if (col === 'users') {
          if (!currentAuthUser || currentAuthUser.uid !== id) {
            throw permissionDenied('users get requires owner auth');
          }
        } else if (col === 'shares') {
          if (!validToken(id)) {
            throw permissionDenied('shares get requires valid token');
          }
        } else {
          throw permissionDenied('unknown collection');
        }
        const stored = docs.get(ref.path);
        return {
          exists: () => Boolean(stored),
          data: () => (stored ? structuredClone(stored) : undefined),
        };
      },
      writeBatch() {
        const ops = [];
        return {
          set(ref, data) {
            ops.push({ type: 'set', ref, data });
          },
          delete(ref) {
            ops.push({ type: 'delete', ref });
          },
          async commit() {
            if (!currentAuthUser) {
              throw permissionDenied('batch write requires signedIn()');
            }
            const commitTime = `ts-${Date.now()}`;
            // Compute post-batch snapshot for `getAfter` evaluation
            const afterDocs = new Map(docs);
            const resolvedOps = ops.map((op) => {
              if (op.type === 'set') {
                const materialized = {};
                for (const [k, v] of Object.entries(op.data)) {
                  materialized[k] = v === SERVER_TS_SENTINEL ? commitTime : v;
                }
                afterDocs.set(op.ref.path, materialized);
                return { ...op, materialized };
              }
              afterDocs.delete(op.ref.path);
              return op;
            });

            // Validate EVERY operation against `firestore.rules`
            for (const op of resolvedOps) {
              const [col, id] = op.ref.segments;
              const existing = docs.get(op.ref.path) || null;

              if (col === 'users') {
                if (currentAuthUser.uid !== id) {
                  throw permissionDenied('users uid mismatch');
                }
                if (op.type === 'delete') {
                  const oldToken = existing?.shareToken ?? null;
                  if (oldToken !== null && afterDocs.has(`shares/${oldToken}`)) {
                    throw permissionDenied(
                      'users delete must also delete active shares/{oldToken}',
                    );
                  }
                  continue;
                }
                const d = op.materialized;
                if (
                  !hasExactAllowedKeys(
                    d,
                    ['stateJson', 'updatedAt', 'rev'],
                    ['stateJson', 'updatedAt', 'rev', 'shareToken'],
                  )
                ) {
                  throw permissionDenied('users keys violation');
                }
                if (!validState(d, commitTime)) {
                  throw permissionDenied('users validState violation');
                }
                if (!Number.isInteger(d.rev)) {
                  throw permissionDenied('users rev not int');
                }
                if (existing === null) {
                  if (d.rev !== 1) {
                    throw permissionDenied(`users create rev must be 1, got ${d.rev}`);
                  }
                } else if (d.rev !== existing.rev + 1) {
                  throw permissionDenied(
                    `users update rev must be ${existing.rev + 1}, got ${d.rev}`,
                  );
                }
                if (
                  'shareToken' in d &&
                  d.shareToken !== null &&
                  !validToken(d.shareToken)
                ) {
                  throw permissionDenied('users invalid shareToken');
                }
                const nextShareToken = d.shareToken ?? null;
                if (nextShareToken !== null) {
                  const targetShare = afterDocs.get(`shares/${nextShareToken}`);
                  if (!targetShare || targetShare.ownerUid !== id) {
                    throw permissionDenied(
                      'users shareToken must point to a shares/{token} owned by uid',
                    );
                  }
                }
                if (existing !== null) {
                  const prevShareToken = existing.shareToken ?? null;
                  if (
                    prevShareToken !== null &&
                    prevShareToken !== nextShareToken &&
                    afterDocs.has(`shares/${prevShareToken}`)
                  ) {
                    throw permissionDenied(
                      'users update changing/clearing shareToken must delete shares/{oldToken}',
                    );
                  }
                }
              } else if (col === 'shares') {
                if (op.type === 'delete') {
                  if (!existing || existing.ownerUid !== currentAuthUser.uid) {
                    throw permissionDenied(
                      'shares delete requires existing doc owned by caller',
                    );
                  }
                  continue;
                }
                if (!validToken(id)) {
                  throw permissionDenied('shares invalid token id');
                }
                if (existing && existing.ownerUid !== currentAuthUser.uid) {
                  throw permissionDenied('shares update owner mismatch');
                }
                const d = op.materialized;
                if (
                  !hasExactAllowedKeys(
                    d,
                    ['ownerUid', 'stateJson', 'updatedAt'],
                    ['ownerUid', 'stateJson', 'updatedAt'],
                  )
                ) {
                  throw permissionDenied('shares keys violation');
                }
                if (d.ownerUid !== currentAuthUser.uid) {
                  throw permissionDenied('shares ownerUid != auth.uid');
                }
                if (!validState(d, commitTime)) {
                  throw permissionDenied('shares validState violation');
                }
                const ownerAfter = afterDocs.get(`users/${currentAuthUser.uid}`);
                if (!ownerAfter || ownerAfter.shareToken !== id) {
                  throw permissionDenied(
                    'shares getAfter(users/{uid}).data.shareToken != token',
                  );
                }
              } else {
                throw permissionDenied('default deny');
              }
            }

            // Commit atomically
            docs.clear();
            for (const [k, v] of afterDocs.entries()) {
              docs.set(k, structuredClone(v));
            }
          },
        };
      },
    },
  };
}

describe('CloudSyncManager & Firestore Security Rules Invariants (cloudSync.js)', () => {
  it('generates 192-bit base64url tokens and builds/extracts `#view=<token>` URLs without query leakage', () => {
    const t1 = generateShareToken();
    const t2 = generateShareToken();
    expect(t1).toHaveLength(32);
    expect(t1).not.toBe(t2);
    expect(isValidShareToken(t1)).toBe(true);
    expect(isValidShareToken('short')).toBe(false);
    expect(isValidShareToken('bad/chars+in=token1234567890')).toBe(false);

    const url = buildLiveShareUrl(
      'https://example.github.io/grade-tracker/?old=1',
      t1,
    );
    expect(url).toBe(`https://example.github.io/grade-tracker/#view=${t1}`);
    expect(extractLiveViewTokenFromUrl(url)).toBe(t1);
    expect(
      extractLiveViewTokenFromUrl(`https://example.com/grade-tracker/?view=${t2}`),
    ).toBe(t2);

    const fakeWin = {
      location: { href: url },
      history: {
        state: null,
        replacedWith: null,
        replaceState(_s, _t, nextUrl) {
          this.replacedWith = nextUrl;
        },
      },
    };
    clearLiveViewFromUrl(fakeWin);
    expect(fakeWin.history.replacedWith).toBe('/grade-tracker/');
  });

  it('creates `users/{uid}` at rev=1 on first Google sign-in, stores zero PII, and cleans legacy GitHub sync keys', async () => {
    const fbMock = createRulesEnforcingFirebaseMock();
    const mem = createMemoryStorage();
    mem.setItem(LEGACY_GITHUB_SYNC_KEY, '{"token":"old_pat"}');
    const storageSvc = new StorageService({ storage: mem });

    const mgr = new CloudSyncManager({
      firebaseFactory: () => fbMock.service,
      storage: mem,
      storageSvc,
      debounceMs: 10,
    });
    expect(mem.getItem(LEGACY_GITHUB_SYNC_KEY)).toBeNull();
    mgr.start();

    fbMock.setPopupUser({
      uid: 'user-1',
      email: 'student@example.com',
      displayName: 'Student One',
    });
    const snap = await mgr.signInWithGoogle();
    expect(snap.status).toBe('synced');
    expect(snap.rev).toBe(1);
    expect(snap.user.email).toBe('student@example.com');

    // Verify Firestore document contains ZERO PII (no email, displayName, photoURL)
    const cloudDoc = fbMock.docs.get('users/user-1');
    expect(Object.keys(cloudDoc).sort()).toEqual([
      'rev',
      'shareToken',
      'stateJson',
      'updatedAt',
    ]);
    expect(cloudDoc.rev).toBe(1);
    expect(cloudDoc.shareToken).toBeNull();
    expect(JSON.stringify(cloudDoc)).not.toContain('student@example.com');

    // Verify localStorage metadata also contains ZERO PII
    expect(mem.getItem(SYNC_META_KEY)).not.toContain('student@example.com');
    mgr.stop();
  });

  it('debounces edits, increments `rev` atomically, and updates active `shares/{token}` in the same writeBatch', async () => {
    const fbMock = createRulesEnforcingFirebaseMock();
    const mem = createMemoryStorage();
    const storageSvc = new StorageService({ storage: mem });
    const mgr = new CloudSyncManager({
      firebaseFactory: () => fbMock.service,
      storage: mem,
      storageSvc,
      debounceMs: 15,
    });
    mgr.start();

    fbMock.setPopupUser({ uid: 'user-1', email: 's@example.com' });
    await mgr.signInWithGoogle();
    expect(fbMock.docs.get('users/user-1').rev).toBe(1);

    // Enable live share -> rev=2, creates shares/{token1}
    const token1 = await mgr.enableOrRotateShare(storageSvc.load());
    expect(fbMock.docs.get('users/user-1').rev).toBe(2);
    expect(fbMock.docs.get('users/user-1').shareToken).toBe(token1);
    expect(fbMock.docs.get(`shares/${token1}`)).toBeTruthy();

    // Public viewer (logged out!) can fetch `shares/{token1}`
    const publicFbMock = {
      ...fbMock.service,
      getDoc: (ref) => fbMock.service.getDoc(ref),
    };
    const viewed = await fetchSharedView(token1, () => publicFbMock);
    expect(viewed.exists).toBe(true);
    expect(viewed.state.studentName).toBe('My');

    // Save an edit through StorageService -> debounced batch updates BOTH user doc (rev=3) AND share doc
    const edited = storageSvc.load();
    edited.studentName = 'Updated Name';
    storageSvc.save(edited);

    await new Promise((r) => setTimeout(r, 40));
    expect(fbMock.docs.get('users/user-1').rev).toBe(3);
    expect(JSON.parse(fbMock.docs.get(`shares/${token1}`).stateJson).studentName).toBe(
      'Updated Name',
    );

    // Rotate share link -> rev=4, creates token2 AND deletes token1 atomically (zero orphans!)
    const token2 = await mgr.enableOrRotateShare(storageSvc.load());
    expect(token2).not.toBe(token1);
    expect(fbMock.docs.has(`shares/${token1}`)).toBe(false);
    expect(fbMock.docs.has(`shares/${token2}`)).toBe(true);
    expect(fbMock.docs.get('users/user-1').rev).toBe(4);

    // Disable share link -> rev=5, deletes token2 and sets shareToken=null
    await mgr.disableShare(storageSvc.load());
    expect(fbMock.docs.has(`shares/${token2}`)).toBe(false);
    expect(fbMock.docs.get('users/user-1').shareToken).toBeNull();
    expect(fbMock.docs.get('users/user-1').rev).toBe(5);

    mgr.stop();
  });

  it('detects stale `rev` write conflicts from another device and resolves via use-remote or keep-local (`R4`)', async () => {
    const fbMock = createRulesEnforcingFirebaseMock();
    const mem = createMemoryStorage();
    const storageSvc = new StorageService({ storage: mem });
    const mgr = new CloudSyncManager({
      firebaseFactory: () => fbMock.service,
      storage: mem,
      storageSvc,
      debounceMs: 10,
    });
    mgr.start();

    fbMock.setPopupUser({ uid: 'user-1', email: 's@example.com' });
    await mgr.signInWithGoogle();
    expect(mgr.getSnapshot().rev).toBe(1);

    // Simulate Device B saving rev=2 directly in Firestore
    const deviceBState = createInitialState();
    deviceBState.studentName = 'Device B Latest';
    fbMock.seedDirect('users/user-1', {
      stateJson: JSON.stringify(deviceBState),
      updatedAt: 'ts-remote',
      rev: 2,
      shareToken: null,
    });

    // Now Device A (still at rev=1) tries to save a local edit -> rules reject rev=2 (expected 3), triggering conflict!
    const deviceAState = storageSvc.load();
    deviceAState.studentName = 'Device A Stale Edit';
    storageSvc.save(deviceAState);
    await new Promise((r) => setTimeout(r, 35));

    const conflictSnap = mgr.getSnapshot();
    expect(conflictSnap.status).toBe('conflict');
    expect(conflictSnap.conflict.reason).toBe('rev-mismatch');
    expect(conflictSnap.conflict.remoteState.studentName).toBe('Device B Latest');

    // Resolve with `keep-local` -> writes at rev=3 cleanly!
    await mgr.resolveConflict('keep-local', storageSvc.load());
    expect(mgr.getSnapshot().status).toBe('synced');
    expect(mgr.getSnapshot().rev).toBe(3);
    expect(JSON.parse(fbMock.docs.get('users/user-1').stateJson).studentName).toBe(
      'Device A Stale Edit',
    );

    mgr.stop();
  });

  it('wipes localStorage on Sign Out and blocks cross-account localStorage bleed on shared computers (`E2` & `E7`)', async () => {
    const fbMock = createRulesEnforcingFirebaseMock();
    const mem = createMemoryStorage();
    const storageSvc = new StorageService({ storage: mem });
    const mgr = new CloudSyncManager({
      firebaseFactory: () => fbMock.service,
      storage: mem,
      storageSvc,
      debounceMs: 10,
    });
    mgr.start();

    // User A signs in and customizes their tracker
    fbMock.setPopupUser({ uid: 'user-A', email: 'a@example.com' });
    await mgr.signInWithGoogle();
    const userAState = storageSvc.load();
    userAState.studentName = 'User A Private';
    storageSvc.save(userAState);
    await new Promise((r) => setTimeout(r, 30));
    expect(storageSvc.load().studentName).toBe('User A Private');

    // Scenario 1: Suppose User B signs in WITHOUT User A having clicked Sign Out (leftover meta from user-A!)
    const dirtyState = storageSvc.load();
    dirtyState.studentName = 'Unsynced User A';
    storageSvc.saveLocalOnly(dirtyState);
    mgr.saveMeta({ lastSyncedUid: 'user-A', dirty: true });

    fbMock.setPopupUser({ uid: 'user-B', email: 'b@example.com' });
    await mgr.signInWithGoogle();

    // Must NOT auto-upload User A's data into User B's empty cloud account!
    expect(fbMock.docs.has('users/user-B')).toBe(false);
    expect(mgr.getSnapshot().status).toBe('conflict');
    expect(mgr.getSnapshot().conflict.reason).toBe('account-switch');

    // User B clicks "Start Fresh" (`use-remote`) -> discards User A's local data and initializes clean tracker
    await mgr.resolveConflict('use-remote', storageSvc.load());
    expect(storageSvc.load().studentName).toBe('My');
    expect(JSON.parse(fbMock.docs.get('users/user-B').stateJson).studentName).toBe('My');

    // Enable a share for User B, then call `deleteCloudData()` -> deletes both share & user doc and wipes local data
    const bShare = await mgr.enableOrRotateShare(storageSvc.load());
    expect(fbMock.docs.has(`shares/${bShare}`)).toBe(true);
    await mgr.deleteCloudData();
    expect(fbMock.docs.has(`shares/${bShare}`)).toBe(false);
    expect(fbMock.docs.has('users/user-B')).toBe(false);
    expect(mgr.getSnapshot().user).toBeNull();
    expect(mem.getItem(SYNC_META_KEY)).toBeNull();
    expect(JSON.parse(mem.getItem(STORAGE_KEY)).studentName).toBe('My');

    mgr.stop();
  });

  it('preserves newer remote grades when toggling/rotating share links and guards unreconciled syncNow()', async () => {
    const fbMock = createRulesEnforcingFirebaseMock();
    const mem = createMemoryStorage();
    const storageSvc = new StorageService({ storage: mem });
    const mgr = new CloudSyncManager({
      firebaseFactory: () => fbMock.service,
      storage: mem,
      storageSvc,
      debounceMs: 10,
    });
    mgr.start();

    fbMock.setPopupUser({ uid: 'user-1', email: 's@example.com' });
    await mgr.signInWithGoogle();

    // Device B saves newer grades (rev=2) while Device A is clean (!dirty) at rev=1
    const newerCloud = createInitialState();
    newerCloud.studentName = 'Newer From Phone';
    fbMock.seedDirect('users/user-1', {
      stateJson: JSON.stringify(newerCloud),
      updatedAt: 'ts-phone',
      rev: 2,
      shareToken: null,
    });

    // Enabling share on Device A must adopt 'Newer From Phone' instead of overwriting it with stale 'My'
    const shareToken = await mgr.enableOrRotateShare(storageSvc.load());
    expect(storageSvc.load().studentName).toBe('Newer From Phone');
    expect(JSON.parse(fbMock.docs.get(`shares/${shareToken}`).stateJson).studentName).toBe(
      'Newer From Phone',
    );
    expect(fbMock.docs.get('users/user-1').rev).toBe(3);

    // Unreconciled syncNow() when lastSyncedUid belongs to user-1 must NOT push into user-2
    mgr.currentUser = { uid: 'user-2', email: 'u2@example.com', displayName: null };
    fbMock.emitAuth({ uid: 'user-2', email: 'u2@example.com' });
    await mgr.syncNow(storageSvc.load());
    expect(fbMock.docs.has('users/user-2')).toBe(false);
    expect(mgr.getSnapshot().status).toBe('conflict');
    expect(mgr.getSnapshot().conflict.reason).toBe('account-switch');

    mgr.stop();
  });

  it('resolves VITE_FIREBASE_* env vars and stays quietly in local-only mode when unconfigured (#18)', async () => {
    const emptyCfg = resolveFirebaseConfig({});
    expect(isFirebaseConfigComplete(emptyCfg)).toBe(false);

    const fullCfg = resolveFirebaseConfig({
      VITE_FIREBASE_API_KEY: ' key-123 ',
      VITE_FIREBASE_AUTH_DOMAIN: 'proj.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'proj',
      VITE_FIREBASE_APP_ID: '1:1:web:1',
    });
    expect(fullCfg.apiKey).toBe('key-123');
    expect(isFirebaseConfigComplete(fullCfg)).toBe(true);

    const mem = createMemoryStorage();
    const storageSvc = new StorageService({ storage: mem });
    const unconfiguredFactory = () => {
      const err = new Error('Not configured');
      err.code = 'firebase/not-configured';
      throw err;
    };

    const mgr = new CloudSyncManager({
      firebaseFactory: unconfiguredFactory,
      storage: mem,
      storageSvc,
    });
    mgr.start();
    // Must stay cleanly disconnected with no startup error banner
    expect(mgr.getSnapshot().status).toBe('disconnected');
    expect(mgr.getSnapshot().error).toBeNull();

    // Explicit sign-in surfaces clear setup guidance
    await expect(mgr.signInWithGoogle()).rejects.toThrow(/\.env\.local/i);
    mgr.stop();
  });

  it('rejects orphan shares on user update/delete and dangling shareToken pointers (#12)', async () => {
    const fbMock = createRulesEnforcingFirebaseMock();
    const mem = createMemoryStorage();
    const storageSvc = new StorageService({ storage: mem });
    const mgr = new CloudSyncManager({
      firebaseFactory: () => fbMock.service,
      storage: mem,
      storageSvc,
    });
    mgr.start();

    fbMock.setPopupUser({ uid: 'user-1', email: 's@example.com' });
    await mgr.signInWithGoogle();
    const activeToken = await mgr.enableOrRotateShare(storageSvc.load());
    const stateJson = JSON.stringify(storageSvc.load());

    // 1. Direct update setting shareToken: null WITHOUT deleting shares/{activeToken} -> denied
    const orphanUpdateBatch = fbMock.service.writeBatch();
    orphanUpdateBatch.set(fbMock.service.doc('users', 'user-1'), {
      stateJson,
      updatedAt: fbMock.service.serverTimestamp(),
      rev: 3,
      shareToken: null,
    });
    await expect(orphanUpdateBatch.commit()).rejects.toMatchObject({
      code: 'permission-denied',
    });

    // 2. Direct delete of users/user-1 WITHOUT deleting shares/{activeToken} -> denied
    const orphanDeleteBatch = fbMock.service.writeBatch();
    orphanDeleteBatch.delete(fbMock.service.doc('users', 'user-1'));
    await expect(orphanDeleteBatch.commit()).rejects.toMatchObject({
      code: 'permission-denied',
    });

    // 3. Direct update pointing shareToken at a non-existent share doc -> denied
    const danglingToken = generateShareToken();
    const danglingBatch = fbMock.service.writeBatch();
    danglingBatch.delete(fbMock.service.doc('shares', activeToken));
    danglingBatch.set(fbMock.service.doc('users', 'user-1'), {
      stateJson,
      updatedAt: fbMock.service.serverTimestamp(),
      rev: 3,
      shareToken: danglingToken,
    });
    await expect(danglingBatch.commit()).rejects.toMatchObject({
      code: 'permission-denied',
    });

    // Clean disableShare & deleteCloudData still succeed 100%
    await mgr.disableShare(storageSvc.load());
    expect(fbMock.docs.has(`shares/${activeToken}`)).toBe(false);
    await mgr.deleteCloudData();
    expect(fbMock.docs.has('users/user-1')).toBe(false);
    mgr.stop();
  });
});
