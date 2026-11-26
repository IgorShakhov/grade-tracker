# Grade Tracker

A fast, offline-first academic grade and GPA tracker built with React and Vite. Track course assessments, simulate exam and course outcomes, calculate target grades on remaining coursework, and manage multi-term GPAs right in your browser.

## For AI Coding Agents (Start Here)

If you are an AI coding assistant (Antigravity, Cursor, Claude Code, Copilot, etc.) picking up this repository from any account or session, **bootstrap your context in this exact order before scanning source files**:

1. **Read [`AGENTS.md`](AGENTS.md)** — Complete directory/module map, Vanilla CSS policy, grade calculation & rounding invariants, atomic Undo/Redo state design, What-If sandbox isolation, and destructive-action safety rules.
2. **Read [`docs/ROADMAP.md`](docs/ROADMAP.md)** — Shipped milestones (`M1`, `M1.1`), upcoming roadmap (`M2` GitHub `grades.json` sync, `M3` sub-assessments & PWA, `M4` degree progress), and recorded architectural decisions.
3. **Check Open GitHub Issues** — Run `gh issue list --state open` (if `gh` is authenticated) to inspect pending bug reports and feature requests.
4. **Keep Context Alive** — Whenever you ship a PR that adds features, changes module structure, or updates roadmap scope, update [`AGENTS.md`](AGENTS.md) and/or [`docs/ROADMAP.md`](docs/ROADMAP.md) in the **same PR** so future sessions never encounter stale documentation.

## Key Features

- **Inline Assessment Ledger**: Add, edit, reorder, and weight individual coursework categories and graded items directly inside each course.
- **Running Weighted Course Grades**: Live calculation of current earned percentage, graded vs. remaining weight, and projected standing.
- **Unit-Weighted GPA & Multi-Term Tracking**: Organize courses across academic terms with automatic term GPA and cumulative unit-weighted GPA (including Pass/Fail exclusion support).
- **Collapsible & Reorderable Course Cards**: Expand or collapse course cards for a compact overview and reorder courses via drag-and-drop or keyboard controls.
- **Course Presets, Duplication & Term Transfers**: Start quickly from reusable course templates, duplicate existing course structures, or move courses between terms.
- **Full Sandbox What-If Simulator**: Preview how hypothetical changes to any grade, weight, unit, or course affect your final standing and GPA in an isolated memory sandbox without overwriting saved data.
- **Undo / Redo & Safe Deletions**: Multi-step Undo/Redo history (`Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`) paired with confirmation dialogs for term/course deletions and 2-click inline confirmation for assessment rows.
- **Remaining-Weight Target Grade Calculator**: Select a desired target percentage to see the exact average required across remaining ungraded coursework.
- **Configurable Grading Scale**: Supports standard 4.0 GPA scales and customizable percentage-to-GPA/letter-grade thresholds.
- **GitHub Multi-Device Cloud Sync**: Optional 1-minute setup using a GitHub Fine-Grained Personal Access Token to auto-sync profiles (`data/<profileId>.json`) to a dedicated `grade-data` branch—plus zero-token **Live Read-Only View Links** (`?profile=<profileId>`).
- **Compressed Read-Only Share Snapshot Links**: Generate compact, URL-encoded read-only snapshots to share progress across devices or with family and peers.
- **JSON Backup & Excel UTF-8 CSV Export**: Export and restore full state snapshots as JSON, or download UTF-8 BOM CSV spreadsheets ready for Microsoft Excel.

## Local Development

Prerequisites: Node.js 22+ and npm.

```bash
# Install dependencies
npm install

# Start the local development server
npm run dev

# Run the unit & UI test suite
npm test

# Build the production bundle into ./dist
npm run build
```

## GitHub Pages Deployment

Deployment to GitHub Pages is automated via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

1. Push the repository to GitHub with `main` as your default branch.
2. In your GitHub repository, go to **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
3. Every push to `main` (or manual `workflow_dispatch` trigger) runs `npm ci`, `npm test`, and `npm run build`, then publishes `./dist` to GitHub Pages.

## GitHub Multi-Device Sync (`grade-data` Branch)

Grade Tracker persists all state offline-first in `localStorage` via [`src/services/storage.js`](src/services/storage.js) and includes a built-in GitHub Contents API sync engine in [`src/services/githubSync.js`](src/services/githubSync.js):

- **Dedicated `grade-data` Branch**: Synced profiles are stored at `data/<profileId>.json` on an orphan `grade-data` branch so `main` stays 100% pure application code and grade edits never trigger GitHub Actions Pages rebuilds.
- **One-Time Setup**: Click **Cloud Sync** in the header, generate or enter a `profileId`, and paste a GitHub Fine-Grained Personal Access Token scoped **only** to your `grade-tracker` repository with `Contents: Read and write` permission (stored only in browser `localStorage`).
- **Zero-Token Live View**: Share or bookmark `https://<owner>.github.io/<repo>/?profile=<profileId>` to view always-current grades in read-only mode without needing a token.
