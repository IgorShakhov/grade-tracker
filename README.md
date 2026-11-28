# Grade Tracker

A fast, offline-first academic grade and GPA tracker built with React and Vite. Track course assessments, simulate exam and course outcomes, calculate target grades on remaining coursework, and sync courses across devices with 1-click Google Sign-In.

## For AI Coding Agents (Start Here)

If you are an AI coding assistant (Antigravity, Cursor, Claude Code, Copilot, etc.) picking up this repository from any account or session, **bootstrap your context in this exact order before scanning source files**:

1. **Read [`AGENTS.md`](AGENTS.md)** — Complete directory/module map, Vanilla CSS policy, grade calculation & rounding invariants, atomic Undo/Redo state design, What-If sandbox isolation, destructive-action safety rules, and Firebase/Firestore security invariants.
2. **Read [`docs/ROADMAP.md`](docs/ROADMAP.md)** — Shipped milestones (`M1`, `M1.1`, `M2` Google Sign-In + Firestore Cloud Sync), upcoming roadmap (`M3` sub-assessments & PWA, `M4` degree progress), and recorded architectural decisions.
3. **Check Open GitHub Issues** — Run `gh issue list --state open` (if `gh` is authenticated) to inspect pending bug reports and feature requests.
4. **Keep Context Alive** — Whenever you ship a PR that adds features, changes module structure, or updates roadmap scope, update [`AGENTS.md`](AGENTS.md) and/or [`docs/ROADMAP.md`](docs/ROADMAP.md) in the **same PR** so future sessions never encounter stale documentation.

## Key Features

- **Inline Assessment Ledger**: Add, edit, reorder, and weight individual coursework categories and graded items directly inside each course.
- **Running Weighted Course Grades**: Live calculation of current earned percentage, graded vs. remaining weight, and projected standing.
- **Unit-Weighted GPA & Multi-Term Tracking**: Organize courses across academic terms with flexible course credit inputs (`0`–`100` credits, quick presets, and credit-system guidance) plus automatic term GPA, cumulative unit-weighted GPA, and Pass/Fail exclusion support.
- **Term GPA Trend & Grade Distribution Visuals**: Collapsible pure-SVG term-by-term GPA progression chart and letter-grade tier distribution breakdown with live What-If Simulator preview updates.
- **Collapsible & Reorderable Course Cards**: Expand or collapse course cards for a compact overview and reorder courses via drag-and-drop or keyboard controls.
- **Course Presets, Duplication & Term Transfers**: Start quickly from reusable course templates, duplicate existing course structures, or move courses between terms.
- **Full Sandbox What-If Simulator**: Preview how hypothetical changes to any grade, weight, unit, or course affect your final standing and GPA in an isolated memory sandbox without overwriting saved data.
- **Undo / Redo & Safe Deletions**: Multi-step Undo/Redo history (`Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` / `Ctrl+Y`) paired with confirmation dialogs for term/course deletions and 2-click inline confirmation for assessment rows.
- **Remaining-Weight Target Grade Calculator**: Select a desired target percentage to see the exact average required across remaining ungraded coursework.
- **Configurable Grading Scale**: Supports standard 4.0 GPA scales and customizable percentage-to-GPA/letter-grade thresholds.
- **1-Click Google Cloud Sync (Firebase Auth + Firestore)**: Sign in with Google on any laptop, phone, or tablet to automatically keep courses synced across devices with automatic session refresh, offline local caching, multi-device conflict resolution, and safe sign-out cache clearing.
- **Live Auto-Updating & Point-in-Time Share Links**: Share either an always-current read-only link (`#view=<token>`, revocable or rotatable anytime) or a self-contained compressed URL snapshot (`#share=...`).

## Local Development

Prerequisites: Node.js 22+ and npm (plus Java 21+ and a one-time `npx firebase-tools setup:emulators:firestore` download if running `npm run test:rules` locally).

```bash
# Install dependencies
npm install

# (Optional) Enable Google Cloud Sync locally by copying .env.example -> .env.local
cp .env.example .env.local

# Start the local development server on localhost:5173 (pass `-- --host` to expose on LAN)
npm run dev

# Run ESLint (--max-warnings 0), unit/UI/a11y tests, V8 coverage, and Firestore Emulator rules tests
npm run lint
npm test
npm run test:coverage
npm run test:rules

# Build the production bundle into ./dist
npm run build
```

## GitHub Pages & Firestore Rules CI/CD

