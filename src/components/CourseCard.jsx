import { Fragment, useState, useEffect, useMemo, useRef } from 'react';
import { UNIT_OPTIONS, MAX_SUB_ITEMS_PER_CATEGORY } from '../domain/constants.js';
import {
  calculateCourseStats,
  buildTargetOptions,
  formatPercent,
  formatGpa,
  roundHalfUp,
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

function formatCellDisplay(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? roundHalfUp(value, 2).toFixed(2)
    : '';
}

function formatCellFullPrecision(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
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
  const [draft, setDraft] = useState(() => formatCellDisplay(value));
  const dirtyRef = useRef(false);

  function handleChange(e) {
    const raw = e.target.value;
    dirtyRef.current = true;
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
    const wasDirty = dirtyRef.current;
    dirtyRef.current = false;
    setFocused(false);
    if (!wasDirty) {
      return;
    }
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
      setDraft(formatCellDisplay(parsed.value));
    } else {
      setDraft(formatCellDisplay(value));
    }
  }

  const displayedValue = focused ? draft : formatCellDisplay(value);

  const isAbove100 =
    typeof value === 'number' && Number.isFinite(value) && value > 100;

  return (
    <input
      type="text"
      inputMode="decimal"
      className={`cell-input num-input ${isSimInput ? 'sim-input' : ''} ${
        isAbove100 ? 'cell-warn' : ''
      }`.trim()}
      value={displayedValue}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      title={
        isAbove100
          ? 'Above 100% — verify bonus credit or extra syllabus weight'
          : undefined
      }
      onFocus={(e) => {
        const fullPrecision = formatCellFullPrecision(value);
        dirtyRef.current = false;
        setDraft(fullPrecision);
        setFocused(true);
        e.currentTarget.value = fullPrecision;
        e.currentTarget.select();
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

function formatUnitsDisplay(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0.5';
  if (value === 0) return '0';
  if (Number.isInteger(value)) return value.toFixed(1);
  return String(roundHalfUp(value, 2));
}

function parseUnitsInput(raw) {
  const normalized = String(raw ?? '').trim().replace(',', '.');
  if (normalized === '') {
    return { kind: 'empty', value: null };
  }
  if (!STRICT_DECIMAL_RE.test(normalized)) {
    return { kind: 'invalid', value: null };
  }
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    return { kind: 'invalid', value: null };
  }
  return { kind: 'number', value: num === 0 ? 0 : num };
}

function CourseCreditsControl({
  courseId,
  courseCode,
  units,
  disabled,
  onCommit,
  onPopoverOpenChange,
}) {
  const [focused, setFocused] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [draft, setDraft] = useState(() => formatUnitsDisplay(units));
  const dirtyRef = useRef(false);
  const groupRef = useRef(null);
  const inputRef = useRef(null);

  const anyOpen = (showPresets && !disabled) || showHelp;
  useEffect(() => {
    onPopoverOpenChange?.(anyOpen);
  }, [anyOpen, onPopoverOpenChange]);

  useEffect(() => {
    if (!showHelp && !showPresets) return undefined;
    function handlePointerDown(e) {
      if (groupRef.current && !groupRef.current.contains(e.target)) {
        setShowHelp(false);
        setShowPresets(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        setShowHelp(false);
        setShowPresets(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showHelp, showPresets]);

  const displayedValue = focused ? draft : formatUnitsDisplay(units);
  const inputId = `units-input-${courseId}`;

  return (
    <div ref={groupRef} className="units-control-wrap">
      <div className="units-box">
        <label
          className={`units-label ${disabled ? 'is-disabled' : ''}`.trim()}
          htmlFor={inputId}
        >
          Credits
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="decimal"
          className="units-input"
          value={displayedValue}
          disabled={disabled}
          aria-label={`${courseCode} credits`}
          onFocus={(e) => {
            const full =
              typeof units === 'number' && Number.isFinite(units)
                ? String(units)
                : '0.5';
            dirtyRef.current = false;
            setDraft(full);
            setFocused(true);
            setShowHelp(false);
            if (!disabled) {
              setShowPresets(true);
            }
            e.currentTarget.value = full;
            e.currentTarget.select();
          }}
          onChange={(e) => {
            const raw = e.target.value;
            dirtyRef.current = true;
            setDraft(raw);
            const parsed = parseUnitsInput(raw);
            if (parsed.kind === 'number' && !Object.is(parsed.value, units)) {
              onCommit(parsed.value);
            }
          }}
          onBlur={() => {
            const wasDirty = dirtyRef.current;
            dirtyRef.current = false;
            setFocused(false);
            setShowPresets(false);
            if (!wasDirty) return;
            const parsed = parseUnitsInput(draft);
            if (parsed.kind === 'number') {
              if (!Object.is(parsed.value, units)) {
                onCommit(parsed.value);
              }
              setDraft(formatUnitsDisplay(parsed.value));
            } else {
              setDraft(formatUnitsDisplay(units));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setShowPresets(false);
            }
          }}
        />
        <button
          type="button"
          className={`units-help-btn ${showHelp ? 'active' : ''}`}
          aria-label={`How ${courseCode} credits weight GPA`}
          aria-expanded={showHelp}
          title="How course credits weight GPA"
          onClick={() => {
            setShowPresets(false);
            setShowHelp((prev) => !prev);
          }}
        >
          ?
        </button>
      </div>

      {showPresets && !disabled && (
        <div
          className="units-popover units-presets-popover"
          role="group"
          aria-label={`${courseCode} quick credit presets`}
        >
          <div className="units-popover-caption">Quick presets</div>
          <div className="units-preset-chips">
            {UNIT_OPTIONS.map((preset) => {
              const isCurrent = Math.abs((units ?? 0) - preset) < 1e-9;
              return (
                <button
                  key={preset}
                  type="button"
                  className={`units-preset-chip ${isCurrent ? 'active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    dirtyRef.current = false;
                    if (!Object.is(preset, units)) {
                      onCommit(preset);
                    }
                    setDraft(formatUnitsDisplay(preset));
                    setShowPresets(false);
                    inputRef.current?.blur();
                  }}
                >
                  {preset.toFixed(1)}
                </button>
              );
            })}
          </div>
          <div className="units-popover-hint">
            Or type any value (0–100)
          </div>
        </div>
      )}

      {showHelp && (
        <div
          className="units-popover units-help-popover"
          role="region"
          aria-label={`${courseCode} credit system guidance`}
        >
          <strong>Course-Units vs. Credit-Hours:</strong> Whether your school
          uses <span className="tabular">0.5 / 1.0</span> course-units or{' '}
          <span className="tabular">3 / 4 / 5</span> credit hours, GPA math is
          identical as long as you stay consistent — a{' '}
          <span className="tabular">4.0</span>-credit course carries twice the
          GPA weight of a <span className="tabular">2.0</span>-credit course (
          <span className="tabular">0</span> for non-credit seminars).
        </div>
      )}
    </div>
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
  simModifiedSubItemIds,
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
  onToggleCategoryItemsExpanded,
  onSplitCategory,
  onCollapseCategoryToSingleScore,
  onAddSubItem,
  onUpdateSubItem,
  onDeleteSubItem,
  onReorderSubItem,
  onSetCategoryDropLowest,
}) {
  const [confirmingCatId, setConfirmingCatId] = useState(null);
  const [confirmingSubId, setConfirmingSubId] = useState(null);
  const [hasOpenUnitsPopover, setHasOpenUnitsPopover] = useState(false);

  useEffect(() => {
    if (!confirmingCatId) return undefined;
    const timer = setTimeout(() => setConfirmingCatId(null), 4500);
    return () => clearTimeout(timer);
  }, [confirmingCatId]);

  useEffect(() => {
    if (!confirmingSubId) return undefined;
    const timer = setTimeout(() => setConfirmingSubId(null), 4500);
    return () => clearTimeout(timer);
  }, [confirmingSubId]);

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

  return (
    <section
      className={`course-sheet ${isCollapsed ? 'is-collapsed' : ''} ${
        hasOpenUnitsPopover ? 'has-open-popover' : ''
      } ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
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
          <CourseCreditsControl
            courseId={course.id}
            courseCode={course.code}
            units={course.units}
            disabled={readOnly}
            onCommit={(nextUnits) => onUpdateCourse({ units: nextUnits })}
            onPopoverOpenChange={setHasOpenUnitsPopover}
          />

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
                    simMode &&
                    !cat.hasSubItems &&
                    (cat.grade === null || cat.grade === undefined);
                  const isCatExpanded =
                    cat.hasSubItems && Boolean(cat.itemsExpanded);
                  const subCount = cat.subItemBreakdowns?.length || 0;
                  const maxDropChip = Math.min(
                    4,
                    Math.max(2, subCount - 1, cat.configuredDropLowest || 0),
                  );
                  const dropOptions = [];
                  for (let n = 0; n <= maxDropChip; n += 1) {
                    dropOptions.push(n);
                  }
                  if (
                    cat.configuredDropLowest > maxDropChip &&
                    !dropOptions.includes(cat.configuredDropLowest)
                  ) {
                    dropOptions.push(cat.configuredDropLowest);
                  }

                  return (
                    <Fragment key={cat.id}>
                      <tr
                        className={`${isRowSimulated ? 'row-simulated' : ''} ${
                          cat.hasSubItems ? 'row-has-subitems' : ''
                        }`.trim()}
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
                                disabled={
                                  idx === stats.categoryBreakdowns.length - 1
                                }
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
                          <div className="cat-name-cell-wrap">
                            {cat.hasSubItems && (
                              <button
                                type="button"
                                className={`sub-toggle-btn ${
                                  isCatExpanded ? 'expanded' : ''
                                }`}
                                aria-expanded={isCatExpanded}
                                aria-label={`${
                                  isCatExpanded ? 'Collapse' : 'Expand'
                                } ${cat.name} (${subCount} ${
                                  subCount === 1 ? 'item' : 'items'
                                })`}
                                title={
                                  isCatExpanded
                                    ? 'Collapse sub-assessments'
                                    : 'Expand sub-assessments'
                                }
                                onClick={() =>
                                  onToggleCategoryItemsExpanded?.(
                                    cat.id,
                                    !isCatExpanded,
                                  )
                                }
                              >
                                <span aria-hidden="true">
                                  {isCatExpanded ? '▾' : '▸'}
                                </span>
                                <span className="tabular">
                                  {subCount} {subCount === 1 ? 'item' : 'items'}
                                </span>
                              </button>
                            )}

                            <input
                              type="text"
                              className="cell-input cat-name-input"
                              value={cat.name}
                              disabled={readOnly}
                              placeholder="Assessment name"
                              aria-label={`${course.code} category ${idx + 1} name`}
                              onChange={(e) =>
                                onUpdateCategory(cat.id, { name: e.target.value })
                              }
                            />

                            {cat.hasSubItems && cat.configuredDropLowest > 0 && (
                              <span className="drop-lowest-badge">
                                Drop lowest {cat.configuredDropLowest}
                              </span>
                            )}

                            {!cat.hasSubItems && !readOnly && (
                              <button
                                type="button"
                                className="split-items-btn"
                                title={`Split ${
                                  cat.name || 'category'
                                } into individual sub-assessments`}
                                aria-label={`Split items for ${cat.name}`}
                                onClick={() => onSplitCategory?.(cat.id)}
                              >
                                + Split items
                              </button>
                            )}
                          </div>
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
                          {cat.hasSubItems ? (
                            <div className="computed-grade-cell">
                              <span
                                className={`computed-cat-grade tabular ${
                                  cat.effectiveGrade === null ? 'is-empty' : ''
                                } ${isRowSimulated ? 'is-simulated' : ''}`.trim()}
                                aria-label={`${course.code} ${cat.name} computed grade`}
                                title="Auto-calculated from kept sub-items"
                              >
                                {cat.effectiveGrade !== null
                                  ? formatPercent(cat.effectiveGrade, 2)
                                  : '—'}
                              </span>
                            </div>
                          ) : (
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
                          )}
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

                      {cat.hasSubItems && isCatExpanded && (
                        <tr className="sub-items-panel-row">
                          <td
                            colSpan={readOnly ? 4 : 6}
                            className="sub-items-panel-cell"
                          >
                            <div
                              className="sub-items-panel"
                              role="group"
                              aria-label={`${course.code} ${cat.name} sub-assessments`}
                            >
                              <div className="sub-panel-header">
                                <span className="sub-panel-title">
                                  Sub-assessments (equal weight)
                                </span>

                                <div className="sub-panel-controls">
                                  {!readOnly ? (
                                    <div
                                      className="drop-lowest-group"
                                      role="group"
                                      aria-label={`${cat.name} drop lowest count`}
                                    >
                                      <span className="drop-lowest-label">
                                        Drop lowest:
                                      </span>
                                      {dropOptions.map((n) => {
                                        const isActiveDrop =
                                          cat.configuredDropLowest === n;
                                        return (
                                          <button
                                            key={n}
                                            type="button"
                                            className={`drop-chip tabular ${
                                              isActiveDrop ? 'active' : ''
                                            }`}
                                            aria-pressed={isActiveDrop}
                                            onClick={() =>
                                              onSetCategoryDropLowest?.(cat.id, n)
                                            }
                                          >
                                            {n}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  ) : cat.configuredDropLowest > 0 ? (
                                    <span className="sub-panel-readonly-rule">
                                      Rule: Drop lowest {cat.configuredDropLowest}
                                    </span>
                                  ) : null}

                                  {!readOnly && (
                                    <button
                                      type="button"
                                      className="sub-merge-btn"
                                      title="Merge sub-items back into a single category score"
                                      aria-label={`Use single score for ${cat.name}`}
                                      onClick={() =>
                                        onCollapseCategoryToSingleScore?.(
                                          cat.id,
                                          cat.effectiveGrade,
                                        )
                                      }
                                    >
                                      Single score
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="sub-items-list">
                                {cat.subItemBreakdowns.map((sub, sIdx) => {
                                  const isSubSimulated =
                                    simMode &&
                                    Boolean(simModifiedSubItemIds?.has(sub.id));
                                  const isSubBlankInSim =
                                    simMode && !sub.isGraded;
                                  const subLabel =
                                    sub.name || `item ${sIdx + 1}`;

                                  return (
                                    <div
                                      key={sub.id}
                                      className={`sub-item-row ${
                                        sub.isDropped ? 'is-dropped' : ''
                                      } ${
                                        isSubSimulated ? 'is-simulated' : ''
                                      }`.trim()}
                                    >
                                      <div className="sub-item-left">
                                        {!readOnly && (
                                          <span className="sub-order-btns">
                                            <button
                                              type="button"
                                              className="mini-arrow-btn"
                                              disabled={sIdx === 0}
                                              onClick={() =>
                                                onReorderSubItem?.(
                                                  cat.id,
                                                  sIdx,
                                                  sIdx - 1,
                                                )
                                              }
                                              title="Move item up"
                                              aria-label={`Move ${subLabel} up`}
                                            >
                                              ↑
                                            </button>
                                            <button
                                              type="button"
                                              className="mini-arrow-btn"
                                              disabled={sIdx === subCount - 1}
                                              onClick={() =>
                                                onReorderSubItem?.(
                                                  cat.id,
                                                  sIdx,
                                                  sIdx + 1,
                                                )
                                              }
                                              title="Move item down"
                                              aria-label={`Move ${subLabel} down`}
                                            >
                                              ↓
                                            </button>
                                          </span>
                                        )}

                                        <input
                                          type="text"
                                          className={`cell-input sub-name-input ${
                                            sub.isDropped
                                              ? 'is-dropped-text'
                                              : ''
                                          }`.trim()}
                                          value={sub.name}
                                          disabled={readOnly}
                                          placeholder={`Item ${sIdx + 1}`}
                                          aria-label={`${course.code} ${cat.name} sub-item ${
                                            sIdx + 1
                                          } name`}
                                          onChange={(e) =>
                                            onUpdateSubItem?.(cat.id, sub.id, {
                                              name: e.target.value,
                                            })
                                          }
                                        />

                                        {sub.isDropped && (
                                          <span className="sub-dropped-badge">
                                            Dropped
                                          </span>
                                        )}
                                      </div>

                                      <div className="sub-item-right">
                                        <div className="sub-grade-wrap">
                                          <NumericCellInput
                                            value={sub.grade}
                                            placeholder={
                                              simMode ? 'What-if %' : '—'
                                            }
                                            disabled={readOnly}
                                            isSimInput={
                                              isSubSimulated || isSubBlankInSim
                                            }
                                            ariaLabel={`${course.code} ${cat.name} ${subLabel} grade percent`}
                                            onCommit={(val) => {
                                              if (!readOnly) {
                                                onUpdateSubItem?.(
                                                  cat.id,
                                                  sub.id,
                                                  { grade: val },
                                                );
                                              }
                                            }}
                                          />
                                          <span
                                            className="sub-pct-suffix"
                                            aria-hidden="true"
                                          >
                                            %
                                          </span>
                                        </div>

                                        {!readOnly &&
                                          (confirmingSubId === sub.id ? (
                                            <span className="inline-confirm-wrap">
                                              <button
                                                type="button"
                                                className="inline-confirm-btn"
                                                onClick={() => {
                                                  setConfirmingSubId(null);
                                                  onDeleteSubItem?.(
                                                    cat.id,
                                                    sub.id,
                                                    subLabel,
                                                  );
                                                }}
                                                aria-label={`Confirm delete ${subLabel}`}
                                              >
                                                Delete?
                                              </button>
                                              <button
                                                type="button"
                                                className="inline-cancel-btn"
                                                onClick={() =>
                                                  setConfirmingSubId(null)
                                                }
                                                title="Cancel"
                                                aria-label={`Cancel delete ${subLabel}`}
                                              >
                                                ×
                                              </button>
                                            </span>
                                          ) : (
                                            <button
                                              type="button"
                                              className="row-delete-btn sub-delete-btn"
                                              onClick={() =>
                                                setConfirmingSubId(sub.id)
                                              }
                                              title="Delete sub-item"
                                              aria-label={`Delete ${subLabel}`}
                                            >
                                              ×
                                            </button>
                                          ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="sub-panel-footer">
                                {!readOnly ? (
                                  <button
                                    type="button"
                                    className="add-sub-item-btn"
                                    disabled={
                                      subCount >= MAX_SUB_ITEMS_PER_CATEGORY
                                    }
                                    onClick={() => onAddSubItem?.(cat.id)}
                                  >
                                    + Add Item
                                  </button>
                                ) : (
                                  <span />
                                )}

                                <span className="sub-panel-summary tabular">
                                  {cat.gradedSubItemCount === 0
                                    ? 'No graded items yet (neutral)'
                                    : cat.effectiveDropCount > 0
                                      ? `Kept ${cat.keptSubItemCount} of ${
                                          cat.gradedSubItemCount
                                        } graded (dropped ${
                                          cat.effectiveDropCount
                                        }) · Avg ${formatPercent(
                                          cat.effectiveGrade,
                                          2,
                                        )}`
                                      : cat.configuredDropLowest > 0 &&
                                          cat.gradedSubItemCount === 1
                                        ? `1 graded · Drop lowest ${
                                            cat.configuredDropLowest
                                          } activates at 2+ graded · Avg ${formatPercent(
                                            cat.effectiveGrade,
                                            2,
                                          )}`
                                        : `${
                                            cat.gradedSubItemCount
                                          } graded · Avg ${formatPercent(
                                            cat.effectiveGrade,
                                            2,
                                          )}`}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
