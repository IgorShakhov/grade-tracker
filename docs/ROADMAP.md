# Grade Tracker — Product Roadmap & Architecture Decisions

This document tracks shipped milestones, upcoming features, and key technical decisions so any contributor or AI coding agent can pick up right where the previous session left off.

---

## Shipped Milestones

### Milestone 1 — Core Course & GPA Spreadsheet Replacement *(Shipped in PR #1)*
- **Inline Course & Assessment Ledger**: Editable course code, title, credit units (`0.25`–`6.0`), assessment category names, syllabus weights (`%`), and earned grades (`%`).
- **Running Grade & Credit-Weighted GPA Engine**:
  - Weighted running course percentage over graded items (ungraded items remain neutral until entered).
  - Nearest-integer threshold lookup for Letter Grade and configurable GPA scale (`0%` floor enforced), plus `Pass/Fail` course toggle with dynamic scale-derived pass threshold.
  - Multi-term support computing both Term GPA and overall unit-weighted Cumulative GPA.
- **What-If Exam Simulator & Target Calculator**:
  - Toggleable simulator mode to test hypothetical marks without overwriting saved grades.
  - Per-course target dropdown built dynamically from the active `gradeScale` (plus custom percentages) calculating the exact average needed across remaining ungraded syllabus weight (`secured`, `achievable`, or `unreachable`).
- **Local-First Persistence, Offline Assets & Sharing**:
  - Self-hosted variable typography (`@fontsource-variable/plus-jakarta-sans` & `@fontsource-variable/jetbrains-mono`), strict `<meta http-equiv="Content-Security-Policy">`, and `<noscript>` fallback so zero third-party font requests occur and offline loads work cleanly.
  - Automatic `localStorage` persistence via `StorageService` with strict schema validation, rolling raw corruption backups (`grade_tracker_v1_corrupt_<ts>`), partial course/category salvage, and `CURRENT_SCHEMA_VERSION` forward-compatibility gating (`SchemaTooNewError`).
  - Compressed URL-safe Read-Only Share Snapshot links (`#share=z1....` via `CompressionStream`, with automatic `?share=` -> `#share=` query-to-fragment normalization).
- **GitHub Pages CI/CD**: Automated PR/push CI (`.github/workflows/ci.yml`) and Pages deployment workflow (`.github/workflows/deploy.yml`) running `npm audit`, `npm run lint`, `npm test`, and `npm run build`.

### Milestone 1.1 — Generic Configurability, Course Organization & Safety *(Shipped in PRs #1, #2, #5)*
- **100% Generic & Configurable Setup**:
  - Stripped all personal and institution-specific identifiers from public source code; editable owner/tracker header and in-app **Customize Grading Scale** modal.
- **Course & Category Organization**:
  - Collapsible individual course cards + **Collapse All / Expand All** per term (persisted locally without triggering cloud sync writes).
  - Dedicated `⋮⋮` drag-handle and `↑`/`↓` keyboard reordering for courses and assessment rows.
  - Course creation presets (`Standard 25/35/40%`, `Blank`) and 1-click **Duplicate Course Structure** (copies category names & weights, clears grades).
  - `Term` / `Full Year` duration badge and **Move Course to Term** transfer selector.
