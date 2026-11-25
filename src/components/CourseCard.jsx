import { useState, useEffect } from 'react';
import { UNIT_OPTIONS, TARGET_PRESETS } from '../domain/constants.js';
import {
  calculateCourseStats,
  calculateTargetRequirement,
  formatPercent,
  formatGpa,
} from '../domain/calculations.js';

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
    const trimmed = raw.trim().replace(/%$/, '');
    if (trimmed === '') {
      onCommit(null);
      return;
    }
    const num = Number(trimmed);
    if (Number.isFinite(num) && num >= 0 && num <= 1000) {
      onCommit(num);
    }
  }

  function handleBlur() {
    setFocused(false);
    const trimmed = draft.trim().replace(/%$/, '');
    if (trimmed === '') {
      onCommit(null);
      setDraft('');
      return;
    }
    const num = Number(trimmed);
    if (Number.isFinite(num) && num >= 0 && num <= 1000) {
      onCommit(num);
      setDraft(num.toFixed(2));
    } else {
      setDraft(
        typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '',
      );
    }
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      className={`cell-input num-input ${isSimInput ? 'sim-input' : ''}`}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
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
  simGrades,
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
  onUpdateSimGrade,
}) {
  const [confirmingCatId, setConfirmingCatId] = useState(null);

  useEffect(() => {
    if (!confirmingCatId) return undefined;
    const timer = setTimeout(() => setConfirmingCatId(null), 4500);
    return () => clearTimeout(timer);
  }, [confirmingCatId]);

  const stats = calculateCourseStats(course, simMode ? simGrades : null, gradeScale);
  const targetPct = typeof course.targetPct === 'number' ? course.targetPct : 85;
  const targetInfo = calculateTargetRequirement(
    course,
    targetPct,
    simMode ? simGrades : null,
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
      draggable={!readOnly}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {/* Course Header Strip */}
      <div className="course-header">
        <div className="course-lead-controls">
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
            value={course.code}
            disabled={readOnly}
            placeholder="COURSE"
            aria-label="Course code"
            onChange={(e) => onUpdateCourse({ code: e.target.value })}
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
                  {!readOnly && <th scope="col" className="col-order" aria-label="Order" />}
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
                  {!readOnly && <th scope="col" className="col-action" />}
                </tr>
              </thead>
              <tbody>
                {stats.categoryBreakdowns.map((cat, idx) => {
                  const hasRealGrade =
                    typeof cat.grade === 'number' && Number.isFinite(cat.grade);
                  const canSimulate = simMode && !hasRealGrade;
                  const displayedGrade = hasRealGrade
                    ? cat.grade
                    : canSimulate
                      ? (simGrades?.[cat.id] ?? null)
                      : null;

                  return (
                    <tr
                      key={cat.id}
                      className={cat.isSimulated ? 'row-simulated' : ''}
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
                          value={displayedGrade}
                          placeholder={canSimulate ? 'What-if %' : '—'}
                          disabled={readOnly && !simMode}
                          isSimInput={canSimulate}
                          ariaLabel={`${course.code} ${cat.name} grade percent`}
                          onCommit={(val) => {
                            if (canSimulate) {
                              onUpdateSimGrade(cat.id, val);
                            } else if (!readOnly) {
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
                    {TARGET_PRESETS.map((p) => (
                      <option key={p.pct} value={p.pct}>
                        {p.label}
                      </option>
                    ))}
                  </select>

                  {targetInfo && targetInfo.status === 'achievable' && (
                    <span className="target-result">
                      Need{' '}
                      <strong>
                        {formatPercent(targetInfo.requiredOnRemaining, 1)}
                      </strong>{' '}
                      on remaining {Math.round(stats.remainingWeight)}%
                    </span>
                  )}

                  {targetInfo && targetInfo.status === 'secured' && (
                    <span className="target-result secured">
                      <strong>Target secured</strong> (even at 0% remaining)
                    </span>
                  )}

                  {targetInfo && targetInfo.status === 'unreachable' && (
                    <span className="target-result unreachable">
                      Needs{' '}
                      <strong>
                        {formatPercent(targetInfo.requiredOnRemaining, 1)}
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
