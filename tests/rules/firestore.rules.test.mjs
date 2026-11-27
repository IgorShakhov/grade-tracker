import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const rulesSource = fs.readFileSync(path.join(repoRoot, 'firestore.rules'), 'utf8');

const PROJECT_ID = 'demo-grade-tracker-rules';

function makeEmulatorJwt(uid) {
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'none', typ: 'JWT' });
  const payload = b64url({
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: uid,
    user_id: uid,
    iat: now - 60,
    exp: now + 3600,
  });
  return `${header}.${payload}.`;
}

function findCachedEmulatorJar() {
  if (process.env.FIRESTORE_EMULATOR_JAR && fs.existsSync(process.env.FIRESTORE_EMULATOR_JAR)) {
    return process.env.FIRESTORE_EMULATOR_JAR;
  }
  const cacheDir = path.join(os.homedir(), '.cache', 'firebase', 'emulators');
  if (!fs.existsSync(cacheDir)) return null;
  const jars = fs
    .readdirSync(cacheDir)
    .filter((f) => /^cloud-firestore-emulator-.*\.jar$/.test(f))
    .sort()
    .reverse();
  return jars.length > 0 ? path.join(cacheDir, jars[0]) : null;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHttpReady(baseUrl, getEarlyExitError = () => null, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const earlyErr = getEarlyExitError();
    if (earlyErr) throw earlyErr;
    try {
      const res = await fetch(baseUrl);
      if (res.ok) return;
    } catch {
      // Wait for emulator socket
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const finalErr = getEarlyExitError();
  if (finalErr) throw finalErr;
  throw new Error(`Timed out waiting for Firestore Emulator at ${baseUrl}`);
}

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number' && Number.isInteger(val)) {
    return { integerValue: String(val) };
  }
  if (typeof val === 'boolean') return { booleanValue: val };
  throw new Error(`Unsupported Firestore test field value: ${typeof val}`);
}

function docName(collection, id) {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${id}`;
}

function setWithServerTimestampOp(collection, id, fieldsObj) {
  const fields = {};
  for (const [k, v] of Object.entries(fieldsObj)) {
    fields[k] = toFirestoreValue(v);
  }
  const name = docName(collection, id);
  return [
    { update: { name, fields } },
    {
      transform: {
        document: name,
        fieldTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
    },
  ];
}

function deleteOp(collection, id) {
  return [{ delete: docName(collection, id) }];
}

async function commitBatch(baseUrl, uid, ops) {
  const writes = ops.flat();
  const headers = { 'Content-Type': 'application/json' };
  if (uid) {
    headers.Authorization = `Bearer ${makeEmulatorJwt(uid)}`;
  }
  const res = await fetch(
    `${baseUrl}/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ writes }),
    },
  );
  return res.status;
}

async function getDocStatus(baseUrl, uid, collection, id = null) {
  const headers = {};
  if (uid) {
    headers.Authorization = `Bearer ${makeEmulatorJwt(uid)}`;
  }
  const suffix = id ? `${collection}/${id}` : collection;
  const res = await fetch(
    `${baseUrl}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${suffix}`,
    { headers },
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function stopEmulator(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore
      }
      resolve();
    }, 3000);
    forceTimer.unref?.();
    child.once('exit', () => {
      clearTimeout(forceTimer);
      resolve();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(forceTimer);
      resolve();
    }
  });
}