- **Undo / Redo & Delete Confirmations (PR #2)**:
  - Atomic `{ current, past, future }` history stack with toolbar **`↶ Undo`** / **`↷ Redo`** buttons and `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, and `Ctrl+Y` shortcuts (preserving active term & collapsed UI state across Undo/Redo).
  - Focus-trapped modal confirmation (`ConfirmDeleteModal`) before deleting a Term or Course; inline 2-click `Delete?` confirmation before deleting an Assessment Row.
  - Structured GitHub Issue templates (`.github/ISSUE_TEMPLATE/`) for bug reports and feature requests.
- **Full In-Memory What-If Sandbox Isolation (Issue #4 / PR #5)**:
  - Upgraded What-If Simulator to clone `sandboxState` on entry so editing *any* field (including already-graded assessments, blank assessments, weights, units, or hypothetical courses) stays strictly in memory and reverts 100% cleanly on exit without touching `localStorage`.

### Milestone 2 — 1-Click Google Sign-In & Cloud Firestore Sync *(Shipped)*
- **Architecture Pivot Decision (GitHub PAT → Firebase Auth + Cloud Firestore)**:
  - Replaced the initial manual GitHub Fine-Grained Personal Access Token sync (`grade-data` branch) with **Google Sign-In (`signInWithPopup`) + Cloud Firestore** on the free Spark plan, and retired the `grade-data` branch + manual JSON/CSV file import/export UI to keep the app lean and effortless across devices.
  - Code-split `firebase-*.js` chunk is loaded lazily on demand (`import('./firebase.js')` — zero eager `modulepreload` for local-only users) while automatically restoring returning signed-in sessions (`lastSyncedUid`).
  - Eliminates manual token generation, cross-device token copying, and 30-day token expiration while keeping zero user data in the public GitHub repository.
- **Hardened Security & Multi-Device Concurrency (`firestore.rules`, `src/services/cloudSync.js`)**:
  - Owner-isolated `users/{uid}` documents (`allow list: if false`) enforcing exact schema keys, `< 300 KB` payload bounds, server-enforced commit timestamps (`updatedAt == request.time`), zero stored PII, and monotonic integer `rev` counters (`rev == 1` on create, `rev == resource.data.rev + 1` on update) with `SyncConflictModal` resolution (`initial-merge`, `rev-mismatch`, `account-switch`, and `remote-deleted`).
  - Shared-computer safety: Firestore uses stateless `firebase/firestore/lite` (zero IndexedDB grade remnants on disk; Firebase Auth stores only the active OAuth session token in IndexedDB until Sign Out), Sign Out flushes pending edits before clearing local `grade_tracker_v1` + Undo/Redo history across tabs, involuntary auth loss (`onAuthStateChanged(null)` while dirty) preserves `grade_tracker_v1_unsynced_backup` for next sign-in recovery, and `lastSyncedUid` prevents accidental cross-account uploads.
- **Unified Sharing (`#view=<token>` Live Link + `#share=...` Snapshot)**:
  - Signed-in users can enable, rotate, or turn off a 192-bit `base64url` **Live Auto-Updating Link** (`#view=<token>` with `<meta name="referrer" content="no-referrer" />`) backed by `shares/{token}` (storing only opaque `ownerUid`, `stateJson`, and `updatedAt`) and symmetrically bound 1-to-1 to `users/{uid}.shareToken` via `getAfter(...)` and `!existsAfter(...)` on both `users/{uid}` and `shares/{token}` in a single atomic `writeBatch` (zero orphan share docs and zero dangling `shareToken` pointers), alongside one-time compressed `#share=` snapshots.

---

## Planned Milestones

### Milestone 3 — Sub-Assessments ("Drop Lowest N"), Visual Analytics & Mobile PWA *(Next Planned)*
- **Expandable Sub-Category Items**:
  - Expand any category row (e.g., `Quizzes — 10%` or `Homework — 6%`) into individual items (`Quiz 1`, `Quiz 2`, ...) with automatic sub-average calculation and an optional **"Drop lowest `N`"** rule.
- **Clarified Course Credit Weight Input**:
  - Support arbitrary credit systems seamlessly (both `0.5`/`1.0` course-equivalents and `1`–`5` credit hours) with clear tooltips.
- **GPA & Credit Visuals**:
  - Compact term-by-term GPA trend visualization and grade distribution summary.
- **Installable PWA**:
  - Web App Manifest + lightweight asset service worker so the app installs cleanly to iOS/Android home screens and loads even with zero network connectivity.

---

### Milestone 4 — Configurable Degree & Requirement Progress
- **Credit Goal Progress**: Configurable total graduation credit target (e.g., `20.0` or `120` credits) breaking down *Completed*, *In Progress*, and *Planned* units.
- **Custom Requirement / Distribution Tags**: User-defined tags on courses (e.g., `Core`, `Elective`, `Distribution 1–5`) and configurable `Pass/Fail` unit cap tracking.
