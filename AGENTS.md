# AGENTS.md — AI Coding Agent & Maintainer Guide

Read this file and [`docs/ROADMAP.md`](docs/ROADMAP.md) first before modifying the repository. Together they capture the architecture, invariants, and planned milestones so you do not need to reverse-engineer the codebase.

---

## 1. Project Overview

**Grade Tracker** is a static, offline-first course grade and GPA web application deployed on GitHub Pages.

- **Stack**: React 19 + Vite (`base: './'`) + Vanilla CSS + Vitest (`jsdom` + `@testing-library/react`).
- **Styling Policy**: Pure Vanilla CSS in `src/styles/index.css` using curated HSL custom properties and `Plus Jakarta Sans` + `JetBrains Mono` (`tabular-nums`). Do **not** introduce TailwindCSS or CSS-in-JS libraries unless explicitly requested.
- **Privacy & Generic Repo Policy**: Because this repository is public (to support GitHub Free Pages), keep **zero** personal names or university-specific identifiers in source code, default templates, tests, commit messages, or docs. Personal/institution customizations belong in user-configurable settings or synced `grade-data` profiles.

---

## 2. Directory & Module Map

```text
.
├── index.html                        # Entry HTML, Google Fonts, SVG icon
├── vite.config.js                    # Vite build (base: './') + Vitest jsdom config
├── src/
│   ├── main.jsx                      # React 19 StrictMode root
│   ├── App.jsx                       # Top-level state, Undo/Redo, What-If sandbox, Cloud Sync & ?profile= viewer
│   ├── domain/
│   │   ├── constants.js              # STORAGE_KEY, DEFAULT_GRADE_SCALE, UNIT_OPTIONS, TARGET_PRESETS
│   │   ├── templates.js              # createInitialState, createEmptyState, course/term factories
│   │   ├── calculations.js           # Pure math: roundHalfUp, lookupGrade, course/term/cumulative GPA, target calculator
│   │   └── operations.js             # Pure immutable helpers: reorder, moveCourseToTerm, duplicateCourseInTerm, collapseAll
│   ├── services/
│   │   ├── storage.js                # validateTrackerState, StorageService (localStorage + registerCloudAdapter hook)
│   │   ├── githubSync.js             # GitHubSyncManager: GitHub REST Contents API sync on branch 'grade-data' + sha conflict resolution
│   │   ├── share.js                  # CompressionStream ('z1.') / base64url ('u1.') read-only URL snapshot codec
│   │   └── exporters.js              # JSON import/export & UTF-8 BOM RFC-4180 Excel CSV exporter
│   ├── components/
│   │   ├── HeaderLedger.jsx          # Owner input, Sync status pill, Undo/Redo, What-If, Cloud Sync, Share, Import/Export
│   │   ├── TermTabs.jsx              # Multi-term tabs, inline rename, delete trigger, Collapse/Expand All
│   │   ├── CourseCard.jsx            # Collapsible/draggable course sheet, inline numeric cells, 2-click row delete, target bar
│   │   ├── GradeScaleCard.jsx        # Sticky Grading Scale reference + Customize trigger
│   │   ├── Modals.jsx                # ShareModal, DataModal, ScaleEditorModal, ConfirmDeleteModal
│   │   └── SyncModals.jsx            # CloudSyncModal (profile setup + live link) & SyncConflictModal
│   └── styles/
│       └── index.css                 # Complete Vanilla CSS design system, responsive breakpoints, @media print
├── tests/unit/
│   ├── calculations.test.js          # Weighted math, rounding, custom scales, Pass/Fail, target edge cases
│   ├── share.test.js                 # Compressed URL snapshot round-trips & malformed token safety
│   ├── storage-export.test.js        # Schema validation, migrations, cloud adapter hooks, JSON/CSV export
│   ├── github-sync.test.js           # Mocked-fetch GitHub Contents API sync, branch creation, offline queue, sha conflicts
│   ├── operations.test.js            # Reorder, duplicate, move-to-term, collapse helpers
│   └── app.test.jsx                  # React integration tests (M1 + M1.1 + Undo/Redo + What-If sandbox + Cloud Sync UI)
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
   - `App.jsx` stores `{ current, past, future }` in a single `doc` state object so `commitState`, `handleUndo`, and `handleRedo` remain 100% pure under React 19 `<StrictMode>`.
   - Rapid consecutive character edits sharing a `coalesceKey` within `700ms` coalesce into a single Undo step; structural mutations and deletions never coalesce.
   - UI-only toggles (`activeTermId` tab switch, `collapsed` fold state) use `updateCurrentWithoutHistory` so folding cards does not pollute the Undo stack or touch `lastUpdated`.

3. **What-If Simulator Sandbox Isolation (`src/App.jsx`)**:
   - Entering What-If Simulator clones the current base state into an in-memory `sandboxState` (`structuredClone(baseState)`).
   - While `sandboxState !== null`, **all** mutations update **only** `sandboxState` — never calling `storageService.save()`, never triggering GitHub Cloud Sync pushes, and never pushing onto real Undo/Redo history.
   - Exiting What-If sets `sandboxState = null` (with `<CourseCard key={...-sim|live} />` remounting cleanly) so 100% of saved values revert immediately.

4. **Destructive Action Safety**:
   - Deleting a **Term** or **Course** must open `ConfirmDeleteModal`.
   - Deleting an **Assessment Row** uses inline 2-step confirmation (`×` → `Delete?`) inside `CourseCard.jsx`.
   - Every confirmed deletion pushes onto the Undo stack and surfaces an inline `Undo` action in the toast notification.

5. **GitHub Cloud Sync & Dedicated `grade-data` Branch (`src/services/githubSync.js`)**:
   - `GitHubSyncManager` plugs into `storageService.registerCloudAdapter(...)` and stores anonymous profile files at `data/<profileId>.json` on the orphan **`grade-data`** branch (never on `main`, keeping `main` git history purely code PRs and avoiding unnecessary GitHub Actions Pages rebuilds).
   - Fine-Grained Personal Access Tokens live **only** in browser `localStorage` (`grade_tracker_cloud_sync_v1`) and are never serialized into `TrackerState`, JSON exports, or share URLs.
   - Opening `?profile=<profileId>` loads `data/<profileId>.json` directly from GitHub's Contents API in Live Read-Only View (zero token needed for public repos), unless the current browser is already authenticated to edit that profile.

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
