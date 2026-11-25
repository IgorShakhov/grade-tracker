# Grade Tracker

A fast, offline-first academic grade and GPA tracker built with React and Vite. Track course assessments, simulate final exam outcomes, calculate target grades on remaining coursework, and manage multi-term GPAs right in your browser.

## Key Features

- **Inline Assessment Ledger**: Add, edit, reorder, and weight individual coursework categories and graded items directly inside each course.
- **Running Weighted Course Grades**: Live calculation of current earned percentage, graded vs. remaining weight, and projected standing.
- **Unit-Weighted GPA & Multi-Term Tracking**: Organize courses across academic terms with automatic term GPA and cumulative unit-weighted GPA (including Credit/No-Credit exclusion support).
- **Collapsible & Reorderable Course Cards**: Expand or collapse course cards for a compact overview and reorder courses to match your priority.
- **Course Presets, Duplication & Term Transfers**: Start quickly from reusable course templates, duplicate existing course structures, or move courses between terms.
- **What-If Exam Simulator**: Preview how hypothetical scores on ungraded assessments affect your final course grade and GPA without overwriting saved scores.
- **Remaining-Weight Target Grade Calculator**: Enter a desired target percentage to see the exact average required across all remaining ungraded coursework.
- **Configurable Grading Scale**: Supports standard 4.0 GPA scales and customizable percentage-to-GPA/letter-grade thresholds.
- **Compressed Read-Only Share Snapshot Links**: Generate compact, URL-encoded read-only snapshots to share your term progress with advisors or peers.
- **JSON Backup & Excel UTF-8 CSV Export**: Export and restore full state snapshots as JSON, or download UTF-8 BOM CSV spreadsheets ready for Microsoft Excel.

## Local Development

Prerequisites: Node.js 22+ and npm.

```bash
# Install dependencies
npm install

# Start the local development server
npm run dev

# Run the unit test suite
npm test

# Build the production bundle into ./dist
npm run build
```

## GitHub Pages Deployment

Deployment to GitHub Pages is automated via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

1. Push the repository to GitHub with `main` as your default branch.
2. In your GitHub repository, go to **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
3. Every push to `main` (or manual `workflow_dispatch` trigger) runs `npm ci`, `npm test`, and `npm run build`, then publishes `./dist` to GitHub Pages.

## Cloud Sync Adapter Architecture

Grade Tracker persists all state offline-first in `localStorage` via `StorageService` in [`src/services/storage.js`](src/services/storage.js), and exposes `registerCloudAdapter(adapter)` for optional remote synchronization:

- **Local-First Writes**: `StorageService.save()` validates and normalizes state, writes immediately to `localStorage`, notifies subscribed UI listeners, and asynchronously invokes `adapter.save(snapshot)` if a cloud adapter is registered (cloud failures never block local persistence).
- **Remote Updates**: If the adapter implements `subscribe(callback)`, incoming remote states are validated with `validateAndMigrate()`, persisted locally, and broadcast to the UI.
- **Pluggable Backends**: An adapter is a plain object implementing `{ load?, save?, subscribe?, signIn?, signOut?, getUser? }`. For example, you can sync a `grades.json` file directly to a private repository or Gist using the **GitHub Contents API** or **GitHub Gist API** authenticated with a Fine-Grained Personal Access Token:

```js
import { registerCloudAdapter } from './src/services/storage.js';

registerCloudAdapter({
  async save(state) {
    // Persist JSON.stringify(state) to GitHub Contents API / Gist API
    // using a Fine-Grained Personal Access Token
  },
  subscribe(onRemoteState) {
    // Optionally poll or listen for remote updates and call onRemoteState(parsedJson)
    return () => {};
  },
});
```

## Architecture & Project Roadmap

- **[`AGENTS.md`](AGENTS.md)** — Module map, calculation/state invariants, and development workflow for maintainers and AI coding agents.
- **[`docs/ROADMAP.md`](docs/ROADMAP.md)** — Shipped milestones, upcoming roadmap (`grades.json` GitHub sync, sub-assessments, PWA, degree progress), and recorded architectural decisions.

