import { useState, useEffect, useCallback } from 'react';
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
import { ShareModal, DataModal, ScaleEditorModal } from './components/Modals.jsx';

export default function App() {
  const [state, setState] = useState(() => storageService.load());
  const [sharedState, setSharedState] = useState(null);
  const [simMode, setSimMode] = useState(false);
  const [simGrades, setSimGrades] = useState({});
  const [shareModalUrl, setShareModalUrl] = useState(null);
  const [showDataModal, setShowDataModal] = useState(false);
  const [showScaleModal, setShowScaleModal] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [toastMsg, setToastMsg] = useState('');

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return undefined;
    const t = setTimeout(() => setToastMsg(''), 2600);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Subscribe to remote cloud adapter updates if connected
  useEffect(() => {
    return storageService.subscribe((remoteState) => {
      setState(remoteState);
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

  const commitState = useCallback((updater) => {
    setState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return storageService.save(next, { touchTimestamp: true });
    });
  }, []);

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
    const saved = storageService.save(sharedState, { touchTimestamp: true });
    setState(saved);
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
    setState((prev) => {
      const next = { ...prev, activeTermId: termId };
      return storageService.save(next, { touchTimestamp: false });
    });
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

  function handleDeleteTerm(termId) {
    commitState((prev) => {
      if (prev.terms.length <= 1) return prev;
      const remaining = prev.terms.filter((t) => t.id !== termId);
      const nextActive =
        prev.activeTermId === termId ? remaining[0].id : prev.activeTermId;
      return {
        ...prev,
        activeTermId: nextActive,
        terms: remaining,
      };
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
    if (readOnly && Object.keys(patch).every((k) => k === 'collapsed')) {
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
    const onlyUiState = Object.keys(patch).every((k) => k === 'collapsed');
    setState((prev) => {
      const next = {
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
      };
      return storageService.save(next, { touchTimestamp: !onlyUiState });
    });
  }

  function handleDeleteCourse(courseId) {
    commitState((prev) => ({
      ...prev,
      terms: prev.terms.map((t) =>
        t.id !== activeTerm.id
          ? t
          : { ...t, courses: t.courses.filter((c) => c.id !== courseId) },
      ),
    }));
  }

  function handleToggleCollapseAll() {
    const targetCollapsed = !allCollapsed;
    if (readOnly) {
      setSharedState((prev) =>
        setAllCoursesCollapsed(prev, activeTerm.id, targetCollapsed),
      );
      return;
    }
    setState((prev) => {
      const next = setAllCoursesCollapsed(prev, activeTerm.id, targetCollapsed);
      return storageService.save(next, { touchTimestamp: false });
    });
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
                      categories: c.categories.map((cat) =>
                        cat.id === catId ? { ...cat, ...patch } : cat,
                      ),
                    },
              ),
            },
      ),
    }));
  }

  function handleDeleteCategory(courseId, catId) {
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
        onChangeName={(name) =>
          commitState((prev) => ({ ...prev, studentName: name }))
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
          onDeleteTerm={handleDeleteTerm}
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
                onDeleteCourse={() => handleDeleteCourse(course.id)}
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
                onDeleteCategory={(catId) => handleDeleteCategory(course.id, catId)}
                onUpdateSimGrade={handleUpdateSimGrade}
              />
            ))}

            {!readOnly && (
              <div className="add-course-bar">
                <span className="add-course-bar-label">Add Course to {activeTerm?.name}:</span>
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
            const saved = storageService.save(imported, { touchTimestamp: false });
            setState(saved);
            setSimGrades({});
            showToast('Imported JSON tracker data.');
          }}
          onLoadSample={() => {
            const sample = createInitialState();
            const saved = storageService.save(sample, { touchTimestamp: true });
            setState(saved);
            setSimGrades({});
            showToast('Loaded sample courses.');
          }}
          onResetEmpty={() => {
            const empty = createEmptyState();
            const saved = storageService.save(empty, { touchTimestamp: true });
            setState(saved);
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

      {toastMsg && (
        <div className="toast" role="status" aria-live="polite">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
