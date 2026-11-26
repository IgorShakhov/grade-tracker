import { useState, useEffect } from 'react';
import { DEFAULT_GRADE_SCALE } from '../domain/constants.js';

export function ShareModal({
  isSignedIn,
  liveShareUrl,
  snapshotUrl,
  onEnableOrRotateLiveShare,
  onDisableLiveShare,
  onCopyUrl,
  onOpenSignIn,
  onClose,
}) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  async function runShareOp(label, fn) {
    setError('');
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      setError(err?.message || 'Could not update live share link.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="share-modal-title">Share Read-Only View</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close share dialog"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <p style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>{error}</p>
          )}

          <div className="share-section-box">
            <div className="share-section-head">
              <strong>Live Auto-Updating Link</strong>
              {liveShareUrl && <span className="share-badge-active">Active</span>}
            </div>
            <p style={{ marginBottom: '0.65rem' }}>
              Anyone with this link always sees your latest synced grades in
              read-only mode — no sign-in required to view.
            </p>

            {!isSignedIn ? (
              <button
                id="share-signin-prompt-btn"
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  onClose();
                  onOpenSignIn();
                }}
              >
                Sign in with Google to Enable Live Link
              </button>
            ) : liveShareUrl ? (
              <>
                <div className="share-url-row" style={{ marginBottom: '0.5rem' }}>
                  <input
                    id="live-share-url-input"
                    type="text"
                    className="share-url-input"
                    value={liveShareUrl}
                    readOnly
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    id="copy-live-share-btn"
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() =>
                      onCopyUrl(liveShareUrl, 'Live read-only link copied.')
                    }
                  >
                    Copy Live Link
                  </button>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span className="sync-field-hint">
                    Rotating or turning off revokes future access via the current
                    link.
                  </span>
                  <div style={{ display: 'flex', gap: '0.38rem' }}>
                    <button
                      id="rotate-live-share-btn"
                      type="button"
                      className="btn btn-sm"
                      disabled={busy !== null}
                      onClick={() =>
                        runShareOp('rotate', () => onEnableOrRotateLiveShare(true))
                      }
                    >
                      {busy === 'rotate' ? 'Rotating…' : 'Rotate Link'}
                    </button>
                    <button
                      id="disable-live-share-btn"
                      type="button"
                      className="btn btn-sm"
                      disabled={busy !== null}
                      onClick={() => runShareOp('disable', onDisableLiveShare)}
                    >
                      {busy === 'disable' ? 'Turning off…' : 'Turn Off'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <button
                id="enable-live-share-btn"
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy !== null}
                onClick={() =>
                  runShareOp('enable', () => onEnableOrRotateLiveShare(false))
                }
              >
                {busy === 'enable' ? 'Creating link…' : 'Enable Live Read-Only Link'}
              </button>
            )}
          </div>

          {snapshotUrl && (
            <div className="share-section-box" style={{ marginBottom: 0 }}>
              <div className="share-section-head">
                <strong>One-Time Point-in-Time Snapshot</strong>
              </div>
              <p style={{ marginBottom: '0.6rem' }}>
                Self-contained URL frozen at your current grades right now (works
                even without cloud sync).
              </p>
              <div className="share-url-row" style={{ marginBottom: 0 }}>
                <input
                  id="share-url-input"
                  type="text"
                  className="share-url-input"
                  value={snapshotUrl}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
                <button
                  id="copy-share-url-btn"
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    onCopyUrl(
                      snapshotUrl,
                      'Point-in-time snapshot link copied.',
                    )
                  }
                >
                  Copy Snapshot
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ScaleEditorModal({ gradeScale, onSaveScale, onClose }) {
  const [rows, setRows] = useState(() =>
    gradeScale.map((r) => ({
      min: String(r.min),
      max: String(r.max),
      letter: r.letter,
      gpa: String(r.gpa),
    })),
  );
  const [error, setError] = useState('');

  function updateRow(idx, field, val) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
  }

  function addBand() {
    setRows((prev) => [...prev, { min: '0', max: '49', letter: 'F', gpa: '0.0' }]);
  }

  function removeBand(idx) {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function resetDefault() {
    setRows(
      DEFAULT_GRADE_SCALE.map((r) => ({
        min: String(r.min),
        max: String(r.max),
        letter: r.letter,
        gpa: String(r.gpa),
      })),
    );
    setError('');
  }

  function handleSave() {
    const parsed = [];
    for (let i = 0; i < rows.length; i += 1) {
      const min = Number(rows[i].min);
      const max = Number(rows[i].max);
      const gpa = Number(rows[i].gpa);
      const letter = rows[i].letter.trim();
      if (
        !letter ||
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        !Number.isFinite(gpa) ||
        min < 0 ||
        max > 100 ||
        min > max ||
        gpa < 0 ||
        gpa > 10
      ) {
        setError(`Row ${i + 1} has invalid values (ensure 0 <= Min <= Max <= 100 and a valid GPA).`);
        return;
      }
      const tier =
        gpa >= 3.7
          ? 'tier-a'
          : gpa >= 2.7
            ? 'tier-b'
            : gpa >= 1.7
              ? 'tier-c'
              : gpa >= 0.7
                ? 'tier-d'
                : 'tier-f';
      parsed.push({
        min,
        max,
        rangeLabel: `${min}–${max}%`,
        letter,
        gpa,
        tier,
      });
    }
    parsed.sort((a, b) => b.min - a.min);
    onSaveScale(parsed);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scale-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="scale-modal-title">Customize Grading Scale</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close grading scale editor"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <p>
            Configure the percentage thresholds, letter grades, and GPA points used
            for your courses.
          </p>

          {error && (
            <p style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>{error}</p>
          )}

          <table className="scale-editor-table">
            <thead>
              <tr>
                <th>Min %</th>
                <th>Max %</th>
                <th>Letter</th>
                <th>GPA</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      type="number"
                      className="scale-editor-input"
                      value={r.min}
                      onChange={(e) => updateRow(idx, 'min', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="scale-editor-input"
                      value={r.max}
                      onChange={(e) => updateRow(idx, 'max', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="scale-editor-input"
                      value={r.letter}
                      onChange={(e) => updateRow(idx, 'letter', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.1"
                      className="scale-editor-input"
                      value={r.gpa}
                      onChange={(e) => updateRow(idx, 'gpa', e.target.value)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="term-mini-btn"
                      disabled={rows.length <= 1}
                      onClick={() => removeBand(idx)}
                      title="Remove band"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="modal-footer-btns">
            <div style={{ display: 'flex', gap: '0.45rem' }}>
              <button type="button" className="btn btn-sm" onClick={addBand}>
                + Add Band
              </button>
              <button type="button" className="btn btn-sm" onClick={resetDefault}>
                Reset Default 4.0
              </button>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSave}>
              Save Scale
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDeleteModal({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onClose,
}) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onConfirm, onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        style={{ maxWidth: '420px' }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="confirm-delete-title">{title}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Cancel deletion"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <p>{message}</p>
          <div className="modal-footer-btns" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              id="confirm-delete-btn"
              type="button"
              className="btn btn-danger btn-sm"
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
