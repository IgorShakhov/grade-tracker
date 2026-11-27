# AGENTS.md — AI Coding Agent & Maintainer Guide

Read this file and [`docs/ROADMAP.md`](docs/ROADMAP.md) first before modifying the repository. Together they capture the architecture, invariants, and planned milestones so you do not need to reverse-engineer the codebase.

---

## 1. Project Overview

**Grade Tracker** is a static, offline-first course grade and GPA web application deployed on GitHub Pages with 1-click Google Sign-In and Cloud Firestore multi-device sync.

- **Stack**: React 19 + Vite (`base: './'`) + Firebase Modular SDK (`firebase/app`, `firebase/auth`, `firebase/firestore/lite`, dynamically imported on demand) + Vanilla CSS + self-hosted `@fontsource-variable` fonts + Vitest (`jsdom`, `@testing-library/react`, `vitest-axe`, `@vitest/coverage-v8`).
- **Styling Policy**: Pure Vanilla CSS in `src/styles/index.css` using curated HSL custom properties and self-hosted `Plus Jakarta Sans Variable` + `JetBrains Mono Variable` (`tabular-nums`). Do **not** introduce TailwindCSS or CSS-in-JS libraries unless explicitly requested.
- **Privacy & Generic Repo Policy**: Because this repository is public (to support GitHub Free Pages), keep **zero** personal names or university-specific identifiers in source code, default templates, tests, commit messages, or docs. All real course data lives exclusively in per-user Firestore documents (`users/{uid}`) and local browser storage.

---

## 2. Directory & Module Map

```text
.
├── .env.example                      # Template for VITE_FIREBASE_* build-time env vars (.env.local gitignored)
├── .firebaserc                       # Firebase project alias (default -> grade-tracker-sync) for rules deploys
├── firebase.json                     # Firebase CLI config mapping firestore.rules
├── index.html                        # Entry HTML, no-referrer policy, strict meta CSP, <noscript> fallback, SVG icon
├── firestore.rules                   # Hardened Firestore v2 security rules (users/{uid} & shares/{token})
├── vite.config.js                    # Vite build (base: './', code-split firebase chunk) + Vitest jsdom/coverage config
├── src/
│   ├── main.jsx                      # Self-hosted @fontsource-variable imports + React 19 StrictMode root + ErrorBoundary
│   ├── App.jsx                       # Top-level state, Undo/Redo, What-If sandbox, Google Cloud Sync & #view/#share viewer
│   ├── domain/
│   │   ├── constants.js              # STORAGE_KEY, DEFAULT_GRADE_SCALE, UNIT_OPTIONS, TARGET_PRESETS
│   │   ├── templates.js              # createInitialState, createEmptyState, course/term factories
│   │   ├── calculations.js           # Pure math: roundHalfUp, lookupGrade, course/term/cumulative GPA, target calculator
│   │   └── operations.js             # Pure immutable helpers: reorder, moveCourseToTerm, duplicateCourseInTerm, collapseAll
│   ├── services/
│   │   ├── storage.js                # validateTrackerState, schema gating, corrupt-load salvage, StorageService
│   │   ├── firebase.js               # On-demand chunk: VITE_FIREBASE_* env resolver + Auth (Google popup) & Firestore Lite
│   │   ├── cloudSync.js              # CloudSyncManager: lazy import('./firebase.js'), atomic writeBatch sync, rev concurrency
│   │   └── share.js                  # CompressionStream ('z1.') / base64url ('u1.') point-in-time URL snapshot codec
│   ├── components/
│   │   ├── HeaderLedger.jsx          # Owner input, Sync status pill, Undo/Redo, What-If, Sign In / Account, Share
│   │   ├── TermTabs.jsx              # ARIA tablist (ArrowLeft/Right/Home/End + F2 rename), delete trigger, Collapse/Expand All
│   │   ├── CourseCard.jsx            # Collapsible course sheet (⋮⋮ drag handle), inline numeric cells, 2-click row delete, target bar
│   │   ├── GradeScaleCard.jsx        # Sticky Grading Scale reference + Customize trigger
│   │   ├── ErrorBoundary.jsx         # Top-level crash recovery boundary with local backup export
│   │   ├── useDraftText.js           # Space-safe & empty-safe controlled text draft hook
│   │   ├── useDialogFocus.js         # Modal focus trap, initial Cancel focus, background inert, trigger focus restoration
│   │   ├── Modals.jsx                # Unified ShareModal (Live #view Link + Static Snapshot), ScaleEditorModal, ConfirmDeleteModal
│   │   └── SyncModals.jsx            # CloudSyncModal (Google Sign-In, Sync Now, Sign Out, Delete Cloud Data) & SyncConflictModal
│   └── styles/
│       └── index.css                 # Complete Vanilla CSS design system, WCAG 2.2 AA contrast tokens, @media print
├── scripts/
│   └── deploy-firestore-rules.mjs    # Least-privilege Firebase Rules v1 REST deployer (roles/firebaserules.admin only)
├── tests/
│   ├── rules/
│   │   └── firestore.rules.test.mjs  # Real Java Cloud Firestore Emulator REST security rules test suite
│   └── unit/
│       ├── calculations.test.js      # Weighted math, rounding, custom scales, Pass/Fail, target & timezone edge cases
│       ├── share.test.js             # Compressed URL snapshot round-trips & malformed token safety
│       ├── storage.test.js           # Schema validation, version gating, corrupt-load salvage & rolling backups
│       ├── cloud-sync.test.js        # Rules-enforcing Firestore mock: lazy SDK load, Google auth, rev conflicts, share symmetry
│       ├── operations.test.js        # Reorder, duplicate, move-to-term, collapse helpers
│       └── app.test.jsx              # React integration + vitest-axe a11y tests (M1 + M1.1 + Undo/Redo + What-If + Sync & Share)
└── .github/
    ├── dependabot.yml                # Weekly npm & GitHub Actions dependency checks
    ├── workflows/ci.yml              # PR & push CI: verify (audit/lint/test/build) + rules (Java 21 Firestore Emulator)
    ├── workflows/deploy.yml          # Pages CD: npm ci -> lint -> test -> build -> deploy ./dist
    ├── workflows/deploy-rules.yml    # Automated firestore.rules deploy on main (gated by test:rules + firebase-prod env)
    └── ISSUE_TEMPLATE/               # Structured Bug Report & Feature Request forms
```

