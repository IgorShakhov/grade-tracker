import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import {
  githubSyncManager,
  extractLiveProfileParams,
  clearLiveProfileParamsFromUrl,
  fetchRemoteProfile,
} from './services/githubSync.js';

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
import { CloudSyncModal, SyncConflictModal } from './components/SyncModals.jsx';

const MAX_HISTORY = 30;
const COALESCE_WINDOW_MS = 700;

/**
 * Compares sandboxState against baseState to identify every modified/added
 * assessment category and count total simulated changes.
 */
function computeSandboxDiff(baseState, sandboxState) {
  if (!sandboxState || !baseState) {
    return { modifiedCatIds: new Set(), changeCount: 0 };
  }

  const baseCourses = new Map();
  const baseCats = new Map();
  for (const term of baseState.terms || []) {
    for (const course of term.courses || []) {
      baseCourses.set(course.id, course);
      for (const cat of course.categories || []) {
        baseCats.set(cat.id, cat);
      }
    }
  }

  const modifiedCatIds = new Set();
  let changeCount = 0;

  const sandboxCourseIds = new Set();
  const sandboxCatIds = new Set();

  for (const term of sandboxState.terms || []) {
    for (const course of term.courses || []) {
      sandboxCourseIds.add(course.id);
      const origCourse = baseCourses.get(course.id);
      if (!origCourse) {
        changeCount += 1;
      } else if (
        origCourse.units !== course.units ||
        Boolean(origCourse.passFail) !== Boolean(course.passFail)
      ) {
        changeCount += 1;
      }

      for (const cat of course.categories || []) {
        sandboxCatIds.add(cat.id);
        const origCat = baseCats.get(cat.id);
        if (
          !origCat ||
          origCat.grade !== cat.grade ||
          origCat.weight !== cat.weight ||
          origCat.name !== cat.name
        ) {
          modifiedCatIds.add(cat.id);
          changeCount += 1;
        }
      }
    }
  }

  for (const origCourseId of baseCourses.keys()) {
    if (!sandboxCourseIds.has(origCourseId)) changeCount += 1;
  }
  for (const origCatId of baseCats.keys()) {
    if (!sandboxCatIds.has(origCatId)) changeCount += 1;
  }

  return { modifiedCatIds, changeCount };
}

