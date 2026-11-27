# AGENTS.md — AI Coding Agent & Maintainer Guide

Read this file and [`docs/ROADMAP.md`](docs/ROADMAP.md) first before modifying the repository. Together they capture the architecture, invariants, and planned milestones so you do not need to reverse-engineer the codebase.

---

## 1. Project Overview

**Grade Tracker** is a static, offline-first course grade and GPA web application deployed on GitHub Pages with 1-click Google Sign-In and Cloud Firestore multi-device sync.

- **Stack**: React 19 + Vite (`base: './'`) + Firebase Modular SDK (`firebase/app`, `firebase/auth`, `firebase/firestore/lite`) + Vanilla CSS + Vitest (`jsdom` + `@testing-library/react`).
- **Styling Policy**: Pure Vanilla CSS in `src/styles/index.css` using curated HSL custom properties and `Plus Jakarta Sans` + `JetBrains Mono` (`tabular-nums`). Do **not** introduce TailwindCSS or CSS-in-JS libraries unless explicitly requested.
- **Privacy & Generic Repo Policy**: Because this repository is public (to support GitHub Free Pages), keep **zero** personal names or university-specific identifiers in source code, default templates, tests, commit messages, or docs. All real course data lives exclusively in per-user Firestore documents (`users/{uid}`) and local browser storage.

---

## 2. Directory & Module Map

```text
.
├── .env.example                      # Template for VITE_FIREBASE_* build-time env vars (.env.local gitignored)
├── index.html                        # Entry HTML, no-referrer policy, Google Fonts, SVG icon
├── firestore.rules                   # Hardened Firestore v2 security rules (users/{uid} & shares/{token})
├── vite.config.js                    # Vite build (base: './') + Vitest jsdom config
├── src/
│   ├── main.jsx                      # React 19 StrictMode root
│   ├── App.jsx                       # Top-level state, Undo/Redo, What-If sandbox, Google Cloud Sync & #view/#share viewer
│   ├── domain/
│   │   ├── constants.js              # STORAGE_KEY, DEFAULT_GRADE_SCALE, UNIT_OPTIONS, TARGET_PRESETS
│   │   ├── templates.js              # createInitialState, createEmptyState, course/term factories
│   │   ├── calculations.js           # Pure math: roundHalfUp, lookupGrade, course/term/cumulative GPA, target calculator
│   │   └── operations.js             # Pure immutable helpers: reorder, moveCourseToTerm, duplicateCourseInTerm, collapseAll
│   ├── services/
│   │   ├── storage.js                # validateTrackerState, StorageService (localStorage + registerCloudAdapter hook)
│   │   ├── firebase.js               # VITE_FIREBASE_* env resolver + lazy Auth (Google popup) & stateless Firestore Lite init
│   │   ├── cloudSync.js              # CloudSyncManager: Google Auth, atomic writeBatch sync, rev concurrency, #view shares
│   │   └── share.js                  # CompressionStream ('z1.') / base64url ('u1.') point-in-time URL snapshot codec
│   ├── components/
│   │   ├── HeaderLedger.jsx          # Owner input, Sync status pill, Undo/Redo, What-If, Sign In / Account, Share
│   │   ├── TermTabs.jsx              # Multi-term tabs, inline rename, delete trigger, Collapse/Expand All
│   │   ├── CourseCard.jsx            # Collapsible/draggable course sheet, inline numeric cells, 2-click row delete, target bar
│   │   ├── GradeScaleCard.jsx        # Sticky Grading Scale reference + Customize trigger
│   │   ├── Modals.jsx                # Unified ShareModal (Live #view Link + Static Snapshot), ScaleEditorModal, ConfirmDeleteModal
│   │   └── SyncModals.jsx            # CloudSyncModal (Google Sign-In, Sync Now, Sign Out, Delete Cloud Data) & SyncConflictModal
│   └── styles/
│       └── index.css                 # Complete Vanilla CSS design system, responsive breakpoints, @media print
├── tests/unit/
│   ├── calculations.test.js          # Weighted math, rounding, custom scales, Pass/Fail, target edge cases
│   ├── share.test.js                 # Compressed URL snapshot round-trips & malformed token safety
│   ├── storage.test.js               # Schema validation, migrations, cloud adapter hooks
│   ├── cloud-sync.test.js            # Rules-enforcing Firestore mock: Google auth, rev conflicts, share rotation, account isolation
│   ├── operations.test.js            # Reorder, duplicate, move-to-term, collapse helpers
│   └── app.test.jsx                  # React integration tests (M1 + M1.1 + Undo/Redo + What-If sandbox + Sign-In & Share UI)
└── .github/
    ├── workflows/deploy.yml          # CI/CD: npm ci -> npm test -> npm run build -> deploy ./dist to GitHub Pages
    └── ISSUE_TEMPLATE/               # Structured Bug Report & Feature Request forms
```

---

## 3. Core Architectural Invariants

1. **Running Course Grade Math (`src/domain/calculations.js`)**:
   - Blank (`grade: null`) assessment categories do **not** penalize the running course grade; `overallGrade` is the weighted average of graded categories only (`weightedPoints / gradedWeight * 100`).
   - Final course percentage is rounded half-up to the nearest integer (`roundHalfUp(clamped, 0)`) when looking up the letter grade and GPA in `lookupGrade(percentage, gradeScale)`.
   - Display percentages use half-up rounding (`roundHalfUp(val, 2)`) so IEEE-754 boundary values like `85.305` format consistently as `85.31%`.
   - Courses with `passFail: true` display `P` / `NP` / `P/F` and are excluded from GPA denominators while still counting toward enrolled credits and weighted percentage averages.