- **Pull Request & Push CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))**: Runs `npm audit --omit=dev --audit-level=high`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:rules` (against the Java 21 Cloud Firestore Emulator) on every PR and push to `main`.
- **GitHub Pages Deployment ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml))**:
  1. Push the repository to GitHub with `main` as your default branch.
  2. Under **Settings → Secrets and variables → Actions**, configure the `VITE_FIREBASE_*` repository secrets listed in [`.env.example`](.env.example) (and optionally add `VITE_UMAMI_WEBSITE_ID` under **Variables** to enable cookie-free Umami Cloud usage counters; visit `?analytics=off` once on your own devices to exclude personal visits, or `?analytics=on` to re-enable).
  3. Under **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
  4. Every push to `main` (or manual `workflow_dispatch` trigger) runs `npm ci`, `npm run lint`, `npm test`, and `npm run build`, then publishes `./dist` to GitHub Pages.
- **Automated Firestore Security Rules Deployment ([`.github/workflows/deploy-rules.yml`](.github/workflows/deploy-rules.yml))**:
  - Whenever `firestore.rules` (or `firebase.json` / `.firebaserc`) changes on `main` (or via manual `workflow_dispatch`), GitHub Actions re-verifies `npm run test:rules` and deploys `firestore.rules` behind the `firebase-prod` GitHub Environment — eliminating manual Firebase Console copy/paste.
  - **One-time keyless GCP Workload Identity Federation setup (recommended)**:
    1. In the Google Cloud project backing Firebase (`grade-tracker-sync`), enable `iamcredentials.googleapis.com`, `sts.googleapis.com`, and `firebaserules.googleapis.com`, then create a dedicated service account (e.g. `rules-deployer`) granted **only** `Firebase Rules Admin` (`roles/firebaserules.admin`, zero user-data read/write access).
    2. Create a Workload Identity Pool + OIDC provider (`https://token.actions.githubusercontent.com`) restricted to `assertion.repository == '<owner>/<repo>' && assertion.ref == 'refs/heads/main'`, and grant `roles/iam.workloadIdentityUser` on that service account.
    3. In GitHub **Settings → Secrets and variables → Actions → Variables**, set `GCP_WIF_PROVIDER` (full provider resource name) and `GCP_RULES_DEPLOYER_SA` (service account email) — or set a `FIREBASE_SERVICE_ACCOUNT` repository secret as a fallback.
    4. In GitHub **Settings → Environments**, configure `firebase-prod` (optionally adding yourself as a required reviewer and restricting deployments to `main`).

## Cloud Sync & Security Model

Grade Tracker combines instant offline-first `localStorage` ([`src/services/storage.js`](src/services/storage.js)) with on-demand Firebase Authentication (Google Sign-In) and Cloud Firestore ([`src/services/cloudSync.js`](src/services/cloudSync.js), [`firestore.rules`](firestore.rules)):

- **Zero Grade Data or Keys in Source & Lazy Cloud Bundle**: The public GitHub repository hosts only static application code (`VITE_FIREBASE_*` web app identifiers are injected at build time via GitHub Actions Secrets) and self-hosted fonts with a strict `<meta http-equiv="Content-Security-Policy">`. Local-only users never download the Firebase SDK chunk; it loads dynamically on demand when signing in, opening Share, or restoring an active cloud session. All synced course data lives privately in Firestore (`users/{uid}`) and the local browser cache.
- **Hardened Firestore Rules (`firestore.rules`)**: Uses stateless `firebase/firestore/lite` (zero IndexedDB grade persistence on disk; Firebase Auth stores only the active OAuth session token in IndexedDB until Sign Out). Per-user documents are strictly owner-only (`request.auth.uid == uid`, non-listable) with server-timestamp validation (`updatedAt == request.time`), monotonic revision counters (`rev`) to prevent stale multi-device overwrites, forward schema-version gating (`SchemaTooNewError`), and zero stored PII (no email, name, or photo stored in Firestore).
- **Revocable Live Read-Only Links (`#view=<token>`)**: Enabling a live link writes a 192-bit random token (storing only opaque `ownerUid`, `stateJson`, and `updatedAt`) symmetrically bound 1-to-1 to the owner's `shareToken` via `getAfter(...)` and `!existsAfter(...)` on both `users/{uid}` and `shares/{token}` in a single atomic `writeBatch` (zero orphan share docs and zero dangling `shareToken` pointers). Tokens stay in the URL `#` fragment (`no-referrer` enforced in `index.html`, with `?view=` and `?share=` query links normalized into `#` fragments) and can be rotated or turned off atomically at any time.
- **Cookie-Free, Zero-PII Usage Analytics ([`src/services/analytics.js`](src/services/analytics.js))**: When `VITE_UMAMI_WEBSITE_ID` is configured, Grade Tracker loads Umami asynchronously with `Do Not Track` honored, localhost/test builds excluded, `?search` and `#hash` tokens stripped down to pathname-only via `beforeSend`, and a frozen enum-only event schema so student names, course codes, grades, UIDs, and share tokens can never be transmitted.
