import { useState, useRef } from 'react';
import { DEFAULT_GRADE_SCALE } from '../domain/constants.js';

export function ShareModal({ shareUrl, onClose, onCopy }) {
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
          <h2 id="share-modal-title">Share Read-Only Snapshot Link</h2>
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
          <p>
            Anyone with this link can view a read-only snapshot of your current
            courses and grades on any device without changing your saved data.
          </p>

          <div className="share-url-row">
            <input
              id="share-url-input"
              type="text"
              className="share-url-input"
              value={shareUrl}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <button
              id="copy-share-url-btn"
              type="button"
              className="btn btn-primary"
              onClick={onCopy}
            >
              Copy Link
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DataModal({
  readOnly,
  onClose,
  onExportJson,
  onExportCsv,
  onImportJsonFile,
  onLoadSample,
  onResetEmpty,
}) {
  const fileInputRef = useRef(null);
  const [importError, setImportError] = useState('');

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    try {
      const text = await file.text();
      onImportJsonFile(text);
      onClose();
    } catch (err) {
      setImportError(err.message || 'Could not import JSON file.');
    } finally {
      e.target.value = '';
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="data-modal-title">Backups, Export &amp; Templates</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close data dialog"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <p>
            Export your tracker for backup or Microsoft Excel, or import an existing{' '}
            <code>.json</code> grade file.
          </p>

          {importError && (
            <p style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>{importError}</p>
          )}

          <div className="data-actions-grid">
            <div className="data-action-row">
              <div className="data-action-info">
                <strong>Export JSON Backup</strong>
                <span>Full tracker state including all terms and custom scale</span>
              </div>
              <button
                id="export-json-btn"
                type="button"
                className="btn btn-sm"
                onClick={onExportJson}
              >
                Download .json
              </button>
            </div>

            <div className="data-action-row">
              <div className="data-action-info">
                <strong>Export Spreadsheet CSV</strong>
                <span>UTF-8 CSV formatted cleanly for Microsoft Excel</span>
              </div>
              <button
                id="export-csv-btn"
                type="button"
                className="btn btn-sm"
                onClick={onExportCsv}
              >
                Download .csv
              </button>
            </div>

            {!readOnly && (
              <>
                <div className="data-action-row">
                  <div className="data-action-info">
                    <strong>Import JSON File</strong>
                    <span>Load a saved grade tracker JSON file</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                  <button
                    id="import-json-btn"
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose .json
                  </button>
                </div>

                <div className="data-action-row">
                  <div className="data-action-info">
                    <strong>Load Sample Courses</strong>
                    <span>Reset to realistic example courses to explore features</span>
                  </div>
                  <button
                    id="load-sample-btn"
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      onLoadSample();
                      onClose();
                    }}
                  >
                    Load Sample
                  </button>
                </div>

                <div className="data-action-row">
                  <div className="data-action-info">
                    <strong>Start Fresh (Blank Tracker)</strong>
                    <span>Clear all courses and begin with one clean starter course</span>
                  </div>
                  <button
                    id="reset-empty-btn"
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      onResetEmpty();
                      onClose();
                    }}
                  >
                    Start Fresh
                  </button>
                </div>
              </>
            )}
          </div>
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