2. **Atomic State + Undo/Redo (`src/App.jsx`)**:
   - `App.jsx` stores `{ current, past, future, localSaveSeq, needsPersist }` in a single `doc` state object so `commitState`, `updateCurrentWithoutHistory`, `handleUndo`, and `handleRedo` remain 100% pure under React 19 `<StrictMode>` (`storageService.prepareForSave(...)` inside updaters, persisted once via `useEffect`).
   - Rapid consecutive character edits sharing a `coalesceKey` within `700ms` coalesce into a single Undo step; structural mutations and deletions never coalesce.
   - UI-only toggles (`activeTermId` tab switch, `collapsed` fold state) use `updateCurrentWithoutHistory` so folding cards does not pollute the Undo stack or touch `lastUpdated`.
   - Remote cloud pulls and cross-tab storage resets clear stale Undo/Redo stacks (`past: [], future: []`) so Undo cannot overwrite another device's edits without conflict detection.

3. **What-If Simulator Sandbox Isolation (`src/App.jsx`)**:
   - Entering What-If Simulator clones the current base state into an in-memory `sandboxState` (`structuredClone(baseState)`).
   - While `sandboxState !== null`, **all** mutations update **only** `sandboxState` — never calling `storageService.save()`, never triggering Firestore writes, and never pushing onto real Undo/Redo history.
   - Exiting What-If sets `sandboxState = null` (with `<CourseCard key={...-sim|live} />` remounting cleanly) so 100% of saved values revert immediately.

4. **Destructive Action Safety**:
   - Deleting a **Term** or **Course**, or replacing existing tracker courses via **Save Copy Locally** from a shared view, must open `ConfirmDeleteModal`.
   - Deleting an **Assessment Row** uses inline 2-step confirmation (`×` → `Delete?`) inside `CourseCard.jsx`.
   - Every confirmed deletion or local replacement pushes onto the Undo stack and surfaces an inline `Undo` action in the toast notification.

5. **Firebase Google Sign-In, Firestore Rules & Security Invariants (`src/services/cloudSync.js`, `firestore.rules`)**:
   - **Auth Flow**: Always use `signInWithPopup` (never `signInWithRedirect`, which breaks on `github.io` vs `firebaseapp.com` due to browser third-party storage partitioning).
   - **Zero Grade PII & Stateless Firestore Lite**: Uses `firebase/firestore/lite` so zero IndexedDB grade copies persist on disk (`E3`). Never write `email`, `displayName`, or `photoURL` to Firestore or `localStorage` — `users/{uid}` stores only `{ stateJson, updatedAt, rev, shareToken }`. Note that Firebase Auth itself stores the active OAuth session token/profile in browser IndexedDB while signed in and clears it on `Sign Out`.
   - **Optimistic Concurrency (`rev`) & Orphan-Free Atomic Share Sync**: Every cloud save runs in a single `writeBatch` incrementing `rev` by `+1` (`rev == 1` on create, `rev == resource.data.rev + 1` on update) with `updatedAt: serverTimestamp()`, updating `shares/{shareToken}` in the same batch when live sharing is active. Rotating, disabling, or deleting user data deletes `shares/{oldToken}` in the same `writeBatch`; `firestore.rules` enforces symmetric 1-to-1 binding via both `getAfter(...)` and `!existsAfter(...)`.
   - **Shared-Computer, Multi-Tab & Cloud-Delete Safety**: `grade_tracker_sync_meta_v1` tracks `lastSyncedUid` and `lastSyncedRev`. Signing out flushes pending online edits first (prompting before discarding offline/unsynced changes), then wipes `grade_tracker_v1`, sync metadata, and Undo/Redo state across all open tabs (`storage` + `onAuthStateChanged(null)`). Pre-existing custom local courses trigger `'initial-merge'` instead of silent overwrite; another account's leftover local edits trigger `'account-switch'`; and if **Delete Cloud Data** is run on one device while another device is still signed in at `lastSyncedRev > 0`, the second device surfaces a `'remote-deleted'` prompt (**Sign Out & Clear** vs **Re-Upload Courses**) rather than silently recreating `users/{uid}`.
   - **XSS & Origin Boundary**: Never use `dangerouslySetInnerHTML`. Every remote `stateJson` (both `users/{uid}` and `shares/{token}`) must pass `validateTrackerState` before entering React state. Note that all GitHub Pages apps under `<owner>.github.io/*` share one browser origin, so never deploy untrusted third-party JS under the same GitHub Pages account.

---

## 4. Development, Verification & Release Workflow

```bash
npm install          # Install dependencies
npm test             # Run all Vitest unit + React UI tests (must pass 100%)
npm run build        # Verify production Vite bundle in ./dist
```

### Git & Pull Request Conventions
- Work on a descriptive branch (`feat/...`, `fix/...`, `docs/...`), verify `npm test && npm run build`, open a Pull Request against `main` with a clear structured summary body, and squash-merge (`gh pr merge --squash --delete-branch`).
- The repository is configured with `squash_merge_commit_title=PR_TITLE` and `squash_merge_commit_message=PR_BODY`, so writing a thorough PR description automatically records a clean changelog entry in `git log` on `main` and triggers `.github/workflows/deploy.yml` to publish to GitHub Pages.
- Check open issues first when picking up new work: `gh issue list --state open`.
- **Documentation Sync Requirement**: Whenever a PR changes features, architecture invariants, or milestone scope, update `AGENTS.md` and/or `docs/ROADMAP.md` in the **same PR** so future sessions always inherit accurate context.