---

## 3. Core Architectural Invariants

1. **Running Course Grade Math (`src/domain/calculations.js`)**:
   - Blank (`grade: null`) assessment categories do **not** penalize the running course grade; `overallGrade` is the weighted average of graded categories only (`weightedPoints / gradedWeight * 100`).
   - Final course percentage is rounded half-up to the nearest integer (`roundHalfUp(clamped, 0)`) when looking up the letter grade and GPA in `lookupGrade(percentage, gradeScale)` (with exact comparison when a custom scale configures fractional `min` thresholds). If a score falls below every configured band's `min`, `lookupGrade` safely returns `{ letter: 'F', gpa: 0, tier: 'tier-f', roundedPct }` rather than a non-zero GPA (`#38`), and `ScaleEditorModal` requires non-empty cells, unique non-overlapping bands, and a `min === 0` floor band.
   - Display percentages use half-up rounding (`roundHalfUp(val, 2)`) so IEEE-754 boundary values like `85.305` format consistently as `85.31%`. `formatLastUpdated(isoString, timeZone)` formats timestamps in the user's local timezone by default (`#45`).
   - Courses with `passFail: true` display `P` / `NP` / `P/F` using the active scale's dynamic passing threshold (`getPassingThreshold(gradeScale)` — lowest `min` with `gpa > 0`, fallback `50%`, `#39`) and are excluded from GPA denominators while still counting toward enrolled credits and weighted percentage averages. Course Target `<select>` options are built dynamically from `gradeScale` (`buildTargetOptions`) plus a `Custom (<pct>%)` entry whenever `targetPct` is non-preset (`#40`). `App.jsx` memoizes `calculateAllStats(activeState)` via `useMemo`, and `CourseCard.jsx` reuses `stats.targetStatus` / `stats.requiredOnRemaining` directly (`#51`).

