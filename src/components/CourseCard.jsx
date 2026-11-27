import { useState, useEffect, useMemo } from 'react';
import { UNIT_OPTIONS } from '../domain/constants.js';
import {
  calculateCourseStats,
  buildTargetOptions,
  formatPercent,
  formatGpa,
} from '../domain/calculations.js';
import { useDraftText } from './useDraftText.js';

const STRICT_DECIMAL_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

function parseDecimalInput(raw) {
  const normalized = String(raw ?? '')
    .trim()
    .replace(/%$/, '')
    .trim()
    .replace(',', '.');
  if (normalized === '') {
    return { kind: 'empty', value: null };
  }
  if (!STRICT_DECIMAL_RE.test(normalized)) {
    return { kind: 'invalid', value: null };
  }
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0 || num > 1000) {
    return { kind: 'invalid', value: null };
  }
  return { kind: 'number', value: num === 0 ? 0 : num };
}

function areCellValuesEqual(a, b) {
  const normA = typeof a === 'number' && Number.isFinite(a) ? a : null;
  const normB = typeof b === 'number' && Number.isFinite(b) ? b : null;
  return normA === normB;
}

function NumericCellInput({
  value,
  placeholder = '—',
  disabled = false,
  isSimInput = false,
  ariaLabel,
  onCommit,
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() =>
    typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '',
  );

  useEffect(() => {
    if (!focused) {
      setDraft(
        typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '',
      );
    }
  }, [value, focused]);

  function handleChange(e) {
    const raw = e.target.value;
    setDraft(raw);
    const parsed = parseDecimalInput(raw);
    if (parsed.kind === 'empty') {
      if (!areCellValuesEqual(null, value)) {
        onCommit(null);
      }
      return;
    }
    if (parsed.kind === 'number' && !areCellValuesEqual(parsed.value, value)) {
      onCommit(parsed.value);
    }
  }

  function handleBlur() {
    setFocused(false);
    const parsed = parseDecimalInput(draft);
    if (parsed.kind === 'empty') {
      if (!areCellValuesEqual(null, value)) {
        onCommit(null);
      }
      setDraft('');
      return;
    }
    if (parsed.kind === 'number') {
      if (!areCellValuesEqual(parsed.value, value)) {
        onCommit(parsed.value);
      }
      setDraft(parsed.value.toFixed(2));
    } else {
      setDraft(
        typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '',
      );
    }
  }

  const isAbove100 =
    typeof value === 'number' && Number.isFinite(value) && value > 100;

  return (
    <input
      type="text"
      inputMode="decimal"
      className={`cell-input num-input ${isSimInput ? 'sim-input' : ''} ${
        isAbove100 ? 'cell-warn' : ''
      }`.trim()}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      title={
        isAbove100
          ? 'Above 100% — verify bonus credit or extra syllabus weight'
          : undefined
      }
      onFocus={(e) => {
        setFocused(true);
        e.target.select();
      }}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export default function CourseCard({
  course,
  courseIndex,
  totalCourses,
  terms,
  activeTermId,
  gradeScale,
  readOnly,
  simMode,
  simModifiedCatIds,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onUpdateCourse,
  onReorderCourse,
  onDuplicateCourse,
  onDeleteCourse,
  onMoveCourseToTerm,
  onAddCategory,
  onUpdateCategory,
  onReorderCategory,
  onDeleteCategory,
}) {
  const [confirmingCatId, setConfirmingCatId] = useState(null);

  useEffect(() => {
    if (!confirmingCatId) return undefined;
    const timer = setTimeout(() => setConfirmingCatId(null), 4500);
    return () => clearTimeout(timer);
  }, [confirmingCatId]);

  const codeDraft = useDraftText(course.code || 'COURSE', {
    onCommit: (nextCode) => onUpdateCourse({ code: nextCode }),
    fallbackOnEmpty: (initialOnFocus, currentCommitted) =>
      initialOnFocus || currentCommitted || 'COURSE',
  });

  const stats = calculateCourseStats(course, null, gradeScale);
  const targetPct =
    typeof course.targetPct === 'number' && Number.isFinite(course.targetPct)
      ? course.targetPct
      : 85;
  const targetOptions = useMemo(
    () => buildTargetOptions(gradeScale, targetPct),
    [gradeScale, targetPct],
  );

  const isCollapsed = Boolean(course.collapsed);
  const isPassFail = Boolean(course.passFail ?? course.creditNoCredit);
  const isFullYear = course.duration === 'full-year';
  const weightRounded = Math.round(stats.totalWeight * 100) / 100;
  const isWeightExact100 = Math.abs(weightRounded - 100) < 0.01;
  const gradedRatio =
    stats.totalWeight > 0
      ? Math.min(100, (stats.gradedWeight / stats.totalWeight) * 100)
      : 0;

  const otherTerms = terms.filter((t) => t.id !== activeTermId);
  const unitChoices = UNIT_OPTIONS.includes(course.units)
    ? UNIT_OPTIONS
    : [...UNIT_OPTIONS, course.units].sort((a, b) => a - b);

  return (
    <section
      className={`course-sheet ${isCollapsed ? 'is-collapsed' : ''} ${
        isDragging ? 'dragging' : ''
      } ${isDragOver ? 'drag-over' : ''}`}
      aria-label={`Course ${course.code}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Course Header Strip */}
      <div className="course-header">
        <div className="course-lead-controls">
          {!readOnly && totalCourses > 1 && (
            <span
              className="course-drag-handle"
              draggable
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              title="Drag to reorder course"
              aria-hidden="true"
            >
              ⋮⋮
            </span>
          )}

          <button
            type="button"
            className="icon-ctrl-btn"
            onClick={() => onUpdateCourse({ collapsed: !isCollapsed })}
            title={isCollapsed ? 'Expand course details' : 'Collapse course details'}
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${course.code}`}
          >
            <span className={`collapse-chevron ${isCollapsed ? 'collapsed' : ''}`}>
              ▼
            </span>
          </button>

          {!readOnly && totalCourses > 1 && (
            <>
              <button
                type="button"
                className="icon-ctrl-btn"
                disabled={courseIndex === 0}
                onClick={() => onReorderCourse(courseIndex, courseIndex - 1)}
                title="Move course up"
                aria-label={`Move ${course.code} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-ctrl-btn"
                disabled={courseIndex === totalCourses - 1}
                onClick={() => onReorderCourse(courseIndex, courseIndex + 1)}
                title="Move course down"
                aria-label={`Move ${course.code} down`}
              >
                ↓
              </button>
            </>
          )}
        </div>

        <div className="units-group">
          <label className="units-box" title="Course credit weight">
            <span className="units-label">Units</span>
            <select
              className="units-select"
              value={course.units}
              disabled={readOnly}
              aria-label={`${course.code} credit units`}
              onChange={(e) => onUpdateCourse({ units: Number(e.target.value) })}
            >
              {unitChoices.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className={`duration-badge ${isFullYear ? 'full-year' : ''}`}
            disabled={readOnly}
            onClick={() =>
              onUpdateCourse({ duration: isFullYear ? 'term' : 'full-year' })
            }
            title="Toggle between Single-Term and Full-Year duration tag"
          >
            {isFullYear ? 'Full Year' : 'Term'}
          </button>
        </div>

        <div className="course-title-group">
          <input
            type="text"
            className="course-code-input"
            value={codeDraft.value}
            disabled={readOnly}
            placeholder="COURSE"
            aria-label="Course code"
            onFocus={codeDraft.onFocus}
            onChange={codeDraft.onChange}
            onBlur={codeDraft.onBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
          />
          <input
            type="text"
            className="course-title-input"
            value={course.title || ''}
            disabled={readOnly}
            placeholder="Course title (optional)"
            aria-label={`${course.code} title`}
            onChange={(e) => onUpdateCourse({ title: e.target.value })}
          />
        </div>

        <div className="course-readout">
          <div className="readout-stat">
            <span className="readout-caption">Overall Grade</span>
            <span className="readout-num">{formatPercent(stats.overallGrade, 2)}</span>
          </div>

          <div className="readout-stat">
            <span className="readout-caption">Grade Point</span>
            <span className="readout-num">
              {stats.gpa !== null ? formatGpa(stats.gpa, 1) : '—'}
            </span>
          </div>

          <span className={`letter-badge ${stats.tier}`} title="Letter Grade">
            {stats.letter}
          </span>

          {!readOnly && (
            <div className="course-head-actions">
              <button
                type="button"
                className="course-action-btn"
                onClick={onDuplicateCourse}
                title="Duplicate course structure (copies categories & weights, clears grades)"
                aria-label={`Duplicate ${course.code}`}
              >
                ⧉
              </button>
              <button
                type="button"
                className="course-action-btn danger"
                onClick={onDeleteCourse}
                title="Delete course"
                aria-label={`Delete ${course.code}`}
              >
                ×
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Collapsible Body: Assessment Table + Footer */}
      {!isCollapsed && (
        <>
          {stats.categoryBreakdowns.length === 0 ? (
            <div className="empty-categories-msg">
              No assessment categories yet. Click <strong>+ Add Assessment</strong> below
              to add syllabus weights.
            </div>
          ) : (
            <table className="categories-table">
              <thead>
                <tr>
                  {!readOnly && (
                    <th scope="col" className="col-order">
                      <span className="sr-only">Order</span>
                    </th>
                  )}
                  <th scope="col">Category</th>
                  <th scope="col" className="col-num">
                    Weight
                  </th>
                  <th scope="col" className="col-num">
                    Grade
                  </th>
                  <th scope="col" className="col-contrib">
                    Earned
                  </th>
                  {!readOnly && (
                    <th scope="col" className="col-action">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {stats.categoryBreakdowns.map((cat, idx) => {
                  const isRowSimulated =
                    simMode && Boolean(simModifiedCatIds?.has(cat.id));
                  const isBlankInSim =
                    simMode && (cat.grade === null || cat.grade === undefined);

                  return (
                    <tr
                      key={cat.id}
                      className={isRowSimulated ? 'row-simulated' : ''}
                    >
                      {!readOnly && (
                        <td>
                          <span className="row-order-btns">
                            <button
                              type="button"
                              className="mini-arrow-btn"
                              disabled={idx === 0}
                              onClick={() => onReorderCategory(idx, idx - 1)}
                              title="Move row up"
                              aria-label={`Move ${cat.name} up`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="mini-arrow-btn"
                              disabled={idx === stats.categoryBreakdowns.length - 1}
                              onClick={() => onReorderCategory(idx, idx + 1)}
                              title="Move row down"
                              aria-label={`Move ${cat.name} down`}
                            >
                              ↓
                            </button>
                          </span>
                        </td>
                      )}

                      <td>
                        <input
                          type="text"
                          className="cell-input"
                          value={cat.name}
                          disabled={readOnly}
                          placeholder="Assessment name"
                          aria-label={`${course.code} category ${idx + 1} name`}
                          onChange={(e) =>
                            onUpdateCategory(cat.id, { name: e.target.value })
                          }
                        />
                      </td>

                      <td>
                        <NumericCellInput
                          value={cat.weight}
                          placeholder="0.00"
                          disabled={readOnly}
                          ariaLabel={`${course.code} ${cat.name} weight percent`}
                          onCommit={(val) =>
                            onUpdateCategory(cat.id, { weight: val ?? 0 })
                          }
                        />
                      </td>

                      <td>
                        <NumericCellInput
                          value={cat.grade}
                          placeholder={simMode ? 'What-if %' : '—'}
                          disabled={readOnly}
                          isSimInput={isRowSimulated || isBlankInSim}
                          ariaLabel={`${course.code} ${cat.name} grade percent`}
                          onCommit={(val) => {
                            if (!readOnly) {
                              onUpdateCategory(cat.id, { grade: val });
                            }
                          }}
                        />
                      </td>

                      <td className="contrib-cell">
                        {cat.contribution !== null
                          ? `${cat.contribution.toFixed(2)}%`
                          : '—'}
                      </td>

                      {!readOnly && (
                        <td style={{ textAlign: 'right' }}>
                          {confirmingCatId === cat.id ? (
                            <span className="inline-confirm-wrap">
                              <button
                                type="button"
                                className="inline-confirm-btn"
                                onClick={() => {
                                  setConfirmingCatId(null);
                                  onDeleteCategory(cat.id, cat.name);
                                }}
                                aria-label={`Confirm delete ${cat.name}`}
                              >
                                Delete?
                              </button>
                              <button
                                type="button"
                                className="inline-cancel-btn"
                                onClick={() => setConfirmingCatId(null)}
                                title="Cancel"
                                aria-label={`Cancel delete ${cat.name}`}
                              >
                                ×
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="row-delete-btn"
                              onClick={() => setConfirmingCatId(cat.id)}
                              title="Delete assessment row"
                              aria-label={`Delete ${cat.name}`}
                            >
                              ×
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Course Footer */}
          <div className="course-footer">
            <div className="course-footer-left">
              {!readOnly && (
                <button
                  type="button"
                  className="add-row-btn"
                  onClick={onAddCategory}
                >
                  + Add Assessment
                </button>
              )}

              <span
                className={`weight-status ${!isWeightExact100 ? 'weight-warn' : ''}`}
              >
                <span className="tabular">
                  Weight: {weightRounded.toFixed(2)}%
                </span>
                <span>•</span>
                <span className="tabular">
                  {Math.round(stats.gradedWeight)}% graded
                </span>
                <span className="progress-mini" aria-hidden="true">
                  <span
                    className="progress-mini-fill"
                    style={{ width: `${gradedRatio}%` }}
                  />
                </span>
              </span>

              <label className="pf-toggle-label" title="Exclude course from GPA calculation">
                <input
                  type="checkbox"
                  checked={isPassFail}
                  disabled={readOnly}
                  onChange={(e) => onUpdateCourse({ passFail: e.target.checked })}
                />
                <span>Pass/Fail</span>
              </label>

              {!readOnly && otherTerms.length > 0 && (
                <select
                  className="move-term-select"
                  value=""
                  aria-label={`Move ${course.code} to another term`}
                  onChange={(e) => {
                    if (e.target.value) {
                      onMoveCourseToTerm(e.target.value);
                    }
                  }}
                >
                  <option value="">Move to term…</option>
                  {otherTerms.map((t) => (
                    <option key={t.id} value={t.id}>
                      → {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="course-footer-right">
              {stats.remainingWeight > 0 && (
                <div className="target-calculator">
                  <span>Target:</span>
                  <select
                    className="target-select"
                    value={targetPct}
                    disabled={readOnly}
                    aria-label={`${course.code} target grade`}
                    onChange={(e) =>
                      onUpdateCourse({ targetPct: Number(e.target.value) })
                    }
                  >
                    {targetOptions.map((p) => (
                      <option key={p.pct} value={p.pct}>
                        {p.label}
                      </option>
                    ))}
                  </select>

                  {stats.targetStatus === 'achievable' && (
                    <span className="target-result">
                      Need{' '}
                      <strong>
                        {formatPercent(stats.requiredOnRemaining, 1)}
                      </strong>{' '}
                      on remaining {Math.round(stats.remainingWeight)}%
                    </span>
                  )}

                  {stats.targetStatus === 'secured' && (
                    <span className="target-result secured">
                      <strong>Target secured</strong> (even at 0% remaining)
                    </span>
                  )}

                  {stats.targetStatus === 'unreachable' && (
                    <span className="target-result unreachable">
                      Needs{' '}
                      <strong>
                        {formatPercent(stats.requiredOnRemaining, 1)}
                      </strong>{' '}
                      (max {formatPercent(stats.maxPossible, 1)})
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
