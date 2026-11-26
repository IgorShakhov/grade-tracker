import { useState } from 'react';
import { formatLastUpdated } from '../domain/calculations.js';

function GoogleMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 48 48"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function CloudSyncModal({
  syncSnapshot,
  onSignIn,
  onSignOut,
  onSyncNow,
  onDeleteCloudData,
  onClose,
}) {
  const [busyAction, setBusyAction] = useState(null);
  const [localError, setLocalError] = useState('');
  const [confirmingCloudDelete, setConfirmingCloudDelete] = useState(false);

  const user = syncSnapshot?.user;
  const isSignedIn = Boolean(user);

  async function runAction(label, fn) {
    setLocalError('');
    setBusyAction(label);
    try {
      await fn();
    } catch (err) {
      setLocalError(err?.message || 'Action could not be completed.');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        style={{ maxWidth: '460px' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-sync-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="cloud-sync-modal-title">
            {isSignedIn ? 'Google Cloud Sync' : 'Sign In to Sync'}
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close account dialog"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          {(localError || syncSnapshot?.error) && (
            <p style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>
              {localError || syncSnapshot.error}
            </p>
          )}

          {!isSignedIn ? (
            <>
              <p>
                Sign in with your Google account to automatically keep your courses
                and grades synced across your laptop, phone, and tablet.
              </p>

              <button
                id="google-sign-in-btn"
                type="button"
                className="btn btn-google-signin"
                disabled={busyAction !== null}
                onClick={() => runAction('signin', onSignIn)}
              >
                <GoogleMark />
                <span>
                  {busyAction === 'signin' ? 'Signing in…' : 'Sign in with Google'}
                </span>
              </button>

              <div className="sync-help-box" style={{ marginTop: '0.95rem', marginBottom: 0 }}>
                <strong>Privacy &amp; Offline Access:</strong> Your courses are saved
                privately to your account and cached locally so the app works
                offline. Signing out clears cached grades from this browser.
              </div>
            </>
          ) : (
            <>
              <div className="sync-connected-box">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.6rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <strong>{user.email || user.displayName || 'Google Account'}</strong>
                    <div style={{ fontSize: '0.75rem', opacity: 0.88 }}>
                      {syncSnapshot.lastSyncedAt
                        ? `Last synced: ${formatLastUpdated(syncSnapshot.lastSyncedAt)}`
                        : 'Connected to Cloud Sync'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      id="sync-now-btn"
                      type="button"
                      className="btn btn-sm"
                      disabled={
                        busyAction !== null || syncSnapshot.status === 'syncing'
                      }
                      onClick={() => runAction('sync', onSyncNow)}
                    >
                      {busyAction === 'sync' || syncSnapshot.status === 'syncing'
                        ? 'Syncing…'
                        : '↻ Sync Now'}
                    </button>
                    <button
                      id="sign-out-btn"
                      type="button"
                      className="btn btn-sm"
                      disabled={busyAction !== null}
                      onClick={() => runAction('signout', onSignOut)}
                    >
                      {busyAction === 'signout' ? 'Signing out…' : 'Sign Out'}
                    </button>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: '0.78rem', marginBottom: '0.9rem' }}>
                Signing out clears cached grades from this browser while keeping your
                courses safely stored in your Google cloud account.
              </p>

              <div className="data-action-row">
                <div className="data-action-info">
                  <strong>Delete Cloud Data</strong>
                  <span>
                    Permanently erase saved cloud courses and revoke any live share
                    link
                  </span>
                </div>
                {!confirmingCloudDelete ? (
                  <button
                    id="request-delete-cloud-btn"
                    type="button"
                    className="btn btn-sm"
                    disabled={busyAction !== null}
                    onClick={() => setConfirmingCloudDelete(true)}
                  >
                    Delete…
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busyAction !== null}
                      onClick={() => setConfirmingCloudDelete(false)}
                    >
                      Cancel
                    </button>
                    <button
                      id="confirm-delete-cloud-btn"
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busyAction !== null}
                      onClick={() => runAction('delete-cloud', onDeleteCloudData)}
                    >
                      {busyAction === 'delete-cloud' ? 'Deleting…' : 'Confirm Erase'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          <div
            className="modal-footer-btns"
            style={{ justifyContent: 'flex-end', marginTop: '0.95rem' }}
          >
            <button type="button" className="btn btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SyncConflictModal({
  conflict,
  localState,
  onKeepLocal,
  onUseRemote,
  onClose,
}) {
  const isAccountSwitch = conflict?.reason === 'account-switch';
  const remoteState = conflict?.remoteState || null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        style={{ maxWidth: '470px' }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sync-conflict-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="sync-conflict-title">
            {isAccountSwitch
              ? 'Different Google Account Detected'
              : 'Cloud Sync Version Conflict'}
          </h2>
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
          {isAccountSwitch ? (
            <>
              <p>
                This browser had local data from another session. To protect privacy,
                existing browser data is never uploaded into a different Google
                account automatically.
              </p>

              <div className="data-actions-grid" style={{ marginBottom: '0.6rem' }}>
                <div className="data-action-row">
                  <div className="data-action-info">
                    <strong>
                      {remoteState
                        ? 'Load This Account’s Cloud Courses'
                        : 'Start Fresh for This Account'}
                    </strong>
                    <span>
                      {remoteState
                        ? `Cloud updated: ${formatLastUpdated(remoteState.lastUpdated)}`
                        : 'Discard previous browser data and start a clean tracker'}
                    </span>
                  </div>
                  <button
                    id="resolve-use-remote-btn"
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={onUseRemote}
                  >
                    {remoteState ? 'Load Cloud' : 'Start Fresh'}
                  </button>
                </div>

                <div className="data-action-row">
                  <div className="data-action-info">
                    <strong>Import Browser Courses Into This Account</strong>
                    <span>
                      Updated locally: {formatLastUpdated(localState?.lastUpdated)}
                    </span>
                  </div>
                  <button
                    id="resolve-keep-local-btn"
                    type="button"
                    className="btn btn-sm"
                    onClick={onKeepLocal}
                  >
                    Keep Local
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p>
                {conflict?.reason === 'initial-merge'
                  ? 'Your Google account already has saved courses in the cloud, and this browser also has local edits. Which version would you like to use?'
                  : 'Your courses were updated from another device while this browser had unsynced changes. Which version would you like to keep?'}
              </p>

              <div className="data-actions-grid" style={{ marginBottom: '0.6rem' }}>
                <div className="data-action-row">
                  <div className="data-action-info">
                    <strong>Cloud Version</strong>
                    <span>
                      Updated: {formatLastUpdated(remoteState?.lastUpdated)}
                    </span>
                  </div>
                  <button
                    id="resolve-use-remote-btn"
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={onUseRemote}
                  >
                    Load Cloud Version
                  </button>
                </div>

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
                    className="btn btn-sm"
                    onClick={onKeepLocal}
                  >
                    Keep This Device
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
