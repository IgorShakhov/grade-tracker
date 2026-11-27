import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DEFAULT_GRADE_SCALE } from './domain/constants.js';
import {
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
  cloudSyncManager,
  buildLiveShareUrl,
  extractLiveViewTokenFromUrl,
  clearLiveViewFromUrl,
  fetchSharedView,
} from './services/cloudSync.js';

import HeaderLedger from './components/HeaderLedger.jsx';
import TermTabs from './components/TermTabs.jsx';
import CourseCard from './components/CourseCard.jsx';
import GradeScaleCard from './components/GradeScaleCard.jsx';
import {
  ShareModal,
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
    localSaveSeq: 0,
    needsPersist: false,
  }));
  const state = doc.current;
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastCoalesceRef = useRef({ key: null, time: 0 });
  const lastPersistedSeqRef = useRef(0);

  const [syncSnapshot, setSyncSnapshot] = useState(() =>
    cloudSyncManager.getSnapshot(),
  );
  const [sharedState, setSharedState] = useState(null);
  const sharedStateRef = useRef(sharedState);
  sharedStateRef.current = sharedState;
  const [liveShareTokenView, setLiveShareTokenView] = useState(null);
  const liveShareTokenViewRef = useRef(liveShareTokenView);
  liveShareTokenViewRef.current = liveShareTokenView;
  const urlRequestSeqRef = useRef(0);
  const [liveRefreshing, setLiveRefreshing] = useState(false);

  // When non-null, What-If Simulator is active and isolates all edits in memory
  const [sandboxState, setSandboxState] = useState(null);
  const [simEpoch, setSimEpoch] = useState(0);
  const [showShareModal, setShowShareModal] = useState(false);
  const [snapshotShareUrl, setSnapshotShareUrl] = useState('');
  const [showScaleModal, setShowScaleModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
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

  // Start CloudSyncManager and subscribe to sync + remote/cross-tab storage updates (#11)
  useEffect(() => {
    const unsubStorage = storageService.subscribe((remoteState) => {
      lastCoalesceRef.current = { key: null, time: 0 };
      if (!sharedStateRef.current) {
        setSandboxState(null);
      }
      setDoc((prev) => ({
        current: remoteState,
        past: [],
        future: [],
        localSaveSeq: prev.localSaveSeq || 0,
        needsPersist: false,
      }));
    });
    const unsubSync = cloudSyncManager.subscribe((nextSnap) => {
      setSyncSnapshot(nextSnap);
      if (nextSnap.status === 'conflict') {
        setShowSyncModal(false);
        setShowShareModal(false);
        setShowScaleModal(false);
        setPendingDelete(null);
      } else {
        setConflictDismissed(false);
      }
    });
    const stopSync = cloudSyncManager.start();

    function handleOnlineOrFocus() {
      const cur = cloudSyncManager.getSnapshot();
      if (cur.user && cur.status !== 'conflict' && cur.status !== 'syncing') {
        cloudSyncManager.syncNow(stateRef.current).catch(() => {});
      }
    }

    window.addEventListener('online', handleOnlineOrFocus);
    window.addEventListener('focus', handleOnlineOrFocus);
    return () => {
      window.removeEventListener('online', handleOnlineOrFocus);
      window.removeEventListener('focus', handleOnlineOrFocus);
      unsubSync();
      unsubStorage();
      stopSync();
    };
  }, []);

  // Check URL for either `#view=<token>` (Live Read-Only Cloud Share) or `#share=...` (Compressed Snapshot)
  useEffect(() => {
    let cancelled = false;

    function clearActiveSharedViewIfNeeded() {
      if (!sharedStateRef.current) return;
      setPendingDelete(null);
      setShowScaleModal(false);
      setShowShareModal(false);
      setSandboxState(null);
      setLiveShareTokenView(null);
      setSharedState(null);
    }

    async function checkUrlViewMode() {
      if (typeof window === 'undefined') return;
      const mySeq = ++urlRequestSeqRef.current;
      const isCurrent = () => !cancelled && mySeq === urlRequestSeqRef.current;

      const viewToken = extractLiveViewTokenFromUrl(window.location);
      if (viewToken) {
        // Normalize any legacy `?view=` query parameter into `#view=` fragment to avoid Referer/log exposure
        if (window.location.search.includes('view=')) {
          const normalized = buildLiveShareUrl(window.location.href, viewToken);
          if (normalized && typeof window.history?.replaceState === 'function') {
            const parsed = new URL(normalized);
            window.history.replaceState(
              window.history.state ?? null,
              '',
              `${parsed.pathname}${parsed.hash}`,
            );
          }
        }

        try {
          const remote = await fetchSharedView(viewToken);
          if (isCurrent()) {
            if (remote.exists && remote.state) {
              setPendingDelete(null);
              setShowScaleModal(false);
              setShowShareModal(false);
              setSandboxState(null);
              setLiveShareTokenView(viewToken);
              setSharedState(remote.state);
            } else {
              clearLiveViewFromUrl(window);
              clearActiveSharedViewIfNeeded();
              showToast('This shared link is no longer active or was rotated.');
            }
          }
        } catch (err) {
          if (isCurrent()) {
            clearActiveSharedViewIfNeeded();
            showToast(err?.message || 'Could not load shared tracker.');
          }
        }
        return;
      }

      const snapToken = extractShareTokenFromUrl(window.location);
      if (!snapToken) {
        clearActiveSharedViewIfNeeded();
        return;
      }

      const decoded = await decodeShareSnapshot(snapToken);
      if (isCurrent()) {
        if (decoded) {
          setPendingDelete(null);
          setShowScaleModal(false);
          setShowShareModal(false);
          setSandboxState(null);
          setLiveShareTokenView(null);
          setSharedState(decoded);
        } else {
          clearActiveSharedViewIfNeeded();
          showToast(
            'Shared snapshot link was invalid or incomplete; loaded local tracker.',
          );
        }
      }
    }

    checkUrlViewMode();
    window.addEventListener('hashchange', checkUrlViewMode);
    window.addEventListener('popstate', checkUrlViewMode);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', checkUrlViewMode);
      window.removeEventListener('popstate', checkUrlViewMode);
    };
  }, [showToast]);

  const isSharedReadOnly = Boolean(sharedState);
  const readOnlyMode = isSharedReadOnly
    ? liveShareTokenView
      ? 'live-share'
      : 'snapshot'
    : null;
  const simMode = sandboxState !== null;
  // In What-If Sandbox mode, allow testing edits even on a shared view (in memory only)
  const readOnly = isSharedReadOnly && !simMode;
  const baseState = sharedState || state;
  const activeState = sandboxState || baseState;

  const { modifiedCatIds: simModifiedCatIds, changeCount: simCount } = useMemo(
    () => computeSandboxDiff(baseState, sandboxState),
    [baseState, sandboxState],
  );

  const handleToggleSimMode = useCallback(() => {
    setPendingDelete(null);
    setShowScaleModal(false);
    setSimEpoch((n) => n + 1);
    setSandboxState((prev) => (prev !== null ? null : structuredClone(baseState)));
  }, [baseState]);

  const handleResetSimulation = useCallback(() => {
    setPendingDelete(null);
    setSimEpoch((n) => n + 1);
    setSandboxState(structuredClone(baseState));
  }, [baseState]);

  // Persist committed local user edits once outside pure `setDoc` updaters (#14)
  const { localSaveSeq, needsPersist } = doc;
  useEffect(() => {
    if (localSaveSeq > lastPersistedSeqRef.current) {
      lastPersistedSeqRef.current = localSaveSeq;
      if (needsPersist) {
        storageService.save(state, {
          touchTimestamp: false,
          notifyListeners: false,
        });
      }
    }
  }, [localSaveSeq, needsPersist, state]);

  const updateCurrentWithoutHistory = useCallback(
    (updater, { touchTimestamp = false } = {}) => {
      if (simMode) {
        setSandboxState((prev) => {
          if (!prev) return prev;
          return typeof updater === 'function' ? updater(prev) : updater;
        });
        return;
      }
      const nowIso = new Date().toISOString();
      setDoc((prev) => {
        const nextCurrent =
          typeof updater === 'function' ? updater(prev.current) : updater;
        if (nextCurrent === prev.current) return prev;
        const prepared = storageService.prepareForSave(nextCurrent, {
          touchTimestamp,
          nowIso,
        });
        return {
          ...prev,
          current: prepared,
          localSaveSeq: (prev.localSaveSeq || 0) + 1,
          needsPersist: true,
        };
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
      const nowIso = new Date(now).toISOString();
      const shouldCoalesce =
        coalesceKey !== null &&
        lastCoalesceRef.current.key === coalesceKey &&
        now - lastCoalesceRef.current.time < COALESCE_WINDOW_MS;
      lastCoalesceRef.current = { key: coalesceKey, time: now };

      setDoc((prev) => {
        const computed =
          typeof updater === 'function' ? updater(prev.current) : updater;
        if (computed === prev.current) return prev;
        const prepared = storageService.prepareForSave(computed, {
          touchTimestamp,
          nowIso,
        });
        return {
          current: prepared,
          past: shouldCoalesce
            ? prev.past
            : [...prev.past.slice(-(MAX_HISTORY - 1)), prev.current],
          future: [],
          localSaveSeq: (prev.localSaveSeq || 0) + 1,
          needsPersist: true,
        };
      });
    },
    [simMode],
  );

  const handleUndo = useCallback(() => {
    if (isSharedReadOnly || simMode) return;
    lastCoalesceRef.current = { key: null, time: 0 };
    const nowIso = new Date().toISOString();
    setDoc((prev) => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      const restored = storageService.prepareForSave(previous, {
        touchTimestamp: true,
        nowIso,
      });
      return {
        current: restored,
        past: prev.past.slice(0, -1),
        future: [prev.current, ...prev.future.slice(0, MAX_HISTORY - 1)],
        localSaveSeq: (prev.localSaveSeq || 0) + 1,
        needsPersist: true,
      };
    });
    showToast('Undid last change.');
  }, [isSharedReadOnly, simMode, showToast]);

  const handleRedo = useCallback(() => {
    if (isSharedReadOnly || simMode) return;
    lastCoalesceRef.current = { key: null, time: 0 };
    const nowIso = new Date().toISOString();
    setDoc((prev) => {
      if (prev.future.length === 0) return prev;
      const [nextItem, ...remainingFuture] = prev.future;
      const restored = storageService.prepareForSave(nextItem, {
        touchTimestamp: true,
        nowIso,
      });
      return {
        current: restored,
        past: [...prev.past.slice(-(MAX_HISTORY - 1)), prev.current],
        future: remainingFuture,
        localSaveSeq: (prev.localSaveSeq || 0) + 1,
        needsPersist: true,
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

  // --- Shared / Live View Handlers ---
  function handleExitSharedView() {
    urlRequestSeqRef.current += 1;
    clearShareParamsFromCurrentUrl(window);
    clearLiveViewFromUrl(window);
    setPendingDelete(null);
    setShowScaleModal(false);
    setShowShareModal(false);
    setSandboxState(null);
    setLiveShareTokenView(null);
    setSharedState(null);
  }

  async function handleRefreshLiveShare() {
    if (!liveShareTokenView) return;
    const tokenAtStart = liveShareTokenView;
    const seqAtStart = urlRequestSeqRef.current;
    setLiveRefreshing(true);
    try {
      const remote = await fetchSharedView(tokenAtStart);
      if (
        urlRequestSeqRef.current !== seqAtStart ||
        liveShareTokenViewRef.current !== tokenAtStart
      ) {
        return;
      }
      if (remote.exists && remote.state) {
        setSharedState(remote.state);
        setSimEpoch((n) => n + 1);
        setSandboxState((prev) =>
          prev !== null ? structuredClone(remote.state) : null,
        );
        showToast('Refreshed latest shared grades.');
      } else {
        showToast('This shared link was turned off or rotated.');
      }
    } catch (err) {
      if (
        urlRequestSeqRef.current === seqAtStart &&
        liveShareTokenViewRef.current === tokenAtStart
      ) {
        showToast(err?.message || 'Could not refresh shared grades.');
      }
    } finally {
      setLiveRefreshing(false);
    }
  }

  function applySaveSharedCopyLocally() {
    if (!sharedState) return;
    urlRequestSeqRef.current += 1;
    setPendingDelete(null);
    setShowScaleModal(false);
    setShowShareModal(false);
    setSandboxState(null);
    const nowIso = new Date().toISOString();
    setDoc((prev) => {
      const prepared = storageService.prepareForSave(sharedState, {
        touchTimestamp: true,
        nowIso,
      });
      return {
        current: prepared,
        past: [...prev.past.slice(-(MAX_HISTORY - 1)), prev.current],
        future: [],
        localSaveSeq: (prev.localSaveSeq || 0) + 1,
        needsPersist: true,
      };
    });
    clearShareParamsFromCurrentUrl(window);
    clearLiveViewFromUrl(window);
    setLiveShareTokenView(null);
    setSharedState(null);
    showToast('Saved shared courses into your tracker.', { showUndo: true });
  }

  function handleSaveSharedCopyLocally() {
    if (!sharedState) return;
    const hasExistingCourses = state.terms.some(
      (t) => (t.courses?.length || 0) > 0,
    );
    if (!hasExistingCourses && !syncSnapshot.user) {
      applySaveSharedCopyLocally();
      return;
    }
    setShowShareModal(false);
    setShowScaleModal(false);
    setShowSyncModal(false);
    setPendingDelete({
      kind: 'save-shared-copy',
      title: 'Replace Your Tracker Courses?',
      message: syncSnapshot.user
        ? 'Saving this shared copy will replace your current courses and sync them to your Google Cloud account. You can still Undo right after.'
        : 'Saving this shared copy will replace the current courses in this browser. You can still Undo right after.',
      confirmLabel: 'Replace My Courses',
    });
  }

  // --- Cloud Sync & Auth Handlers ---
  function handleOpenSyncControl() {
    setShowShareModal(false);
    setShowScaleModal(false);
    setPendingDelete(null);
    if (syncSnapshot.status === 'conflict') {
      setConflictDismissed(false);
      return;
    }
    setShowSyncModal(true);
  }

  async function handleSignInGoogle() {
    const snap = await cloudSyncManager.signInWithGoogle();
    if (snap.user) {
      setShowSyncModal(false);
      if (snap.status === 'synced') {
        showToast('Signed in with Google and synced courses.');
      } else if (snap.status === 'offline' || snap.status === 'pending') {
        showToast('Signed in — courses will sync when back online.');
      }
    }
  }

  async function handleSignOutGoogle(options = {}) {
    const result = await cloudSyncManager.signOutUser(options);
    if (result?.requiresDiscardConfirm) {
      return result;
    }
    lastCoalesceRef.current = { key: null, time: 0 };
    setSandboxState(null);
    setDoc((prev) => ({
      current: storageService.load(),
      past: [],
      future: [],
      localSaveSeq: prev.localSaveSeq || 0,
      needsPersist: false,
    }));
    setShowSyncModal(false);
    showToast('Signed out and cleared local cached grades.');
    return result;
  }

  async function handleDeleteCloudData() {
    const deleted = await cloudSyncManager.deleteCloudData();
    if (!deleted) {
      return;
    }
    lastCoalesceRef.current = { key: null, time: 0 };
    setSandboxState(null);
    setDoc((prev) => ({
      current: storageService.load(),
      past: [],
      future: [],
      localSaveSeq: prev.localSaveSeq || 0,
      needsPersist: false,
    }));
    setShowSyncModal(false);
    showToast('Deleted cloud data and cleared local browser cache.');
  }

  async function handleCopyUrlText(urlText, label = 'Link copied to clipboard.') {
    try {
      await navigator.clipboard.writeText(urlText);
      showToast(label);
    } catch {
      showToast('Select and copy the URL from the box.');
    }
  }

  // --- Unified Share Modal ---
  async function handleOpenShareModal() {
    setShowSyncModal(false);
    setShowScaleModal(false);
    setPendingDelete(null);
    try {
      const token = await encodeShareSnapshot(baseState);
      const url = buildShareUrl(window.location.href, token);
      setSnapshotShareUrl(url);
    } catch {
      setSnapshotShareUrl('');
    }
    if (cloudSyncManager.getSnapshot().status === 'conflict') {
      return;
    }
    setShowShareModal(true);
  }

  const liveShareUrl =
    typeof window !== 'undefined' && syncSnapshot.shareToken
      ? buildLiveShareUrl(window.location.href, syncSnapshot.shareToken)
      : '';

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
    setShowShareModal(false);
    setShowScaleModal(false);
    setShowSyncModal(false);
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
    setShowShareModal(false);
    setShowScaleModal(false);
    setShowSyncModal(false);
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
    if (pendingDelete.kind === 'save-shared-copy') {
      applySaveSharedCopyLocally();
      return;
    }
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
      {/* Shared Snapshot or Live Shared View Banner */}
      {isSharedReadOnly && (
        <div className="mode-banner" role="status">
          <div className="mode-banner-inner">
            {liveShareTokenView ? (
              <span>
                Viewing <strong>Live Shared Grade Tracker</strong> (
                {baseState.studentName || 'Shared'}). Read-only — turn on What-If
                Simulator to test hypothetical scores.
              </span>
            ) : (
              <span>
                Viewing a <strong>Read-Only Shared Snapshot</strong> (
                {baseState.studentName || 'Shared'}). Edits are disabled unless
                you save a copy or turn on What-If Simulator.
              </span>
            )}
            <div className="mode-banner-actions">
              {liveShareTokenView && (
                <button
                  id="refresh-live-share-btn"
                  type="button"
                  className="btn btn-ghost-light"
                  disabled={liveRefreshing}
                  onClick={handleRefreshLiveShare}
                >
                  {liveRefreshing ? 'Refreshing…' : '↻ Refresh'}
                </button>
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
                Open My Tracker
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
        syncSnapshot={syncSnapshot}
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
                key={`${course.id}-${simMode ? `sim-${simEpoch}` : 'live'}`}
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
            onOpenScaleEditor={() => {
              setShowShareModal(false);
              setShowSyncModal(false);
              setPendingDelete(null);
              setShowScaleModal(true);
            }}
          />
        </div>
      </main>

      {showShareModal && (
        <ShareModal
          isSignedIn={Boolean(syncSnapshot.user)}
          isSharedReadOnly={isSharedReadOnly}
          liveShareUrl={liveShareUrl}
          snapshotUrl={snapshotShareUrl}
          onEnableOrRotateLiveShare={async (isRotate) => {
            try {
              const newToken = await cloudSyncManager.enableOrRotateShare(
                stateRef.current,
              );
              const nextUrl = buildLiveShareUrl(window.location.href, newToken);
              await handleCopyUrlText(
                nextUrl,
                isRotate
                  ? 'Rotated live link and copied new URL.'
                  : 'Enabled live read-only link and copied URL.',
              );
            } finally {
              if (cloudSyncManager.getSnapshot().status === 'conflict') {
                setConflictDismissed(false);
              }
            }
          }}
          onDisableLiveShare={async () => {
            try {
              await cloudSyncManager.disableShare(stateRef.current);
              showToast('Turned off live read-only link.');
            } finally {
              if (cloudSyncManager.getSnapshot().status === 'conflict') {
                setConflictDismissed(false);
              }
            }
          }}
          onCopyUrl={handleCopyUrlText}
          onOpenSignIn={() => setShowSyncModal(true)}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {showSyncModal && (
        <CloudSyncModal
          syncSnapshot={syncSnapshot}
          onSignIn={handleSignInGoogle}
          onSignOut={handleSignOutGoogle}
          onSyncNow={async () => {
            const snap = await cloudSyncManager.syncNow(stateRef.current);
            if (snap?.status === 'conflict') {
              setShowSyncModal(false);
            } else if (snap?.status === 'synced') {
              showToast('Synced with Google Cloud.');
            }
          }}
          onDeleteCloudData={handleDeleteCloudData}
          onClose={() => setShowSyncModal(false)}
        />
      )}

      {syncSnapshot.status === 'conflict' &&
        syncSnapshot.conflict &&
        !conflictDismissed && (
          <SyncConflictModal
            conflict={syncSnapshot.conflict}
            localState={state}
            onKeepLocal={async () => {
              const snap = await cloudSyncManager.resolveConflict(
                'keep-local',
                stateRef.current,
              );
              if (snap?.status === 'synced') {
                showToast('Saved local courses to Google Cloud.');
              } else if (snap?.status === 'offline' || snap?.status === 'pending') {
                showToast(
                  'Saved locally — will sync to Google Cloud when back online.',
                );
              }
            }}
            onUseRemote={async () => {
              const reason = syncSnapshot.conflict?.reason;
              const hadRemote = Boolean(syncSnapshot.conflict?.remoteState);
              const snap = await cloudSyncManager.resolveConflict(
                'use-remote',
                stateRef.current,
              );
              lastCoalesceRef.current = { key: null, time: 0 };
              setSandboxState(null);
              setDoc((prev) => ({
                current: storageService.load(),
                past: [],
                future: [],
                localSaveSeq: prev.localSaveSeq || 0,
                needsPersist: false,
              }));
              if (reason === 'remote-deleted' || !snap?.user) {
                showToast('Signed out and cleared local cached grades.');
              } else if (hadRemote) {
                showToast('Loaded courses from Google Cloud.');
              } else if (snap?.status === 'offline' || snap?.status === 'pending') {
                showToast(
                  'Started clean tracker locally — will sync when back online.',
                );
              } else if (snap?.status === 'synced') {
                showToast('Started clean tracker for this account.');
              }
            }}
            onClose={() => setConflictDismissed(true)}
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

      {pendingDelete &&
        (!readOnly || pendingDelete.kind === 'save-shared-copy') && (
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
