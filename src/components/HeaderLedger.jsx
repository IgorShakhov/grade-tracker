import { formatGpa, formatPercent, formatLastUpdated } from '../domain/calculations.js';
import { useDraftText } from './useDraftText.js';

function getSyncLabel(readOnlyMode, syncSnapshot) {
  if (readOnlyMode === 'live-share') {
    return { text: 'Live Shared View (Read-Only)', dotClass: 'status-synced' };
  }
  if (readOnlyMode === 'snapshot') {
    return { text: 'Read-Only Shared Snapshot', dotClass: 'status-synced' };
  }

  const status = syncSnapshot?.status;
  switch (status) {
    case 'synced':
      return { text: 'Synced with Google', dotClass: 'status-synced' };
    case 'syncing':
      return { text: 'Syncing…', dotClass: 'status-syncing' };
    case 'pending':
      return { text: 'Saving to cloud…', dotClass: 'status-pending' };
    case 'offline':
      return { text: 'Offline · Saved locally', dotClass: 'status-offline' };
    case 'conflict':
      return { text: 'Sync conflict — click to resolve', dotClass: 'status-conflict' };
    case 'error':
      return { text: 'Sync issue — click for details', dotClass: 'status-error' };
    default:
      return { text: 'Local only · Sign in to sync', dotClass: 'status-disconnected' };
  }
}

export default function HeaderLedger({
  studentName,
  lastUpdated,
  readOnly,
  readOnlyMode,
  syncSnapshot,
  simMode,
  simCount,
  stats,
  hasMultipleTerms,
  activeTermName,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onChangeName,
  onToggleSimMode,
  onOpenSync,
  onOpenShare,
}) {
  const { overall, termStats } = stats;
  const ownerDraft = useDraftText(studentName || 'My', {
    onCommit: onChangeName,
    fallbackOnEmpty: 'My',
  });
  const displayedOwner = ownerDraft.value;
  const possessiveTitle =
    !displayedOwner.trim() || displayedOwner.trim().toLowerCase() === 'my'
      ? 'Grade Tracker'
      : "'s Grade Tracker";

  const syncInfo = getSyncLabel(readOnlyMode, syncSnapshot);
  const isSignedIn = Boolean(syncSnapshot?.user);

  return (
    <header className="site-header">
      <div className="header-inner">
        <div className="header-top-row">
          <div className="brand-group">
            <div className="brand-mark" aria-hidden="true">
              GT
            </div>
            <div className="title-stack">
              <h1>
                <input
                  id="owner-name-input"
                  type="text"
                  className="owner-name-input"
                  value={displayedOwner}
                  disabled={readOnly}
                  aria-label="Tracker owner or label"
                  size={Math.max(2, (displayedOwner || 'My').length)}
                  onFocus={ownerDraft.onFocus}
                  onChange={ownerDraft.onChange}
                  onBlur={ownerDraft.onBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                  }}
                />
                <span>{possessiveTitle}</span>
              </h1>
              <p className="meta-subtitle">
                <span>Last Update: {formatLastUpdated(lastUpdated)}</span>
                <span className="meta-dot">•</span>
                <button
                  id="sync-status-pill-btn"
                  type="button"
                  className="sync-pill-btn"
                  onClick={onOpenSync}
                  title="Google Account & Multi-Device Sync"
                >
                  <span
                    className={`sync-indicator ${syncInfo.dotClass}`}
                    aria-hidden="true"
                  />
                  <span>{syncInfo.text}</span>
                </button>
              </p>
            </div>
          </div>

          <div className="toolbar-actions">
            {!readOnly && (
              <div className="undo-redo-group" role="group" aria-label="History controls">
                <button
                  id="undo-btn"
                  type="button"
                  className="btn btn-sm"
                  disabled={!canUndo}
                  onClick={onUndo}
                  title="Undo last change (Ctrl/Cmd+Z)"
                >
                  ↶ Undo
                </button>
                <button
                  id="redo-btn"
                  type="button"
                  className="btn btn-sm"
                  disabled={!canRedo}
                  onClick={onRedo}
                  title="Redo change (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
                >
                  ↷ Redo
                </button>
              </div>
            )}

            <button
              id="toggle-sim-btn"
              type="button"
              className={`btn ${simMode ? 'btn-sim-active' : ''}`}
              onClick={onToggleSimMode}
              title="Test hypothetical scores in a sandbox without overwriting saved grades"
            >
              {simMode
                ? `What-If Active${simCount > 0 ? ` (${simCount})` : ''}`
                : 'What-If Simulator'}
            </button>

            <button
              id="open-sync-btn"
              type="button"
              className="btn"
              onClick={onOpenSync}
            >
              {isSignedIn ? 'Account' : 'Sign In'}
            </button>

            <button
              id="open-share-btn"
              type="button"
              className="btn btn-primary"
              onClick={onOpenShare}
            >
              Share
            </button>
          </div>
        </div>

        <div className="metrics-strip" role="region" aria-label="GPA and Grade Summary">
          <div className="metric-item metric-highlight">
            <span className="metric-label">Cumulative GPA</span>
            <div className="metric-value-row">
              <span id="cumulative-gpa-value" className="metric-value">
                {formatGpa(overall.cumulativeGpa, 1)}
              </span>
              {overall.cumulativeGpa !== null && (
                <span className="metric-sub tabular">
                  ({formatGpa(overall.cumulativeGpa, 2)})
                </span>
              )}
            </div>
          </div>

          <div className="metric-item">
            <span className="metric-label">
              {hasMultipleTerms ? `${activeTermName} GPA` : 'Weighted Average'}
            </span>
            <div className="metric-value-row">
              <span id="secondary-metric-value" className="metric-value">
                {hasMultipleTerms
                  ? formatGpa(termStats.cumulativeGpa, 1)
                  : formatPercent(overall.weightedAverage, 2)}
              </span>
              {hasMultipleTerms && overall.weightedAverage !== null && (
                <span className="metric-sub tabular">
                  Avg {formatPercent(overall.weightedAverage, 1)}
                </span>
              )}
            </div>
          </div>

          <div className="metric-item">
            <span className="metric-label">Enrolled Credits</span>
            <div className="metric-value-row">
              <span id="enrolled-units-value" className="metric-value">
                {overall.totalUnitsEnrolled.toFixed(
                  Number.isInteger(overall.totalUnitsEnrolled) ? 1 : 2,
                )}
              </span>
              <span className="metric-sub">units total</span>
            </div>
          </div>

          <div className="metric-item">
            <span className="metric-label">Syllabus Graded</span>
            <div className="metric-value-row">
              <span id="completion-pct-value" className="metric-value">
                {formatPercent(overall.completionPct, 0)}
              </span>
              <span className="metric-sub">across courses</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
