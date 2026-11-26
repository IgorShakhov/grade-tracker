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
  - Toggleable simulator mode to test hypothetical marks without overwriting saved grades.
  - Per-course target dropdown calculating the exact average needed across remaining ungraded syllabus weight (`secured`, `achievable`, or `unreachable`).
- **Local-First Persistence, Sharing & Export**:
  - Automatic `localStorage` persistence via `StorageService` with strict schema validation.
  - Compressed URL-safe Read-Only Share Snapshot links (`#share=z1....` via `CompressionStream`).
  - Full JSON backup export/import and UTF-8 BOM CSV export formatted for Microsoft Excel.
- **GitHub Pages CI/CD**: Automated test + Vite build + Pages deployment workflow (`.github/workflows/deploy.yml`).

### Milestone 1.1 — Generic Configurability, Course Organization & Safety *(Shipped in PRs #1, #2, #5)*
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
- **Full In-Memory What-If Sandbox Isolation (Issue #4 / PR #5)**:
  - Upgraded What-If Simulator to clone `sandboxState` on entry so editing *any* field (including already-graded assessments, blank assessments, weights, units, or hypothetical courses) stays strictly in memory and reverts 100% cleanly on exit without touching `localStorage`.

### Milestone 2 — GitHub-Backed Multi-Device Cloud Sync (`localStorage` + `grade-data` Branch) *(Shipped)*
- **Dedicated `grade-data` Branch Architecture (`src/services/githubSync.js`)**:
  - Pairs instant offline-first `localStorage` with direct GitHub REST Contents API sync (`GET` / `PUT /repos/{owner}/{repo}/contents/data/{profileId}.json?ref=grade-data`).
  - Storing anonymous profile files (`data/<profileId>.json`) on an orphan **`grade-data`** branch inside the same repository keeps `main` commit history strictly dedicated to application PRs, avoids triggering GitHub Actions Pages rebuilds on grade edits, and supports multiple profiles effortlessly.
  - Uses GitHub's blob `sha` for optimistic concurrency control, auto-bootstraps the target data branch if absent on a fork, queues changes offline (`pendingSync`) and flushes automatically on reconnect, and surfaces a 1-click `SyncConflictModal` (`Keep This Device` vs `Load Cloud Version`) on concurrent multi-device edits.
- **Cloud Sync Setup & Zero-Token Live View (`src/components/SyncModals.jsx`, `src/App.jsx`)**:
  - Auto-infers `owner/repo` when hosted on GitHub Pages (`<owner>.github.io/<repo>`) and stores the Fine-Grained Personal Access Token exclusively in browser `localStorage`.
  - Generates a permanent **Live Read-Only View Link** (`?profile=<profileId>`) that anyone can bookmark to view always-current grades straight from GitHub with zero token required, plus a 1-click `Connect Token to Edit` upgrade on secondary devices.
- *(Optional Future Privacy Enhancement)*: Client-side `crypto.subtle` (`AES-GCM`) passphrase encryption can be layered onto `data/<profileId>.json` if encrypted payloads are ever desired, or a private repository can be entered in the Repository field at any time.

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
