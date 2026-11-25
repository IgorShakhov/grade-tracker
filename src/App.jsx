import { useState, useEffect, useCallback, useRef } from 'react';
import { DEFAULT_GRADE_SCALE } from './domain/constants.js';
import {
  createInitialState,
  createEmptyState,
  createNewTerm,
  createNewCourse,
  createNewCategory,
  duplicateCourseStructure,
} from './domain/templates.js';
import {
  reorderCoursesInTerm,
  reorderCategoriesInCourse,
  moveCourseToTerm,
  duplicateCourseInTerm,
  setAllCoursesCollapsed,
} from './domain/operations.js';
import { calculateAllStats } from './domain/calculations.js';
import { storageService } from './services/storage.js';
import {
  encodeShareSnapshot,
  decodeShareSnapshot,
  extractShareTokenFromUrl,
  buildShareUrl,
  clearShareParamsFromCurrentUrl,
} from './services/share.js';
import {
  parseImportedJson,
  exportStateAsJson,
  exportStateAsCsv,
} from './services/exporters.js';

import HeaderLedger from './components/HeaderLedger.jsx';
import TermTabs from './components/TermTabs.jsx';
import CourseCard from './components/CourseCard.jsx';
import GradeScaleCard from './components/GradeScaleCard.jsx';
import {
  ShareModal,
  DataModal,
  ScaleEditorModal,
  ConfirmDeleteModal,
} from './components/Modals.jsx';

const MAX_HISTORY = 30;
const COALESCE_WINDOW_MS = 700;

