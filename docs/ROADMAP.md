# Grade Tracker — Product Roadmap & Architecture Decisions

This document tracks shipped milestones, upcoming features, and key technical decisions so any contributor or AI coding agent can pick up right where the previous session left off.

---

## Shipped Milestones

### Milestone 1 — Core Course & GPA Spreadsheet Replacement *(Shipped in PR #1)*
- **Inline Course & Assessment Ledger**: Editable course code, title, credit units (`0.25`–`2.0`), assessment category names, syllabus weights (`%`), and earned grades (`%`).
- **Running Grade & Credit-Weighted GPA Engine**:
  - Weighted running course percentage over graded items (ungraded items remain neutral until entered).
  - Nearest-integer threshold lookup for Letter Grade and 4.0 GPA scale, plus `Pass/Fail` course toggle.
  - Multi-term support computing both Term GPA and overall unit-weighted Cumulative GPA.
- **What-If Exam Simulator & Target Calculator**:
  - Toggleable simulator mode to test hypothetical marks on ungraded midterms/finals without overwriting saved grades.
  - Per-course target dropdown calculating the exact average needed across remaining ungraded syllabus weight (`secured`, `achievable`, or `unreachable`).
- **Local-First Persistence, Sharing & Export**:
  - Automatic `localStorage` persistence via `StorageService` with strict schema validation.
  - Compressed URL-safe Read-Only Share Snapshot links (`#share=z1....` via `CompressionStream`).
  - Full JSON backup export/import and UTF-8 BOM CSV export formatted for Microsoft Excel.
- **GitHub Pages CI/CD**: Automated test + Vite build + Pages deployment workflow (`.github/workflows/deploy.yml`).

### Milestone 1.1 — Generic Configurability, Course Organization & Safety *(Shipped in PRs #1 & #2)*
- **100% Generic & Configurable Setup**:
  - Stripped all personal and institution-specific identifiers from public source code; editable owner/tracker header and in-app **Customize Grading Scale** modal.
- **Course & Category Organization**:
  - Collapsible individual course cards + **Collapse All / Expand All** per term.
  - Drag-and-drop and `↑`/`↓` reordering for courses and assessment rows.
  - Course creation presets (`Standard 25/35/40%`, `Blank`) and 1-click **Duplicate Course Structure** (copies category names & weights, clears grades).
  - `Term` / `Full Year` duration badge and **Move Course to Term** transfer selector.
- **Undo / Redo & Delete Confirmations (PR #2)**:
  - Atomic `{ current, past, future }` history stack with toolbar **`↶ Undo`** / **`↷ Redo`** buttons, `Ctrl/Cmd+Z` & `Ctrl/Cmd+Shift+Z` shortcuts, and Undo button inside deletion toasts.
  - Modal confirmation (`ConfirmDeleteModal`) before deleting a Term or Course; inline 2-click `Delete?` confirmation before deleting an Assessment Row.
  - Structured GitHub Issue templates (`.github/ISSUE_TEMPLATE/`) for bug reports and feature requests.
- **Full In-Memory What-If Sandbox Isolation (Issue #4 Fix)**:
  - Upgraded What-If Simulator to clone `sandboxState` on entry so editing *any* field (including already-graded assessments, blank assessments, weights, units, or hypothetical courses) stays strictly in memory and reverts 100% cleanly on exit without touching `localStorage`.

---

## Planned Milestones

### Milestone 2 — GitHub-Backed Cloud Sync (`localStorage` + `grades.json`) *(Next Planned)*

#### Agreed Architecture Decision
Instead of introducing external third-party cloud databases (like Firebase) or heavy browser WASM SQLite bundles, **Milestone 2 will pair offline-first `localStorage` with direct `grades.json` sync on GitHub**:

1. **Why `localStorage` + GitHub `grades.json` (and not browser SQLite or Actions-compiled SQLite)**:
   - `localStorage` keeps the app 100% functional offline with `0ms` startup and instant writes.
   - Because this app's repository is public (for GitHub Free Pages), user grade data should live in a **separate private GitHub repository** (e.g., `<owner>/grade-tracker-data`) or a **Secret GitHub Gist** so personal marks remain completely private.
   - Reading/writing `grades.json` directly via GitHub's REST API (`GET` / `PUT /repos/{owner}/{repo}/contents/grades.json` or `PATCH /gists/{gist_id}`) commits straight to `HEAD` on `main` in `~300ms` **without Pull Requests** and without waiting 30s for GitHub Actions runners.
   - GitHub's file `sha` parameter provides built-in optimistic concurrency detection if two devices (e.g., laptop and phone) edit concurrently, plus free commit history for disaster recovery.
   - *(Future Escape Hatch)*: If the project ever expands to multi-user shared course catalogs requiring relational queries, a hosted serverless SQLite engine (Cloudflare D1 or Turso) can plug into the exact same `registerCloudAdapter` interface.

2. **Milestone 2 Scope**:
   - Implement `GitHubJsonAdapter` in `src/services/githubSync.js` plugging into `storageService.registerCloudAdapter(...)`.
   - **Cloud Sync Settings Modal**: Configure target repo (`owner/repo` + file path `grades.json`, or Gist ID) and paste a Fine-Grained Personal Access Token (`Contents: Read & Write` scoped only to the private data repo) stored only in device `localStorage`.
   - **Auto-Sync + Status Pill**: Debounced background push (~1.5s after edits when online), automatic pull on app open/focus, offline dirty-queue indicator (`Saved locally · Pending sync` -> `Synced`), and clean conflict resolution prompt if remote `sha` advanced on another device.
   - **Optional Live View Link / Read-Only Token Support**: Allow read-only viewing on secondary devices without accidental edits.

---

### Milestone 3 — Sub-Assessments ("Drop Lowest N"), Visual Analytics & Mobile PWA
- **Expandable Sub-Category Items**:
  - Expand any category row (e.g., `Quizzes — 10%` or `Homework — 6%`) into individual items (`Quiz 1`, `Quiz 2`, ...) with automatic sub-average calculation and an optional **"Drop lowest `N`"** rule.
- **GPA & Credit Visuals**:
  - Compact term-by-term GPA trend visualization and grade distribution summary.
- **Installable PWA**:
  - Web App Manifest + lightweight asset service worker so the app installs cleanly to iOS/Android home screens and loads even with zero network connectivity.

---

### Milestone 4 — Configurable Degree & Requirement Progress
- **Credit Goal Progress**: Configurable total graduation credit target (e.g., `20.0` or `120` credits) breaking down *Completed*, *In Progress*, and *Planned* units.
- **Custom Requirement / Distribution Tags**: User-defined tags on courses (e.g., `Core`, `Elective`, `Distribution 1–5`) and configurable `Pass/Fail` unit cap tracking.
