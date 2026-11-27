import { useState, useEffect, useMemo } from 'react';
import { DEFAULT_GRADE_SCALE, MAX_GPA_POINTS } from '../domain/constants.js';
import { deriveTierFromGpa } from '../domain/calculations.js';

const SCALE_DECIMAL_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

function parseScaleNumber(raw) {
  const normalized = String(raw ?? '').trim().replace(',', '.');
  if (normalized === '' || !SCALE_DECIMAL_RE.test(normalized)) {
    return NaN;
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? (num === 0 ? 0 : num) : NaN;
}

export function ShareModal({
  isSignedIn,
  isSharedReadOnly = false,
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

  function handleDismiss() {
    if (busy !== null) return;
    onClose();
  }

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && busy === null) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop" onClick={handleDismiss}>
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
            disabled={busy !== null}
            onClick={handleDismiss}
            aria-label="Close share dialog"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <p style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>{error}</p>
          )}

          {!isSharedReadOnly && (
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
                  {busy === 'enable'
                    ? 'Creating link…'
                    : 'Enable Live Read-Only Link'}
                </button>
              )}
            </div>
          )}

          {snapshotUrl ? (
            <div className="share-section-box" style={{ marginBottom: 0 }}>
              <div className="share-section-head">
                <strong>One-Time Point-in-Time Snapshot</strong>
              </div>
              <p style={{ marginBottom: '0.6rem' }}>
                {isSharedReadOnly
                  ? 'Self-contained URL frozen at the shared grades currently shown on screen.'
                  : 'Self-contained URL frozen at your current grades right now (works even without cloud sync).'}
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
          ) : (
            isSharedReadOnly && (
              <p style={{ marginBottom: 0 }}>
                Could not generate a snapshot link for this view.
              </p>
            )
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

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function updateRow(idx, field, val) {
    setError('');
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
  }

  function addBand() {
    setError('');
    setRows((prev) => [...prev, { min: '0', max: '49', letter: 'F', gpa: '0.0' }]);
  }

  function removeBand(idx) {
    if (rows.length <= 1) return;
    setError('');
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

  const gapWarning = useMemo(() => {
    const valid = [];
    for (const row of rows) {
      const min = parseScaleNumber(row.min);
      const max = parseScaleNumber(row.max);
      const gpa = parseScaleNumber(row.gpa);
      const letter = String(row.letter ?? '').trim();
      if (
        !letter ||
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        !Number.isFinite(gpa) ||
        min < 0 ||
        max > 100 ||
        min > max
      ) {
        return '';
      }
      valid.push({ min, max, letter });
    }
    if (valid.length === 0) return '';
    valid.sort((a, b) => a.min - b.min);
    const hasDecimalBounds = valid.some(
      (b) => !Number.isInteger(b.min) || !Number.isInteger(b.max),
    );
    const maxAllowedGap = hasDecimalBounds ? 0.1 + 1e-9 : 1;
    for (let i = 0; i < valid.length - 1; i += 1) {
      if (valid[i].max >= valid[i + 1].min) {
        return '';
      }
      if (valid[i + 1].min - valid[i].max > maxAllowedGap) {
        return `Note: Percentage gap between ${valid[i].max}% and ${valid[i + 1].min}% — scores in that range will fall into "${valid[i].letter}".`;
      }
    }
    if (valid[valid.length - 1].max < 100) {
      return `Note: Highest Max % is ${valid[valid.length - 1].max}% (below 100%).`;
    }
    return '';
  }, [rows]);

  function handleSave() {
    const parsed = [];
    for (let i = 0; i < rows.length; i += 1) {
      const min = parseScaleNumber(rows[i].min);
      const max = parseScaleNumber(rows[i].max);
      const gpa = parseScaleNumber(rows[i].gpa);
      const letter = String(rows[i].letter ?? '').trim();
      if (
        !letter ||
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        !Number.isFinite(gpa) ||
        min < 0 ||
        max > 100 ||
        min > max ||
        gpa < 0 ||
        gpa > MAX_GPA_POINTS
      ) {
        setError(
          `Row ${i + 1} has invalid or blank values (ensure non-empty Letter, 0 <= Min <= Max <= 100, and 0 <= GPA <= ${MAX_GPA_POINTS}).`,
        );
        return;
      }
      parsed.push({
        min,
        max,
        rangeLabel: `${min}–${max}%`,
        boundLabel: `${max}%`,
        letter,
        gpa,
        tier: deriveTierFromGpa(gpa),
      });
    }

    const asc = [...parsed].sort((a, b) => a.min - b.min || a.max - b.max);
    const seenMins = new Set();
    for (const band of asc) {
      if (seenMins.has(band.min)) {
        setError(
          `Duplicate Min % threshold (${band.min}%). Every grade band must have a unique minimum percentage.`,
        );
        return;
      }
      seenMins.add(band.min);
    }

    for (let i = 0; i < asc.length - 1; i += 1) {
      if (asc[i].max >= asc[i + 1].min) {
        setError(
          `Bands "${asc[i].letter}" (${asc[i].min}–${asc[i].max}%) and "${asc[i + 1].letter}" (${asc[i + 1].min}–${asc[i + 1].max}%) overlap.`,
        );
        return;
      }
    }

    if (!asc.some((band) => band.min === 0)) {
      setError(
        'Include a 0% floor band (e.g., 0–49% F with 0.0 GPA) so failing percentages are mapped cleanly.',
      );
      return;
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
            <p role="alert" style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>
              {error}
            </p>
          )}

          {!error && gapWarning && (
            <p style={{ color: 'var(--warn-fg, #92400e)', fontWeight: 500 }}>
              {gapWarning}
            </p>
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
                      step="any"
                      className="scale-editor-input"
                      value={r.min}
                      onChange={(e) => updateRow(idx, 'min', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
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
                      step="any"
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
      } else if (e.key === 'Enter' && !e.repeat) {
        const targetEl =
          e.target instanceof Element ? e.target : document.activeElement;
        const modalBtn = targetEl?.closest?.('.modal-panel button');
        if (modalBtn && modalBtn.id !== 'confirm-delete-btn') {
          return;
        }
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