export default function App() {
  const [doc, setDoc] = useState(() => ({
    current: storageService.load(),
    past: [],
    future: [],
  }));
  const state = doc.current;
  const lastCoalesceRef = useRef({ key: null, time: 0 });

  const [sharedState, setSharedState] = useState(null);
  const [simMode, setSimMode] = useState(false);
  const [simGrades, setSimGrades] = useState({});
  const [shareModalUrl, setShareModalUrl] = useState(null);
  const [showDataModal, setShowDataModal] = useState(false);
  const [showScaleModal, setShowScaleModal] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((text, { showUndo = false } = {}) => {
    setToast({ text, showUndo });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const duration = toast.showUndo ? 5500 : 2600;
    const t = setTimeout(() => setToast(null), duration);
    return () => clearTimeout(t);
  }, [toast]);

  // Subscribe to remote cloud adapter updates if connected
  useEffect(() => {
    return storageService.subscribe((remoteState) => {
      setDoc((prev) => ({ ...prev, current: remoteState }));
    });
  }, []);

  // Check URL for compressed read-only snapshot (#share=... or ?share=...)
  useEffect(() => {
    let cancelled = false;
    async function checkSharedUrl() {
      if (typeof window === 'undefined') return;
      const token = extractShareTokenFromUrl(window.location);
      if (!token) return;
      const decoded = await decodeShareSnapshot(token);
      if (!cancelled) {
        if (decoded) {
          setSharedState(decoded);
        } else {
          showToast('Shared snapshot link was invalid or incomplete; loaded local tracker.');
        }
      }
    }
    checkSharedUrl();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const readOnly = Boolean(sharedState);
  const activeState = sharedState || state;

  const updateCurrentWithoutHistory = useCallback(
    (updater, { touchTimestamp = false } = {}) => {
      setDoc((prev) => {
        const nextCurrent =
          typeof updater === 'function' ? updater(prev.current) : updater;
        const saved = storageService.save(nextCurrent, { touchTimestamp });
        return { ...prev, current: saved };
      });
    },
    [],
  );

  /**
   * Commits a user mutation to localStorage and records an Undo snapshot.
   * Rapid consecutive text edits with the same `coalesceKey` are grouped into one Undo step.
   */
  const commitState = useCallback(
    (updater, { coalesceKey = null, touchTimestamp = true } = {}) => {
      const now = Date.now();
      const shouldCoalesce =
        coalesceKey !== null &&
        lastCoalesceRef.current.key === coalesceKey &&
        now - lastCoalesceRef.current.time < COALESCE_WINDOW_MS;
      lastCoalesceRef.current = { key: coalesceKey, time: now };

      setDoc((prev) => {
        const computed =
          typeof updater === 'function' ? updater(prev.current) : updater;
        if (computed === prev.current) return prev;
        const saved = storageService.save(computed, { touchTimestamp });
        return {
          current: saved,
          past: shouldCoalesce
            ? prev.past
            : [...prev.past.slice(-(MAX_HISTORY - 1)), prev.current],
          future: [],
        };
      });
    },
    [],
  );

  const handleUndo = useCallback(() => {
    if (readOnly) return;
    lastCoalesceRef.current = { key: null, time: 0 };
    setDoc((prev) => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      const restored = storageService.save(previous, { touchTimestamp: true });
      return {
        current: restored,
        past: prev.past.slice(0, -1),
        future: [prev.current, ...prev.future.slice(0, MAX_HISTORY - 1)],
      };
    });
    showToast('Undid last change.');
  }, [readOnly, showToast]);

  const handleRedo = useCallback(() => {
    if (readOnly) return;
    lastCoalesceRef.current = { key: null, time: 0 };
    setDoc((prev) => {
      if (prev.future.length === 0) return prev;
      const [nextItem, ...remainingFuture] = prev.future;
      const restored = storageService.save(nextItem, { touchTimestamp: true });
      return {
        current: restored,
        past: [...prev.past.slice(-(MAX_HISTORY - 1)), prev.current],
        future: remainingFuture,
      };
    });
    showToast('Redid change.');
  }, [readOnly, showToast]);

  // Global keyboard shortcuts: Ctrl/Cmd+Z (Undo) and Ctrl/Cmd+Shift+Z or Ctrl+Y (Redo)
  useEffect(() => {
    if (readOnly) return undefined;
    function onKeyDown(e) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        if (doc.past.length > 0) {
          e.preventDefault();
          handleUndo();
        }
      } else if ((key === 'z' && e.shiftKey) || (!e.metaKey && key === 'y')) {
        if (doc.future.length > 0) {
          e.preventDefault();
          handleRedo();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [readOnly, doc.past.length, doc.future.length, handleUndo, handleRedo]);

  const activeTerm =
    activeState.terms.find((t) => t.id === activeState.activeTermId) ||
    activeState.terms[0];

  const gradeScale = activeState.gradeScale || DEFAULT_GRADE_SCALE;
  const stats = calculateAllStats(activeState, simMode ? simGrades : null);
  const simCount = Object.values(simGrades).filter(
    (v) => typeof v === 'number' && Number.isFinite(v),
  ).length;

  const allCoursesInTerm = activeTerm?.courses || [];
  const allCollapsed =
    allCoursesInTerm.length > 0 && allCoursesInTerm.every((c) => Boolean(c.collapsed));

  // --- Shared View Handlers ---
  function handleExitSharedView() {
    clearShareParamsFromCurrentUrl(window);
    setSharedState(null);
    setSimGrades({});
  }

  function handleSaveSharedCopyLocally() {
    if (!sharedState) return;
    commitState(sharedState);
    clearShareParamsFromCurrentUrl(window);
    setSharedState(null);
    showToast('Saved shared courses into your local tracker.');
  }

  // --- Share Link Generation ---
  async function handleOpenShareModal() {
    try {
      const token = await encodeShareSnapshot(activeState);
      const url = buildShareUrl(window.location.href, token);
      setShareModalUrl(url);
    } catch {
      showToast('Could not generate share link.');
    }
  }

  async function handleCopyShareUrl() {
    if (!shareModalUrl) return;
    try {
      await navigator.clipboard.writeText(shareModalUrl);
      showToast('Read-only share link copied to clipboard.');
    } catch {
      showToast('Select and copy the URL from the box.');
    }
  }

  // --- Term Mutations ---
  function handleSelectTerm(termId) {
    if (readOnly) {
      setSharedState((prev) => ({ ...prev, activeTermId: termId }));
      return;
    }
    updateCurrentWithoutHistory((prev) => ({ ...prev, activeTermId: termId }));
  }

  function handleAddTerm() {
    commitState((prev) => {
      const newTerm = createNewTerm(prev.terms.length);
      return {
        ...prev,
        activeTermId: newTerm.id,
        terms: [...prev.terms, newTerm],
      };
    });
  }

  function handleRenameTerm(termId, newName) {
    commitState((prev) => ({
      ...prev,
      terms: prev.terms.map((t) => (t.id === termId ? { ...t, name: newName } : t)),
    }));
  }

  function requestDeleteTerm(termId) {
    const term = activeState.terms.find((t) => t.id === termId);
    if (!term || activeState.terms.length <= 1) return;
    const count = term.courses.length;
    setPendingDelete({
      kind: 'term',
      termId,
      title: `Delete "${term.name}"?`,
      message: `This will delete "${term.name}" and its ${count} course${
        count === 1 ? '' : 's'
      }. You can still Undo right after.`,
      confirmLabel: 'Delete Term',
    });
  }

  // --- Course Mutations ---
  function handleAddCourse(mode = 'standard') {
    commitState((prev) => ({
      ...prev,
      terms: prev.terms.map((t) => {
        if (t.id !== activeTerm.id) return t;
        const created = createNewCourse(t.courses.length + 1, mode);
        return { ...t, courses: [...t.courses, created] };
      }),
    }));
  }

  function handleDuplicateFromSelect(sourceCourseId) {
    if (!sourceCourseId) return;
    const allCourses = activeState.terms.flatMap((t) => t.courses);
    const source = allCourses.find((c) => c.id === sourceCourseId);
    if (!source) return;
    commitState((prev) => ({
      ...prev,
      terms: prev.terms.map((t) => {
        if (t.id !== activeTerm.id) return t;
        return {
          ...t,
          courses: [...t.courses, duplicateCourseStructure(source)],
        };
      }),
    }));
    showToast(`Duplicated structure from ${source.code}.`);
  }

  function handleUpdateCourse(courseId, patch) {
    const keys = Object.keys(patch);
    const onlyUiState = keys.every((k) => k === 'collapsed');

    if (readOnly && onlyUiState) {
      setSharedState((prev) => ({
        ...prev,
        terms: prev.terms.map((t) =>
          t.id !== activeTerm.id
            ? t
            : {
                ...t,
                courses: t.courses.map((c) =>
                  c.id === courseId ? { ...c, ...patch } : c,
                ),
              },
        ),
      }));
      return;
    }

    if (onlyUiState) {
      updateCurrentWithoutHistory((prev) => ({
        ...prev,
        terms: prev.terms.map((t) =>
          t.id !== activeTerm.id
            ? t
            : {
                ...t,
                courses: t.courses.map((c) =>
                  c.id === courseId ? { ...c, ...patch } : c,
                ),
              },
        ),
      }));
      return;
    }

    const isTextPatch = keys.every((k) => k === 'code' || k === 'title');
    commitState(
      (prev) => ({
        ...prev,
        terms: prev.terms.map((t) =>
          t.id !== activeTerm.id
            ? t
            : {
                ...t,
                courses: t.courses.map((c) =>
                  c.id === courseId ? { ...c, ...patch } : c,
                ),
              },
        ),
      }),
      { coalesceKey: isTextPatch ? `course-${courseId}-${keys[0]}` : null },
    );
  }

  function requestDeleteCourse(course) {
    const catCount = course.categories.length;
    setPendingDelete({
      kind: 'course',
      termId: activeTerm.id,
      courseId: course.id,
      code: course.code,
      title: `Delete course "${course.code}"?`,
      message: `This will remove "${course.code}"${
        course.title ? ` (${course.title})` : ''
      } and its ${catCount} assessment row${
        catCount === 1 ? '' : 's'
      }. You can still Undo afterward.`,
      confirmLabel: 'Delete Course',
    });
  }

  function confirmPendingDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === 'term') {
      const target = activeState.terms.find((t) => t.id === pendingDelete.termId);
      commitState((prev) => {
        if (prev.terms.length <= 1) return prev;
        const remaining = prev.terms.filter((t) => t.id !== pendingDelete.termId);
        const nextActive =
          prev.activeTermId === pendingDelete.termId
            ? remaining[0].id
            : prev.activeTermId;
        return {
          ...prev,
          activeTermId: nextActive,
          terms: remaining,
        };
      });
      setPendingDelete(null);
      showToast(`Deleted term "${target?.name || 'Term'}".`, { showUndo: true });
    } else if (pendingDelete.kind === 'course') {
      const label = pendingDelete.code || 'Course';
      commitState((prev) => ({
        ...prev,
        terms: prev.terms.map((t) =>
          t.id !== pendingDelete.termId
            ? t
            : {
                ...t,
                courses: t.courses.filter((c) => c.id !== pendingDelete.courseId),
              },
        ),
      }));
      setPendingDelete(null);
      showToast(`Deleted course "${label}".`, { showUndo: true });
    }
  }

  function handleToggleCollapseAll() {
    const targetCollapsed = !allCollapsed;
    if (readOnly) {
      setSharedState((prev) =>
        setAllCoursesCollapsed(prev, activeTerm.id, targetCollapsed),
      );
      return;
    }
    updateCurrentWithoutHistory((prev) =>
      setAllCoursesCollapsed(prev, activeTerm.id, targetCollapsed),
    );
  }

  // --- Category Mutations ---
  function handleAddCategory(courseId) {
    commitState((prev) => ({
      ...prev,
      terms: prev.terms.map((t) =>
        t.id !== activeTerm.id
          ? t
          : {
              ...t,
              courses: t.courses.map((c) =>
                c.id !== courseId
                  ? c
                  : { ...c, categories: [...c.categories, createNewCategory()] },
              ),
            },
      ),
    }));
  }

  function handleUpdateCategory(courseId, catId, patch) {
    const keys = Object.keys(patch);
    commitState(
      (prev) => ({
        ...prev,
        terms: prev.terms.map((t) =>
          t.id !== activeTerm.id
            ? t
            : {
                ...t,
                courses: t.courses.map((c) =>
                  c.id !== courseId
                    ? c
                    : {
                        ...c,
                        categories: c.categories.map((cat) =>
                          cat.id === catId ? { ...cat, ...patch } : cat,
                        ),
                      },
                ),
              },
        ),
      }),
      { coalesceKey: `cat-${catId}-${keys[0]}` },
    );
  }

  function handleDeleteCategory(courseId, catId, catName = 'Assessment') {
    commitState((prev) => ({
      ...prev,
      terms: prev.terms.map((t) =>
        t.id !== activeTerm.id
          ? t
          : {
              ...t,
              courses: t.courses.map((c) =>
                c.id !== courseId
                  ? c
                  : {
                      ...c,
                      categories: c.categories.filter((cat) => cat.id !== catId),
                    },
              ),
            },
      ),
    }));
    showToast(`Deleted "${catName}".`, { showUndo: true });
  }

  function handleUpdateSimGrade(catId, value) {
    setSimGrades((prev) => {
      const next = { ...prev };
      if (value === null || value === undefined) {
        delete next[catId];
      } else {
        next[catId] = value;
      }
      return next;
    });
  }

  const allExistingCourses = activeState.terms.flatMap((t) => t.courses);

  return (
    <div className="app-root">
      {/* Shared Read-Only Banner */}
      {readOnly && (
        <div className="mode-banner" role="status">
          <div className="mode-banner-inner">
            <span>
              Viewing a <strong>Read-Only Shared Snapshot</strong> (
              {activeState.studentName || 'Shared'}). Edits are disabled unless you
              save a copy.
            </span>
            <div className="mode-banner-actions">
              <button
                id="save-shared-copy-btn"
                type="button"
                className="btn btn-ghost-light"
                onClick={handleSaveSharedCopyLocally}
              >
                Save Copy to My Browser
              </button>
              <button
                id="exit-shared-view-btn"
                type="button"
                className="btn btn-ghost-light"
                onClick={handleExitSharedView}
              >
                Open My Own Tracker
              </button>
            </div>
          </div>
        </div>
      )}

      {/* What-If Simulator Active Banner */}
      {simMode && (
        <div className="mode-banner sim-banner" role="status">
          <div className="mode-banner-inner">
            <span>
              <strong>What-If Exam Simulator ON</strong> — Enter hypothetical grades
              in dashed ungraded boxes to preview final course &amp; GPA outcomes.
              Your real saved marks remain untouched.
            </span>
            <div className="mode-banner-actions">
              {simCount > 0 && (
                <button
                  id="clear-sim-btn"
                  type="button"
                  className="btn btn-ghost-light"
                  onClick={() => setSimGrades({})}
                >
                  Clear Hypothetical Marks ({simCount})
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost-light"
                onClick={() => setSimMode(false)}
              >
                Exit Simulator
              </button>
            </div>
          </div>
        </div>
      )}

      <HeaderLedger
        studentName={activeState.studentName}
        lastUpdated={activeState.lastUpdated}
        readOnly={readOnly}
        simMode={simMode}
        simCount={simCount}
        stats={stats}
        hasMultipleTerms={activeState.terms.length > 1}
        activeTermName={activeTerm?.name || 'Term'}
        canUndo={doc.past.length > 0}
        canRedo={doc.future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onChangeName={(name) =>
          commitState(
            (prev) => ({ ...prev, studentName: name }),
            { coalesceKey: 'owner-name' },
          )
        }
        onToggleSimMode={() => setSimMode((v) => !v)}
        onOpenShare={handleOpenShareModal}
        onOpenData={() => setShowDataModal(true)}
      />

      <main className="workspace-shell">
        <TermTabs
          terms={activeState.terms}
          activeTermId={activeTerm?.id}
          readOnly={readOnly}
          allCollapsed={allCollapsed}
          hasCourses={allCoursesInTerm.length > 0}
          onSelectTerm={handleSelectTerm}
          onAddTerm={handleAddTerm}
          onRenameTerm={handleRenameTerm}
          onDeleteTerm={requestDeleteTerm}
          onToggleCollapseAll={handleToggleCollapseAll}
        />

        <div className="main-grid">
          <div className="courses-column">
            {allCoursesInTerm.map((course, idx) => (
              <CourseCard
                key={course.id}
                course={course}
                courseIndex={idx}
                totalCourses={allCoursesInTerm.length}
                terms={activeState.terms}
                activeTermId={activeTerm.id}
                gradeScale={gradeScale}
                readOnly={readOnly}
                simMode={simMode}
                simGrades={simGrades}
                isDragging={dragIndex === idx}
                isDragOver={dragOverIndex === idx && dragIndex !== idx}
                onDragStart={() => setDragIndex(idx)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverIndex(idx);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null && dragIndex !== idx) {
                    commitState((prev) =>
                      reorderCoursesInTerm(prev, activeTerm.id, dragIndex, idx),
                    );
                  }
                  setDragIndex(null);
                  setDragOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDragOverIndex(null);
                }}
                onUpdateCourse={(patch) => handleUpdateCourse(course.id, patch)}
                onReorderCourse={(from, to) =>
                  commitState((prev) =>
                    reorderCoursesInTerm(prev, activeTerm.id, from, to),
                  )
                }
                onDuplicateCourse={() => {
                  commitState((prev) =>
                    duplicateCourseInTerm(prev, activeTerm.id, course.id),
                  );
                  showToast(`Duplicated ${course.code} structure.`);
                }}
                onDeleteCourse={() => requestDeleteCourse(course)}
                onMoveCourseToTerm={(toTermId) => {
                  const dest = activeState.terms.find((t) => t.id === toTermId);
                  commitState((prev) =>
                    moveCourseToTerm(prev, activeTerm.id, toTermId, course.id),
                  );
                  if (dest) {
                    showToast(`Moved ${course.code} to ${dest.name}.`);
                  }
                }}
                onAddCategory={() => handleAddCategory(course.id)}
                onUpdateCategory={(catId, patch) =>
                  handleUpdateCategory(course.id, catId, patch)
                }
                onReorderCategory={(from, to) =>
                  commitState((prev) =>
                    reorderCategoriesInCourse(
                      prev,
                      activeTerm.id,
                      course.id,
                      from,
                      to,
                    ),
                  )
                }
                onDeleteCategory={(catId, catName) =>
                  handleDeleteCategory(course.id, catId, catName)
                }
                onUpdateSimGrade={handleUpdateSimGrade}
              />
            ))}

            {!readOnly && (
              <div className="add-course-bar">
                <span className="add-course-bar-label">
                  Add Course to {activeTerm?.name}:
                </span>
                <div className="add-course-options">
                  <button
                    id="add-standard-course-btn"
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => handleAddCourse('standard')}
                  >
                    + Standard Course (25 / 35 / 40%)
                  </button>

                  <button
                    id="add-blank-course-btn"
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleAddCourse('blank')}
                  >
                    + Blank Course
                  </button>

                  {allExistingCourses.length > 0 && (
                    <select
                      id="duplicate-course-select"
                      className="target-select"
                      value=""
                      aria-label="Duplicate structure from an existing course"
                      onChange={(e) => handleDuplicateFromSelect(e.target.value)}
                    >
                      <option value="">Duplicate structure from…</option>
                      {allExistingCourses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} {c.title ? `— ${c.title}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}
          </div>

          <GradeScaleCard
            gradeScale={gradeScale}
            lastUpdated={activeState.lastUpdated}
            readOnly={readOnly}
            onOpenScaleEditor={() => setShowScaleModal(true)}
          />
        </div>
      </main>

      {shareModalUrl && (
        <ShareModal
          shareUrl={shareModalUrl}
          onClose={() => setShareModalUrl(null)}
          onCopy={handleCopyShareUrl}
        />
      )}

      {showDataModal && (
        <DataModal
          readOnly={readOnly}
          onClose={() => setShowDataModal(false)}
          onExportJson={() => exportStateAsJson(activeState)}
          onExportCsv={() => exportStateAsCsv(activeState)}
          onImportJsonFile={(text) => {
            const imported = parseImportedJson(text);
            commitState(imported, { touchTimestamp: false });
            setSimGrades({});
            showToast('Imported JSON tracker data.');
          }}
          onLoadSample={() => {
            const sample = createInitialState();
            commitState(sample);
            setSimGrades({});
            showToast('Loaded sample courses.');
          }}
          onResetEmpty={() => {
            const empty = createEmptyState();
            commitState(empty);
            setSimGrades({});
            showToast('Started fresh blank tracker.');
          }}
        />
      )}

      {showScaleModal && !readOnly && (
        <ScaleEditorModal
          gradeScale={gradeScale}
          onClose={() => setShowScaleModal(false)}
          onSaveScale={(nextScale) => {
            commitState((prev) => ({ ...prev, gradeScale: nextScale }));
            showToast('Updated grading scale.');
          }}
        />
      )}

      {pendingDelete && !readOnly && (
        <ConfirmDeleteModal
          title={pendingDelete.title}
          message={pendingDelete.message}
          confirmLabel={pendingDelete.confirmLabel}
          onConfirm={confirmPendingDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.showUndo && doc.past.length > 0 && (
            <button
              type="button"
              className="toast-undo-btn"
              onClick={handleUndo}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