async function main() {
  let hostPort = process.env.FIRESTORE_EMULATOR_HOST || '';
  let child = null;
  let earlyChildError = null;
  let stderrBuf = '';

  const onSignal = () => {
    if (child && child.exitCode === null) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore
      }
    }
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  if (!hostPort) {
    const jar = findCachedEmulatorJar();
    if (!jar) {
      throw new Error(
        'No running FIRESTORE_EMULATOR_HOST and no cached cloud-firestore-emulator JAR in ~/.cache/firebase/emulators/. Run `npx firebase setup:emulators:firestore` once first.',
      );
    }
    const port = await findFreePort();
    hostPort = `127.0.0.1:${port}`;
    child = spawn('java', ['-jar', jar, '--host', '127.0.0.1', '--port', String(port)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk) => {
      if (stderrBuf.length < 8192) {
        stderrBuf += chunk.toString('utf8');
      }
    });
    child.once('error', (err) => {
      earlyChildError = new Error(`Failed to launch Java Firestore Emulator: ${err.message}`);
    });
    child.once('exit', (code, signal) => {
      earlyChildError = new Error(
        `Java Firestore Emulator exited prematurely (code=${code}, signal=${signal}). ${stderrBuf.trim()}`,
      );
    });
  }

  const baseUrl = `http://${hostPort}`;
  try {
    await waitForHttpReady(baseUrl, () => earlyChildError);

    // Upload exact repository firestore.rules
    const putRules = await fetch(
      `${baseUrl}/emulator/v1/projects/${PROJECT_ID}:securityRules`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rules: { files: [{ name: 'firestore.rules', content: rulesSource }] },
        }),
      },
    );
    assert.equal(putRules.status, 200, `Failed to load firestore.rules: ${await putRules.text()}`);

    // Clear database state
    const clearRes = await fetch(
      `${baseUrl}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    assert.equal(clearRes.status, 200);

    const token1 = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    const token2 = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa987654';
    const dangling = 'DanglingToken0123456789AbCdEfGhI';

    // 1. Create users/alice at rev=1 (shareToken: null) -> ALLOWED (200)
    assert.equal(
      await commitBatch(baseUrl, 'alice', [
        setWithServerTimestampOp('users', 'alice', {
          stateJson: '{"v":1}',
          rev: 1,
          shareToken: null,
        }),
      ]),
      200,
    );

    // 2. Enable share (rev=2 + create shares/token1) -> ALLOWED (200)
    assert.equal(
      await commitBatch(baseUrl, 'alice', [
        setWithServerTimestampOp('users', 'alice', {
          stateJson: '{"v":2}',
          rev: 2,
          shareToken: token1,
        }),
        setWithServerTimestampOp('shares', token1, {
          ownerUid: 'alice',
          stateJson: '{"v":2}',
        }),
      ]),
      200,
    );

    // 3. Anonymous reader with exact token1 -> ALLOWED (200); collection list -> DENIED (403)
    const anonGet = await getDocStatus(baseUrl, null, 'shares', token1);
    assert.equal(anonGet.status, 200);
    assert.equal((await getDocStatus(baseUrl, null, 'shares')).status, 403);

    // 4. Setting shareToken: null WITHOUT deleting shares/token1 -> DENIED (403)
    assert.equal(
      await commitBatch(baseUrl, 'alice', [
        setWithServerTimestampOp('users', 'alice', {
          stateJson: '{"v":3}',
          rev: 3,
          shareToken: null,
        }),
      ]),
      403,
    );

    // 5. Deleting users/alice WITHOUT deleting shares/token1 -> DENIED (403)
    assert.equal(
      await commitBatch(baseUrl, 'alice', [deleteOp('users', 'alice')]),
      403,
    );

    // 6. Symmetric #49 check: Deleting shares/token1 ALONE while users/alice.shareToken == token1 -> DENIED (403)!
    assert.equal(
      await commitBatch(baseUrl, 'alice', [deleteOp('shares', token1)]),
      403,
    );

    // 7. Pointing shareToken at non-existent dangling token -> DENIED (403)
    assert.equal(
      await commitBatch(baseUrl, 'alice', [
        deleteOp('shares', token1),
        setWithServerTimestampOp('users', 'alice', {
          stateJson: '{"v":3}',
          rev: 3,
          shareToken: dangling,
        }),
      ]),
      403,
    );

    // 8. Rotating token1 -> token2 WITHOUT deleting shares/token1 -> DENIED (403)
    assert.equal(
      await commitBatch(baseUrl, 'alice', [
        setWithServerTimestampOp('users', 'alice', {
          stateJson: '{"v":3}',
          rev: 3,
          shareToken: token2,
        }),
        setWithServerTimestampOp('shares', token2, {
          ownerUid: 'alice',
          stateJson: '{"v":3}',
        }),
      ]),
      403,
    );

    // 9. Atomic rotate token1 -> token2 WITH deleting shares/token1 -> ALLOWED (200)
    assert.equal(
      await commitBatch(baseUrl, 'alice', [
        setWithServerTimestampOp('users', 'alice', {
          stateJson: '{"v":3}',
          rev: 3,
          shareToken: token2,
        }),
        setWithServerTimestampOp('shares', token2, {
          ownerUid: 'alice',
          stateJson: '{"v":3}',
        }),
        deleteOp('shares', token1),
      ]),
      200,
    );

    // 10. Cross-user Bob reading Alice or deleting Alice's share -> DENIED (403)
    assert.equal((await getDocStatus(baseUrl, 'bob', 'users', 'alice')).status, 403);
    assert.equal(
      await commitBatch(baseUrl, 'bob', [deleteOp('shares', token2)]),
      403,
    );

    // 11. Extra PII field (`email`) on users/alice -> DENIED (403)
    assert.equal(
      await commitBatch(baseUrl, 'alice', [
        setWithServerTimestampOp('users', 'alice', {
          stateJson: '{"v":4}',
          rev: 4,
          shareToken: token2,
          email: 'pii@example.com',
        }),
      ]),
      403,
    );

    // 12. Atomic deleteCloudData (delete shares/token2 + users/alice) -> ALLOWED (200)
    assert.equal(
      await commitBatch(baseUrl, 'alice', [
        deleteOp('shares', token2),
        deleteOp('users', 'alice'),
      ]),
      200,
    );

    console.log('✓ All 12 Firestore Security Rules invariants passed against Java Firestore Emulator.');
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await stopEmulator(child);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