export default function App() {
  const [doc, setDoc] = useState(() => ({
    current: storageService.load(),
    past: [],
    future: [],
  }));
  const state = doc.current;
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastCoalesceRef = useRef({ key: null, time: 0 });

  const [syncSnapshot, setSyncSnapshot] = useState(() =>
    githubSyncManager.getSnapshot(),
  );
  const [sharedState, setSharedState] = useState(null);
  const [liveProfileMeta, setLiveProfileMeta] = useState(null);
  const [liveRefreshing, setLiveRefreshing] = useState(false);

  // When non-null, What-If Simulator is active and isolates all edits in memory
  const [sandboxState, setSandboxState] = useState(null);
  const [shareModalUrl, setShareModalUrl] = useState(null);
  const [showDataModal, setShowDataModal] = useState(false);
  const [showScaleModal, setShowScaleModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncModalPrefill, setSyncModalPrefill] = useState(null);
  const [conflictDismissed, setConflictDismissed] = useState(false);
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

  // Subscribe to GitHubSyncManager status updates and remote state pushes
  useEffect(() => {
    const unsubSync = githubSyncManager.subscribe((nextSnap) => {
      setSyncSnapshot(nextSnap);
      if (nextSnap.status !== 'conflict') {
        setConflictDismissed(false);
      }
    });
    const unsubStorage = storageService.subscribe((remoteState) => {
      setDoc((prev) => ({ ...prev, current: remoteState }));
    });
    return () => {
      unsubSync();
      unsubStorage();
    };
  }, []);

  // Auto-sync on mount, window focus, and network reconnect when Cloud Sync is enabled
  useEffect(() => {
    const snap = githubSyncManager.getSnapshot();
    if (snap.config?.enabled && snap.config?.token) {
      githubSyncManager.syncNow(stateRef.current).catch(() => {});
    }

    function handleOnlineOrFocus() {
      const cur = githubSyncManager.getSnapshot();
      if (cur.config?.enabled && cur.config?.token) {
        githubSyncManager.syncNow(stateRef.current).catch(() => {});
      }
    }

    window.addEventListener('online', handleOnlineOrFocus);
    window.addEventListener('focus', handleOnlineOrFocus);
    return () => {
      window.removeEventListener('online', handleOnlineOrFocus);
      window.removeEventListener('focus', handleOnlineOrFocus);
    };
  }, []);

  // Check URL for either ?profile=<id> (Live GitHub Read-Only View) or #share=... (Compressed Snapshot)
  useEffect(() => {
    let cancelled = false;
    async function checkUrlViewMode() {
      if (typeof window === 'undefined') return;

      const liveParams = extractLiveProfileParams(window.location);
      if (liveParams && liveParams.repo) {
        const currentCfg = githubSyncManager.getSnapshot().config;
        const isSameEditableProfile =
          currentCfg?.enabled &&
          currentCfg?.token &&
          currentCfg.profileId === liveParams.profileId &&
          currentCfg.repo.toLowerCase() === liveParams.repo.toLowerCase();

        if (!isSameEditableProfile) {
          try {
            const remote = await fetchRemoteProfile({
              repo: liveParams.repo,
              branch: liveParams.branch,
              profileId: liveParams.profileId,
            });
            if (!cancelled) {
              if (remote.exists && remote.state) {
                setLiveProfileMeta(liveParams);
                setSharedState(remote.state);
              } else {
                showToast(
                  `Profile "${liveParams.profileId}" was not found on ${liveParams.repo}.`,
                );
              }
            }
          } catch (err) {
            if (!cancelled) {
              showToast(err.message || 'Could not fetch live profile from GitHub.');
            }
          }
          return;
        }
      }

      const token = extractShareTokenFromUrl(window.location);
      if (!token) return;
      const decoded = await decodeShareSnapshot(token);
      if (!cancelled) {
        if (decoded) {
          setLiveProfileMeta(null);
          setSharedState(decoded);
        } else {
          showToast(
            'Shared snapshot link was invalid or incomplete; loaded local tracker.',
          );
        }
      }
    }
    checkUrlViewMode();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const isSharedReadOnly = Boolean(sharedState);
  const readOnlyMode = isSharedReadOnly
    ? liveProfileMeta
      ? 'live-profile'
      : 'snapshot'
    : null;
  const simMode = sandboxState !== null;
  // In What-If Sandbox mode, allow testing edits even on a shared snapshot (in memory only)
  const readOnly = isSharedReadOnly && !simMode;
  const baseState = sharedState || state;
  const activeState = sandboxState || baseState;

  const { modifiedCatIds: simModifiedCatIds, changeCount: simCount } = useMemo(
    () => computeSandboxDiff(baseState, sandboxState),
    [baseState, sandboxState],
  );

  const handleToggleSimMode = useCallback(() => {
    setPendingDelete(null);
    setSandboxState((prev) => (prev !== null ? null : structuredClone(baseState)));
  }, [baseState]);

  const handleResetSimulation = useCallback(() => {
    setSandboxState(structuredClone(baseState));
  }, [baseState]);

  const updateCurrentWithoutHistory = useCallback(
    (updater, { touchTimestamp = false } = {}) => {
      if (simMode) {
        setSandboxState((prev) => {
          if (!prev) return prev;
          return typeof updater === 'function' ? updater(prev) : updater;
        });
        return;
      }
      setDoc((prev) => {
        const nextCurrent =
          typeof updater === 'function' ? updater(prev.current) : updater;
        const saved = storageService.save(nextCurrent, { touchTimestamp });
        return { ...prev, current: saved };
      });
    },
    [simMode],
  );

  /**
   * Commits a user mutation.
   * When What-If Simulator (`simMode`) is active, mutates ONLY in-memory `sandboxState`
   * without touching saved `localStorage` state, Cloud Sync, or Undo/Redo history.
   */
  const commitState = useCallback(
    (updater, { coalesceKey = null, touchTimestamp = true } = {}) => {
      if (simMode) {
        setSandboxState((prev) => {
          if (!prev) return prev;
          return typeof updater === 'function' ? updater(prev) : updater;
        });
        return;
      }

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
    [simMode],
  );

  const handleUndo = useCallback(() => {
    if (isSharedReadOnly || simMode) return;
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
  }, [isSharedReadOnly, simMode, showToast]);

  const handleRedo = useCallback(() => {
    if (isSharedReadOnly || simMode) return;
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
  }, [isSharedReadOnly, simMode, showToast]);

  // Global keyboard shortcuts: Ctrl/Cmd+Z (Undo) and Ctrl/Cmd+Shift+Z or Ctrl+Y (Redo)
  useEffect(() => {
    if (isSharedReadOnly || simMode) return undefined;
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
  }, [isSharedReadOnly, simMode, doc.past.length, doc.future.length, handleUndo, handleRedo]);

  const activeTerm =
    activeState.terms.find((t) => t.id === activeState.activeTermId) ||
    activeState.terms[0];

  const gradeScale = activeState.gradeScale || DEFAULT_GRADE_SCALE;
  const stats = calculateAllStats(activeState, null);

  const allCoursesInTerm = activeTerm?.courses || [];
  const allCollapsed =
    allCoursesInTerm.length > 0 && allCoursesInTerm.every((c) => Boolean(c.collapsed));

  // --- Shared / Live Profile View Handlers ---
  function handleExitSharedView() {
    clearShareParamsFromCurrentUrl(window);
    clearLiveProfileParamsFromUrl(window);
    setSandboxState(null);
    setLiveProfileMeta(null);
    setSharedState(null);
  }

  async function handleRefreshLiveProfile() {
    if (!liveProfileMeta) return;
    setLiveRefreshing(true);
    try {
      const remote = await fetchRemoteProfile({
        repo: liveProfileMeta.repo,
        branch: liveProfileMeta.branch,
        profileId: liveProfileMeta.profileId,
      });
      if (remote.exists && remote.state) {
        setSharedState(remote.state);
        showToast('Refreshed latest grades from GitHub.');
      }
    } catch (err) {
      showToast(err.message || 'Could not refresh profile.');
    } finally {
      setLiveRefreshing(false);
    }
  }

  function handleSaveSharedCopyLocally() {
    if (!sharedState) return;
    setSandboxState(null);
    const saved = storageService.save(sharedState, { touchTimestamp: true });
    setDoc((prev) => ({
      current: saved,
      past: [...prev.past.slice(-(MAX_HISTORY - 1)), prev.current],
      future: [],
    }));
    clearShareParamsFromCurrentUrl(window);
    clearLiveProfileParamsFromUrl(window);
    setLiveProfileMeta(null);
    setSharedState(null);
    showToast('Saved shared courses into your local tracker.');
  }

  // --- Cloud Sync Handlers ---
  function handleOpenSyncControl() {
    if (syncSnapshot.status === 'conflict') {
      setConflictDismissed(false);
      return;
    }
    setSyncModalPrefill(liveProfileMeta || null);
    setShowSyncModal(true);
  }

  async function handleConnectCloudSync(params) {
    const result = await githubSyncManager.connect(params, stateRef.current);
    // If we were viewing this exact profile in read-only ?profile= mode, switch to full editable mode!
    if (liveProfileMeta && liveProfileMeta.profileId === params.profileId) {
      setLiveProfileMeta(null);
      setSharedState(null);
    }
    setShowSyncModal(false);
    setSyncModalPrefill(null);
    showToast(
      result.mode === 'pulled'
        ? `Connected & loaded profile "${params.profileId}" from GitHub.`
        : `Connected & created profile "${params.profileId}" on GitHub.`,
    );
  }

  function handleDisconnectCloudSync() {
    githubSyncManager.disconnect();
    showToast('Disconnected GitHub Cloud Sync on this device.');
  }

  async function handleCopyUrlText(urlText, label = 'Link copied to clipboard.') {
    try {
      await navigator.clipboard.writeText(urlText);
      showToast(label);
    } catch {
      showToast('Select and copy the URL from the box.');
    }
  }

  // --- Share Link Generation (always shares saved baseState, not temporary What-If) ---
  async function handleOpenShareModal() {
    try {
      const token = await encodeShareSnapshot(baseState);
      const url = buildShareUrl(window.location.href, token);
      setShareModalUrl(url);
    } catch {
      showToast('Could not generate share link.');
    }
  }

  // --- Term Mutations ---
  function handleSelectTerm(termId) {
    if (isSharedReadOnly && !simMode) {
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
      }.${simMode ? ' (What-If sandbox only)' : ' You can still Undo right after.'}`,
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

    if (isSharedReadOnly && !simMode && onlyUiState) {
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
      }.${simMode ? ' (What-If sandbox only)' : ' You can still Undo afterward.'}`,
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
      showToast(`Deleted term "${target?.name || 'Term'}".`, { showUndo: !simMode });
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
      showToast(`Deleted course "${label}".`, { showUndo: !simMode });
    }
  }

  function handleToggleCollapseAll() {
    const targetCollapsed = !allCollapsed;
    if (isSharedReadOnly && !simMode) {
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
    showToast(`Deleted "${catName}".`, { showUndo: !simMode });
  }

  const allExistingCourses = activeState.terms.flatMap((t) => t.courses);

  return (
    <div className="app-root">
      {/* Shared Snapshot or Live GitHub Profile Banner */}
      {isSharedReadOnly && (
        <div className="mode-banner" role="status">
          <div className="mode-banner-inner">
            {liveProfileMeta ? (
              <span>
                Viewing <strong>Live GitHub Profile</strong> (
                <code>{liveProfileMeta.profileId}</code>). Read-only unless you
                connect a token or turn on What-If Simulator.
              </span>
            ) : (
              <span>
                Viewing a <strong>Read-Only Shared Snapshot</strong> (
                {baseState.studentName || 'Shared'}). Edits are disabled unless
                you save a copy or turn on What-If Simulator.
              </span>
            )}
            <div className="mode-banner-actions">
              {liveProfileMeta && (
                <>
                  <button
                    id="refresh-live-profile-btn"
                    type="button"
                    className="btn btn-ghost-light"
                    disabled={liveRefreshing}
                    onClick={handleRefreshLiveProfile}
                  >
                    {liveRefreshing ? 'Refreshing…' : '↻ Refresh'}
                  </button>
                  <button
                    id="connect-live-profile-btn"
                    type="button"
                    className="btn btn-ghost-light"
                    onClick={() => {
                      setSyncModalPrefill(liveProfileMeta);
                      setShowSyncModal(true);
                    }}
                  >
                    Connect Token to Edit
                  </button>
                </>
              )}
              <button
                id="save-shared-copy-btn"
                type="button"
                className="btn btn-ghost-light"
                onClick={handleSaveSharedCopyLocally}
              >
                Save Copy Locally
              </button>
              <button
                id="exit-shared-view-btn"
                type="button"
                className="btn btn-ghost-light"
                onClick={handleExitSharedView}
              >
                Open My Local Tracker
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
              <strong>What-If Exam Simulator ON</strong> — Edit any grade, weight,
              or course to test outcomes. Nothing is saved; exiting restores all
              values.
            </span>
            <div className="mode-banner-actions">
              {simCount > 0 && (
                <button
                  id="clear-sim-btn"
                  type="button"
                  className="btn btn-ghost-light"
                  onClick={handleResetSimulation}
                >
                  Reset Simulation ({simCount})
                </button>
              )}
              <button
                id="exit-sim-btn"
                type="button"
                className="btn btn-ghost-light"
                onClick={handleToggleSimMode}
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
        readOnlyMode={readOnlyMode}
        syncStatus={syncSnapshot.status}
        simMode={simMode}
        simCount={simCount}
        stats={stats}
        hasMultipleTerms={activeState.terms.length > 1}
        activeTermName={activeTerm?.name || 'Term'}
        canUndo={!simMode && doc.past.length > 0}
        canRedo={!simMode && doc.future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onChangeName={(name) =>
          commitState(
            (prev) => ({ ...prev, studentName: name }),
            { coalesceKey: 'owner-name' },
          )
        }
        onToggleSimMode={handleToggleSimMode}
        onOpenSync={handleOpenSyncControl}
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
                key={`${course.id}-${simMode ? 'sim' : 'live'}`}
                course={course}
                courseIndex={idx}
                totalCourses={allCoursesInTerm.length}
                terms={activeState.terms}
                activeTermId={activeTerm.id}
                gradeScale={gradeScale}
                readOnly={readOnly}
                simMode={simMode}
                simModifiedCatIds={simModifiedCatIds}
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
          onCopy={() =>
            handleCopyUrlText(
              shareModalUrl,
              'Read-only snapshot link copied to clipboard.',
            )
          }
        />
      )}

      {showSyncModal && (
        <CloudSyncModal
          syncSnapshot={syncSnapshot}
          initialPrefill={syncModalPrefill}
          onConnect={handleConnectCloudSync}
          onDisconnect={handleDisconnectCloudSync}
          onSyncNow={async () => {
            await githubSyncManager.syncNow(stateRef.current);
            showToast('Synced with GitHub.');
          }}
          onCopyLiveUrl={(urlText) =>
            handleCopyUrlText(urlText, 'Live GitHub profile link copied.')
          }
          onClose={() => {
            setShowSyncModal(false);
            setSyncModalPrefill(null);
          }}
        />
      )}

      {syncSnapshot.status === 'conflict' && !conflictDismissed && (
        <SyncConflictModal
          localState={state}
          remoteState={syncSnapshot.conflictRemoteState}
          onKeepLocal={async () => {
            await githubSyncManager.resolveConflict('keep-local', stateRef.current);
            showToast('Kept local changes and updated GitHub.');
          }}
          onUseRemote={async () => {
            await githubSyncManager.resolveConflict('use-remote', stateRef.current);
            showToast('Loaded latest version from GitHub.');
          }}
          onClose={() => setConflictDismissed(true)}
        />
      )}

      {showDataModal && (
        <DataModal
          readOnly={isSharedReadOnly}
          onClose={() => setShowDataModal(false)}
          onExportJson={() => exportStateAsJson(baseState)}
          onExportCsv={() => exportStateAsCsv(baseState)}
          onImportJsonFile={(text) => {
            const imported = parseImportedJson(text);
            setSandboxState(null);
            const saved = storageService.save(imported, { touchTimestamp: false });
            setDoc((prev) => ({
              current: saved,
              past: [...prev.past.slice(-(MAX_HISTORY - 1)), prev.current],
              future: [],
            }));
            showToast('Imported JSON tracker data.');
          }}
          onLoadSample={() => {
            const sample = createInitialState();
            setSandboxState(null);
            const saved = storageService.save(sample, { touchTimestamp: true });
            setDoc((prev) => ({
              current: saved,
              past: [...prev.past.slice(-(MAX_HISTORY - 1)), prev.current],
              future: [],
            }));
            showToast('Loaded sample courses.');
          }}
          onResetEmpty={() => {
            const empty = createEmptyState();
            setSandboxState(null);
            const saved = storageService.save(empty, { touchTimestamp: true });
            setDoc((prev) => ({
              current: saved,
              past: [...prev.past.slice(-(MAX_HISTORY - 1)), prev.current],
              future: [],
            }));
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
            showToast(
              simMode
                ? 'Updated grading scale in What-If sandbox.'
                : 'Updated grading scale.',
            );
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
          {toast.showUndo && !simMode && doc.past.length > 0 && (
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
