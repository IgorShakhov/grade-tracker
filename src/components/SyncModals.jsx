import { useState } from 'react';
import {
  DEFAULT_SYNC_BRANCH,
  generateProfileId,
  inferRepoFromLocation,
  buildLiveProfileUrl,
} from '../services/githubSync.js';
import { formatLastUpdated } from '../domain/calculations.js';

export function CloudSyncModal({
  syncSnapshot,
  initialPrefill = null,
  onConnect,
  onDisconnect,
  onSyncNow,
  onCopyLiveUrl,
  onClose,
}) {
  const cfg = syncSnapshot?.config || {};
  const inferredRepo =
    typeof window !== 'undefined' ? inferRepoFromLocation(window.location) : '';

  const [repo, setRepo] = useState(
    () => initialPrefill?.repo || cfg.repo || inferredRepo || '',
  );
  const [branch, setBranch] = useState(
    () => initialPrefill?.branch || cfg.branch || DEFAULT_SYNC_BRANCH,
  );
  const [profileId, setProfileId] = useState(
    () => initialPrefill?.profileId || cfg.profileId || generateProfileId(),
  );
  const [token, setToken] = useState(() => cfg.token || '');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  const isConnected = Boolean(cfg.enabled && cfg.token);
  const liveUrl =
    typeof window !== 'undefined' && profileId.trim()
      ? buildLiveProfileUrl(window.location.href, {
          profileId: profileId.trim(),
          repo: repo.trim(),
          branch: branch.trim() || DEFAULT_SYNC_BRANCH,
        })
      : '';

  async function handleConnectSubmit(e) {
    e.preventDefault();
    setLocalError('');
    if (!repo.trim() || !repo.includes('/')) {
      setLocalError('Enter a valid GitHub repository in owner/repo format.');
      return;
    }
    if (!profileId.trim()) {
      setLocalError('Enter or generate a Profile ID.');
      return;
    }
    if (!token.trim()) {
      setLocalError('Paste a GitHub Fine-Grained Personal Access Token to enable saving.');
      return;
    }

    setBusy(true);
    try {
      await onConnect({
        repo: repo.trim(),
        branch: branch.trim() || DEFAULT_SYNC_BRANCH,
        profileId: profileId.trim(),
        token: token.trim(),
      });
    } catch (err) {
      setLocalError(err.message || 'Could not connect to GitHub.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-sync-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="cloud-sync-modal-title">GitHub Cloud Sync</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close cloud sync dialog"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <p>
            Sync your courses automatically across devices via a dedicated{' '}
            <code>{branch || DEFAULT_SYNC_BRANCH}</code> branch on GitHub while
            keeping instant offline <code>localStorage</code> speed.
          </p>

          {isConnected && (
            <div className="sync-connected-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div>
                  <strong>
                    Connected: {cfg.repo} ({cfg.branch})
                  </strong>
                  <div style={{ fontSize: '0.74rem', opacity: 0.88 }}>
                    File: <code>data/{cfg.profileId}.json</code>
                    {cfg.lastSyncedAt
                      ? ` • Last synced: ${formatLastUpdated(cfg.lastSyncedAt)}`
                      : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button
                    id="sync-now-btn"
                    type="button"
                    className="btn btn-sm"
                    disabled={syncSnapshot.status === 'syncing'}
                    onClick={onSyncNow}
                  >
                    {syncSnapshot.status === 'syncing' ? 'Syncing…' : '↻ Sync Now'}
                  </button>
                  <button
                    id="disconnect-sync-btn"
                    type="button"
                    className="btn btn-sm"
                    onClick={onDisconnect}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            </div>
          )}

          {isConnected && liveUrl && (
            <div className="sync-field" style={{ marginBottom: '0.95rem' }}>
              <label htmlFor="live-profile-url-input">
                Live Read-Only View Link (No Token Needed to View)
              </label>
              <div className="share-url-row" style={{ marginBottom: '0.2rem' }}>
                <input
                  id="live-profile-url-input"
                  type="text"
                  className="share-url-input"
                  value={liveUrl}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
                <button
                  id="copy-live-url-btn"
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => onCopyLiveUrl(liveUrl)}
                >
                  Copy Live Link
                </button>
              </div>
              <span className="sync-field-hint">
                Bookmark this URL on any phone or share with family — it always
                loads the latest synced grades directly from GitHub.
              </span>
            </div>
          )}

          {(localError || syncSnapshot?.error) && (
            <p style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>
              {localError || syncSnapshot.error}
            </p>
          )}

          <form onSubmit={handleConnectSubmit}>
            <div className="sync-form-grid">
              <div className="sync-field">
                <label htmlFor="sync-repo-input">GitHub Repository (owner/repo)</label>
                <input
                  id="sync-repo-input"
                  type="text"
                  className="sync-text-input"
                  placeholder="username/grade-tracker"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: '0.6rem' }}>
                <div className="sync-field">
                  <label htmlFor="sync-profile-input">Profile ID</label>
                  <div className="sync-input-row">
                    <input
                      id="sync-profile-input"
                      type="text"
                      className="sync-text-input"
                      value={profileId}
                      onChange={(e) => setProfileId(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setProfileId(generateProfileId())}
                      title="Generate a random anonymous Profile ID"
                    >
                      New ID
                    </button>
                  </div>
                  <span className="sync-field-hint">
                    Use the same Profile ID on your laptop &amp; phone to share one
                    profile.
                  </span>
                </div>

                <div className="sync-field">
                  <label htmlFor="sync-branch-input">Data Branch</label>
                  <input
                    id="sync-branch-input"
                    type="text"
                    className="sync-text-input"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                  />
                </div>
              </div>

              <div className="sync-field">
                <label htmlFor="sync-token-input">
                  Fine-Grained Personal Access Token
                </label>
                <input
                  id="sync-token-input"
                  type="password"
                  className="sync-text-input"
                  placeholder="github_pat_..."
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <span className="sync-field-hint">
                  Saved only in this browser&apos;s <code>localStorage</code> — never
                  included in shared links or exported files.
                </span>
              </div>
            </div>

            <div className="sync-help-box">
              <strong>One-Time GitHub Token Setup (~1 min):</strong>
              <ol>
                <li>
                  On GitHub, open <strong>Settings → Developer settings → Fine-grained tokens → Generate new token</strong>.
                </li>
                <li>
                  Under <strong>Repository access</strong>, select{' '}
                  <strong>Only select repositories</strong> and choose your{' '}
                  <code>grade-tracker</code> repo.
                </li>
                <li>
                  Under <strong>Repository permissions</strong>, set{' '}
                  <strong>Contents</strong> to <strong>Read and write</strong>, then
                  generate and paste above.
                </li>
              </ol>
            </div>

            <div className="modal-footer-btns" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-sm" onClick={onClose}>
                Close
              </button>
              <button
                id="connect-sync-submit-btn"
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={busy}
              >
                {busy
                  ? 'Connecting…'
                  : isConnected
                    ? 'Update Sync Settings'
                    : 'Connect & Sync'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export function SyncConflictModal({
  localState,
  remoteState,
  onKeepLocal,
  onUseRemote,
  onClose,
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        style={{ maxWidth: '460px' }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sync-conflict-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="sync-conflict-title">Cloud Sync Version Conflict</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close conflict dialog"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <p>
            Grades on GitHub were updated from another device while this browser had
            unsynced changes. Which version would you like to keep?
          </p>

          <div className="data-actions-grid" style={{ marginBottom: '0.9rem' }}>
            <div className="data-action-row">
              <div className="data-action-info">
                <strong>This Device&apos;s Version</strong>
                <span>
                  Updated: {formatLastUpdated(localState?.lastUpdated)}
                </span>
              </div>
              <button
                id="resolve-keep-local-btn"
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onKeepLocal}
              >
                Keep This Device
              </button>
            </div>

            <div className="data-action-row">
              <div className="data-action-info">
                <strong>GitHub Cloud Version</strong>
                <span>
                  Updated: {formatLastUpdated(remoteState?.lastUpdated)}
                </span>
              </div>
              <button
                id="resolve-use-remote-btn"
                type="button"
                className="btn btn-sm"
                onClick={onUseRemote}
              >
                Load Cloud Version
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