2. **Atomic State + Undo/Redo (`src/App.jsx`)**:
   - `App.jsx` stores `{ current, past, future, localSaveSeq, cloudSaveSeq }` in a single `doc` state object so `commitState`, `updateCurrentWithoutHistory`, `handleUndo`, and `handleRedo` remain 100% pure under React 19 `<StrictMode>` (`storageService.prepareForSave(...)` inside updaters, persisted once via `useEffect`).
   - Rapid consecutive character edits sharing a `coalesceKey` within `700ms` coalesce into a single Undo step; structural mutations and deletions never coalesce. No-op commits (including focusing and blurring an unedited numeric cell with `>2` decimals such as `33.333` or `85.305` via `dirtyRef`, `#35`, `#76`) are short-circuited without rounding stored precision, creating Undo entries, or triggering cloud writes.
   - UI-only toggles (`activeTermId` tab switch, `collapsed` fold state) use `updateCurrentWithoutHistory` (incrementing `localSaveSeq` only, `syncToCloud: false`) so folding cards or switching tabs persists locally without polluting the Undo stack, touching `lastUpdated`, or triggering Firestore `rev++` writes (`#42`). Undo/Redo (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`) preserves the current `activeTermId` and `collapsed` UI state across matching terms/courses (`#52`).
   - Remote cloud pulls and cross-tab storage resets clear stale Undo/Redo stacks (`past: [], future: []`) only when canonical academic data actually changed so Undo cannot overwrite another device's edits without conflict detection.

3. **What-If Simulator Sandbox Isolation (`src/App.jsx`)**:
   - Entering What-If Simulator clones the current base state into an in-memory `sandboxState` (`structuredClone(baseState)`).
   - While `sandboxState !== null`, **all** mutations update **only** `sandboxState` — never calling `storageService.save()`, never triggering Firestore writes, and never pushing onto real Undo/Redo history.
   - Exiting What-If sets `sandboxState = null` (with `<CourseCard key={...-sim|live} />` remounting cleanly) so 100% of saved values revert immediately.

4. **Destructive Action Safety & Modal Accessibility (`src/components/useDialogFocus.js`)**:
   - Deleting a **Term** or **Course**, or replacing existing tracker courses via **Save Copy Locally** from a shared view, must open `ConfirmDeleteModal` (which focuses `Cancel` initially, traps `Tab`/`Shift+Tab`, marks background `.app-root` siblings `inert` via a reference-counted snapshot that excludes `.toast-live-region` and survives modal-to-modal hand-offs cleanly (`#74`, `#75`), and restores origin trigger focus once the last modal closes, as do all 5 modals via `useDialogFocus`).
   - Deleting an **Assessment Row** uses inline 2-step confirmation (`×` → `Delete?`) inside `CourseCard.jsx`. Course card drag-and-drop uses a dedicated `⋮⋮` drag handle rather than whole-card `draggable` so text selection inside inputs is never intercepted (`#50`).
   - Every confirmed deletion or local replacement pushes onto the Undo stack (restorable via the toolbar `↶ Undo` button or `Ctrl/Cmd+Z`) and shows a confirmation toast inside an always-mounted, non-inert `role="status"` live region.

5. **Firebase Google Sign-In, Firestore Rules & Security Invariants (`src/services/cloudSync.js`, `firestore.rules`)**:
   - **On-Demand Lazy SDK Loading (`#48`) & Popup Auth**: `cloudSync.js` dynamically imports `./firebase.js` (`import('./firebase.js')`), emitting a separate `firebase-*.js` chunk with zero eager `<link rel="modulepreload">` in `dist/index.html`. Local-only users never download Firebase; the chunk loads on demand when opening Sign In / Share (cached synchronously so `signInWithPopup` runs inside the user click gesture), visiting `#view=<token>`, or restoring a returning session (`lastSyncedUid` / `unsyncedBackup`). Always use `signInWithPopup` (never `signInWithRedirect`, which breaks on `github.io` vs `firebaseapp.com` due to browser third-party storage partitioning).
   - **Zero Grade PII & Stateless Firestore Lite**: Uses `firebase/firestore/lite` so zero IndexedDB grade copies persist on disk (`E3`). Never write `email`, `displayName`, or `photoURL` to Firestore or `localStorage` — `users/{uid}` stores only `{ stateJson, updatedAt, rev, shareToken }`. Public `shares/{token}` documents store `{ ownerUid, stateJson, updatedAt }`, where `ownerUid` is the opaque non-PII Firebase Auth UID required by `firestore.rules` to enforce owner-only updates and deletions (`#49`). Note that Firebase Auth itself stores the active OAuth session token/profile in browser IndexedDB while signed in and clears it on `Sign Out`.
   - **Optimistic Concurrency (`rev`) & Truly Symmetric Atomic Share Sync (`#49`)**: Every cloud save runs in a single `writeBatch` incrementing `rev` by `+1` (`rev == 1` on create, `rev == resource.data.rev + 1` on update) with `updatedAt: serverTimestamp()`, updating `shares/{shareToken}` in the same batch when live sharing is active. Rotating, disabling, or deleting user data deletes `shares/{oldToken}` in the same `writeBatch`; `firestore.rules` enforces symmetric 1-to-1 binding in **both** directions via `getAfter(...)` and `!existsAfter(...)` on both `users/{uid}` and `shares/{token}` (including rejecting standalone `shares/{token}` deletes while `users/{uid}.shareToken == token`). Both legacy `?view=` and `?share=` query links normalize immediately via `history.replaceState` into `#view=` / `#share=` fragments (`#53`).
   - **Shared-Computer, Multi-Tab & Cloud-Delete Safety**: `grade_tracker_sync_meta_v1` tracks `lastSyncedUid` and `lastSyncedRev`. Signing out flushes pending online edits first (prompting before discarding offline/unsynced changes), then wipes `grade_tracker_v1`, sync metadata, and Undo/Redo state across all open tabs (`storage` + `onAuthStateChanged(null)`). If an active session is lost involuntarily (`onAuthStateChanged(null)` while `meta.dirty` is `true`, e.g. revoked token), `CloudSyncManager` saves `grade_tracker_v1_unsynced_backup` before wiping and restores/reconciles it on the user's next sign-in (`#46`). Pre-existing custom local courses trigger `'initial-merge'` instead of silent overwrite; another account's leftover local edits trigger `'account-switch'`; and if **Delete Cloud Data** is run on one device while another device is still signed in at `lastSyncedRev > 0`, the second device surfaces a `'remote-deleted'` prompt (**Sign Out & Clear** vs **Re-Upload Courses**) rather than silently recreating `users/{uid}`.
   - **Schema Version Gating & Corrupt-Load Salvage (`src/services/storage.js`)**: `validateTrackerState` enforces `CURRENT_SCHEMA_VERSION` (`1`) with forward migrations (`SCHEMA_MIGRATIONS`) and throws `SchemaTooNewError` (`storage/schema-too-new`) when `raw.version > CURRENT_SCHEMA_VERSION` so older clients pause editing and refuse to overwrite `localStorage` or push stripped documents to Firestore (`#37`). On local JSON/validation corruption, `StorageService.load()` preserves a rolling raw backup (`grade_tracker_v1_corrupt_<timestamp>`), salvages valid sibling courses/categories, and surfaces a recovery notice with raw backup export (`#36`).
   - **XSS, Self-Hosted Assets & Origin Hardening (`#53`)**: Never use `dangerouslySetInnerHTML`. Every remote `stateJson` (both `users/{uid}` and `shares/{token}`) must pass `validateTrackerState` before entering React state. `index.html` ships self-hosted fonts (zero third-party font requests), `<meta name="referrer" content="no-referrer" />`, `<noscript>` fallback, and a strict `<meta http-equiv="Content-Security-Policy" ...>`. Note that all GitHub Pages apps under `<owner>.github.io/*` share one browser origin, so never deploy untrusted third-party JS under the same GitHub Pages account.

---

## 4. Development, Verification & Release Workflow

```bash
npm install            # Install dependencies (Node.js >= 22)
npm run lint           # Run ESLint (--max-warnings 0) across src/ and tests/
npm test               # Run all Vitest unit, React UI & vitest-axe a11y tests
npm run test:coverage  # Run Vitest with V8 coverage summary & HTML report
npm run test:rules     # Verify firestore.rules against the local Java Cloud Firestore Emulator (requires Java 21 + `npx firebase-tools setup:emulators:firestore` once)
npm run build          # Verify production Vite bundle in ./dist (zero eager Firebase modulepreload)
```

### Git & Pull Request Conventions
- Work on a descriptive branch (`feat/...`, `fix/...`, `docs/...`), verify `npm run lint && npm test && npm run build` (plus `npm run test:rules` when modifying `firestore.rules`), open a Pull Request against `main` with a clear structured summary body, and squash-merge (`gh pr merge --squash --delete-branch`).
- The repository is configured with `squash_merge_commit_title=PR_TITLE` and `squash_merge_commit_message=PR_BODY`, so writing a thorough PR description automatically records a clean changelog entry in `git log` on `main` and triggers `.github/workflows/deploy.yml` (and `.github/workflows/deploy-rules.yml` behind the `firebase-prod` environment when `firestore.rules` changes, keeping rules backward-compatible with currently live clients).
- Check open issues first when picking up new work: `gh issue list --state open`.
- **Documentation Sync Requirement**: Whenever a PR changes features, architecture invariants, or milestone scope, update `AGENTS.md` and/or `docs/ROADMAP.md` in the **same PR** so future sessions always inherit accurate context.
