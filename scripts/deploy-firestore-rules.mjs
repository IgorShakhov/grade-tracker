import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const firebaserc = JSON.parse(
  fs.readFileSync(path.join(repoRoot, '.firebaserc'), 'utf8'),
);
const firebaseConfig = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'firebase.json'), 'utf8'),
);

const projectId = process.env.FIREBASE_PROJECT_ID || firebaserc?.projects?.default;
const rulesRelPath = firebaseConfig?.firestore?.rules || 'firestore.rules';
const rulesContent = fs.readFileSync(path.join(repoRoot, rulesRelPath), 'utf8');
const accessToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;

if (!projectId) {
  throw new Error('Missing Firebase project ID in .firebaserc or FIREBASE_PROJECT_ID.');
}
if (!accessToken) {
  throw new Error('Missing GOOGLE_OAUTH_ACCESS_TOKEN from google-github-actions/auth.');
}

const API_BASE = 'https://firebaserules.googleapis.com/v1';
const RELEASE_ID = 'cloud.firestore';
const files = [{ name: rulesRelPath, content: rulesContent }];

async function rulesRequest(method, urlPath, body) {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body: json };
}

async function main() {
  // 1. Server-side compilation & syntax validation
  const testRes = await rulesRequest(
    'POST',
    `/projects/${encodeURIComponent(projectId)}:test`,
    { source: { files } },
  );
  if (!testRes.ok) {
    throw new Error(
      `Firebase Rules API :test failed (${testRes.status}): ${JSON.stringify(testRes.body)}`,
    );
  }
  const errors = (testRes.body.issues || []).filter((i) => i.severity === 'ERROR');
  if (errors.length > 0) {
    throw new Error(
      `firestore.rules compilation errors:\n${errors
        .map(
          (i) =>
            `  ${i.sourcePosition?.line}:${i.sourcePosition?.column} ${i.description}`,
        )
        .join('\n')}`,
    );
  }

  // 2. Check if active release already points to identical rules content (idempotent, preserves 1,000-ruleset quota)
  const releasePath = `/projects/${encodeURIComponent(projectId)}/releases/${RELEASE_ID}`;
  const currentRelease = await rulesRequest('GET', releasePath);
  if (currentRelease.ok && currentRelease.body.rulesetName) {
    const activeRuleset = await rulesRequest(
      'GET',
      `/${currentRelease.body.rulesetName}`,
    );
    const activeFiles = activeRuleset.body?.source?.files || [];
    if (
      activeRuleset.ok &&
      activeFiles.length === 1 &&
      activeFiles[0].content === rulesContent
    ) {
      console.log(
        `✓ ${rulesRelPath} on ${projectId} is already up to date (${currentRelease.body.rulesetName}).`,
      );
      return;
    }
  }

  // 3. Create new immutable ruleset
  const createRes = await rulesRequest(
    'POST',
    `/projects/${encodeURIComponent(projectId)}/rulesets`,
    { source: { files } },
  );
  if (!createRes.ok || !createRes.body.name) {
    throw new Error(
      `Failed to create ruleset (${createRes.status}): ${JSON.stringify(createRes.body)}`,
    );
  }
  const rulesetName = createRes.body.name;
  console.log(`Created ruleset: ${rulesetName}`);

  // 4. Atomically update (or create) the cloud.firestore release
  const releaseFullName = `projects/${projectId}/releases/${RELEASE_ID}`;
  let bindRes = await rulesRequest('PATCH', releasePath, {
    release: {
      name: releaseFullName,
      rulesetName,
    },
  });
  if (bindRes.status === 404) {
    bindRes = await rulesRequest(
      'POST',
      `/projects/${encodeURIComponent(projectId)}/releases`,
      {
        name: releaseFullName,
        rulesetName,
      },
    );
  }
  if (!bindRes.ok) {
    throw new Error(
      `Failed to bind release ${releaseFullName} (${bindRes.status}): ${JSON.stringify(bindRes.body)}`,
    );
  }

  console.log(`✓ Deployed ${rulesRelPath} to ${releaseFullName} -> ${rulesetName}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
