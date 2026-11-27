import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react';
import { storageService } from '../../src/services/storage.js';

const { mockGetDoc } = vi.hoisted(() => ({
  mockGetDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined }),
}));

// Mock Firebase service layer so React UI tests never open network sockets
vi.mock('../../src/services/firebase.js', () => ({
  FIREBASE_CONFIG: { projectId: 'test-project' },
  getFirebaseServices: () => ({
    onAuthStateChanged: (cb) => {
      cb(null);
      return () => {};
    },
    signInWithGooglePopup: vi.fn().mockResolvedValue({ user: null }),
    signOutAuth: vi.fn().mockResolvedValue(undefined),
    doc: (...segments) => ({ path: segments.join('/'), segments }),
    getDoc: mockGetDoc,
    writeBatch: () => ({
      set: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    }),
    serverTimestamp: () => 'mock-ts',
  }),
}));

import App from '../../src/App.jsx';

describe('Grade Tracker React Application (M1 + M1.1 + Firebase Cloud Sync)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    mockGetDoc.mockReset();
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
  });

  it('renders generic initial tracker with sample courses, GPA metrics, grading scale, and no Import/Export clutter', () => {
    render(<App />);
    expect(screen.getByLabelText('Tracker owner or label')).toHaveValue('My');
    expect(screen.getByText('Grading Scale')).toBeInTheDocument();
    expect(screen.getByText('Cumulative GPA')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ECON101')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import \/ Export/i })).not.toBeInTheDocument();
  });

  it('supports collapsing and expanding individual and all courses (M1.1)', () => {
    render(<App />);
    const collapseAllBtn = screen.getByRole('button', { name: /Collapse All Courses/i });
    fireEvent.click(collapseAllBtn);
    expect(screen.getByRole('button', { name: /Expand All Courses/i })).toBeInTheDocument();
    expect(screen.queryByText('+ Add Assessment')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Expand All Courses/i }));
    expect(screen.getAllByText('+ Add Assessment').length).toBeGreaterThan(0);
  });

  it('supports adding standard, blank, and duplicated course structures (M1.1)', () => {
    render(<App />);
    const initialSections = screen.getAllByRole('region', { name: /Course /i });
    const startCount = initialSections.length;

    fireEvent.click(screen.getByRole('button', { name: /\+ Blank Course/i }));
    expect(screen.getAllByRole('region', { name: /Course /i })).toHaveLength(startCount + 1);
    expect(screen.getByText(/No assessment categories yet/i)).toBeInTheDocument();

    const dupButtons = screen.getAllByRole('button', { name: /^Duplicate /i });
    fireEvent.click(dupButtons[0]);
    expect(screen.getAllByRole('region', { name: /Course /i })).toHaveLength(startCount + 2);
  });

  it('supports adding a second term and moving a course across terms (M1.1)', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Add Term/i }));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(2);

    fireEvent.click(tabs[0]);
    const moveSelect = screen.getByLabelText('Move ECON101 to another term');
    const secondTermOption = within(moveSelect).getAllByRole('option')[1];
    fireEvent.change(moveSelect, { target: { value: secondTermOption.value } });

    expect(screen.queryByDisplayValue('ECON101')).not.toBeInTheDocument();
    fireEvent.click(tabs[1]);
    expect(screen.getByDisplayValue('ECON101')).toBeInTheDocument();
  });

  it('requires modal confirmation for Course & Term deletes and supports full Undo + Redo', () => {
    render(<App />);
    const undoBtn = screen.getByRole('button', { name: /↶ Undo/i });
    const redoBtn = screen.getByRole('button', { name: /↷ Redo/i });
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();

    // 1. Delete Course -> Cancel keeps it, Confirm deletes it
    fireEvent.click(screen.getByRole('button', { name: 'Delete ECON101' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/Delete course "ECON101"\?/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/i }));
    expect(screen.getByDisplayValue('ECON101')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete ECON101' }));
    fireEvent.click(screen.getByRole('button', { name: /Delete Course/i }));
    expect(screen.queryByDisplayValue('ECON101')).not.toBeInTheDocument();
    expect(undoBtn).not.toBeDisabled();

    // 2. Undo brings ECON101 back; Redo deletes it again
    fireEvent.click(undoBtn);
    expect(screen.getByDisplayValue('ECON101')).toBeInTheDocument();
    expect(redoBtn).not.toBeDisabled();

    fireEvent.click(redoBtn);
    expect(screen.queryByDisplayValue('ECON101')).not.toBeInTheDocument();

    // 3. Add Term -> Delete Term shows modal -> Confirm -> Undo restores Term
    fireEvent.click(screen.getByRole('button', { name: /\+ Add Term/i }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Delete Term 2/i }));
    const termDialog = screen.getByRole('alertdialog');
    fireEvent.click(within(termDialog).getByRole('button', { name: /^Delete Term$/i }));
    expect(screen.getAllByRole('tab')).toHaveLength(1);

    fireEvent.click(undoBtn);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('requires inline 2-click confirmation before deleting an assessment row and supports Undo', () => {
    render(<App />);
    const ecoSection = screen.getByRole('region', { name: 'Course ECON101' });
    const table = within(ecoSection).getByRole('table');
    const firstRowDelete = within(table).getAllByRole('button', { name: /^Delete /i })[0];

    fireEvent.click(firstRowDelete);
    const confirmChip = within(table).getByRole('button', { name: /^Confirm delete /i });
    expect(confirmChip).toHaveTextContent('Delete?');

    const rowsBefore = within(table).getAllByRole('row').length;
    fireEvent.click(confirmChip);
    expect(within(table).getAllByRole('row').length).toBe(rowsBefore - 1);

    fireEvent.click(screen.getByRole('button', { name: /↶ Undo/i }));
    expect(within(table).getAllByRole('row').length).toBe(rowsBefore);
  });

  it('isolates ALL What-If edits (both already-graded and ungraded rows) in memory and reverts 100% on exit (Issue #4)', () => {
    render(<App />);
    const savedBefore = window.localStorage.getItem('grade_tracker_v1');

    const ecoBefore = screen.getByRole('region', { name: 'Course ECON101' });
    const firstGradeBefore = within(ecoBefore).getAllByLabelText(/ECON101 .* grade percent/i)[0].value;
    expect(firstGradeBefore).not.toBe('');

    fireEvent.click(screen.getByRole('button', { name: /What-If Simulator/i }));
    expect(screen.getByText(/What-If Exam Simulator ON/i)).toBeInTheDocument();

    const ecoSim = screen.getByRole('region', { name: 'Course ECON101' });
    const simGradeInputs = within(ecoSim).getAllByLabelText(/ECON101 .* grade percent/i);
    const gradedInput = simGradeInputs[0];
    const blankInput = simGradeInputs.find((el) => el.value === '');

    fireEvent.focus(gradedInput);
    fireEvent.change(gradedInput, { target: { value: '12.50' } });
    fireEvent.blur(gradedInput);

    fireEvent.focus(blankInput);
    fireEvent.change(blankInput, { target: { value: '98.00' } });
    fireEvent.blur(blankInput);

    expect(screen.getByRole('button', { name: /Reset Simulation \(2\)/i })).toBeInTheDocument();
    expect(window.localStorage.getItem('grade_tracker_v1')).toBe(savedBefore);

    fireEvent.click(screen.getByRole('button', { name: /Exit Simulator/i }));
    expect(screen.queryByText(/What-If Exam Simulator ON/i)).not.toBeInTheDocument();

    const ecoAfter = screen.getByRole('region', { name: 'Course ECON101' });
    const afterInputs = within(ecoAfter).getAllByLabelText(/ECON101 .* grade percent/i);
    expect(afterInputs[0].value).toBe(firstGradeBefore);
    expect(afterInputs.some((el) => el.value === '12.50' || el.value === '98.00')).toBe(false);
    expect(window.localStorage.getItem('grade_tracker_v1')).toBe(savedBefore);
  });

  it('opens the 1-click Google Sign-In dialog and the unified Share dialog (Milestone 2)', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/i }));
    const syncDialog = screen.getByRole('dialog', { name: /Sign In to Sync/i });
    expect(within(syncDialog).getByRole('button', { name: /Sign in with Google/i })).toBeInTheDocument();
    fireEvent.click(within(syncDialog).getByRole('button', { name: /^Close$/i }));

    fireEvent.click(screen.getByRole('button', { name: /^Share$/i }));
    const shareDialog = await screen.findByRole('dialog', { name: /Share Read-Only View/i });
    expect(within(shareDialog).getByText(/Live Auto-Updating Link/i)).toBeInTheDocument();
    expect(within(shareDialog).getByText(/One-Time Point-in-Time Snapshot/i)).toBeInTheDocument();
  });

  it('keeps setDoc updaters pure under React 19 <StrictMode> and persists each edit/undo/redo once (#14)', () => {
    const saveSpy = vi.spyOn(storageService, 'save');
    try {
      render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      expect(saveSpy).toHaveBeenCalledTimes(0);

      // 1. Add a blank course -> must save once (not twice in StrictMode!)
      fireEvent.click(screen.getByRole('button', { name: /\+ Blank Course/i }));
      expect(saveSpy).toHaveBeenCalledTimes(1);

      // 2. Collapse All (updateCurrentWithoutHistory) -> saves once
      fireEvent.click(screen.getByRole('button', { name: /Collapse All Courses/i }));
      expect(saveSpy).toHaveBeenCalledTimes(2);

      // 3. Undo & Redo -> each saves once
      fireEvent.click(screen.getByRole('button', { name: /↶ Undo/i }));
      expect(saveSpy).toHaveBeenCalledTimes(3);
      fireEvent.click(screen.getByRole('button', { name: /↷ Redo/i }));
      expect(saveSpy).toHaveBeenCalledTimes(4);
    } finally {
      saveSpy.mockRestore();
    }
  });

  it('clears stale Undo/Redo history and What-If sandbox when a remote cloud pull arrives (#11)', async () => {
    const { act } = await import('@testing-library/react');
    render(<App />);

    // Create local Undo history + enter What-If Simulator
    fireEvent.click(screen.getByRole('button', { name: /\+ Blank Course/i }));
    const undoBtn = screen.getByRole('button', { name: /↶ Undo/i });
    expect(undoBtn).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /What-If Simulator/i }));
    expect(screen.getByText(/What-If Exam Simulator ON/i)).toBeInTheDocument();

    // Simulate remote cloud pull arriving via StorageService
    const remote = storageService.load();
    remote.studentName = 'Pulled From Laptop';
    act(() => {
      storageService.saveLocalOnly(remote);
      storageService.notify(remote);
    });

    expect(screen.getByLabelText('Tracker owner or label')).toHaveValue(
      'Pulled From Laptop',
    );
    expect(screen.queryByText(/What-If Exam Simulator ON/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /↶ Undo/i })).toBeDisabled();
  });

  it('guards SyncConflictModal with busy state, surfaces inline errors, and renders remote-deleted options (#15)', async () => {
    const { SyncConflictModal } = await import('../../src/components/SyncModals.jsx');

    let rejectKeepLocal;
    const onKeepLocal = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectKeepLocal = reject;
        }),
    );
    const onUseRemote = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();

    render(
      <SyncConflictModal
        conflict={{
          reason: 'remote-deleted',
          remoteState: null,
          remoteRev: 0,
          remoteShareToken: null,
        }}
        localState={storageService.load()}
        onKeepLocal={onKeepLocal}
        onUseRemote={onUseRemote}
        onClose={onClose}
      />,
    );

    expect(
      screen.getByRole('heading', { name: /Cloud Data Deleted on Another Device/i }),
    ).toBeInTheDocument();

    const signOutClearBtn = screen.getByRole('button', { name: /Sign Out & Clear/i });
    const reuploadBtn = screen.getByRole('button', { name: /Re-Upload Courses/i });

    // Click Re-Upload -> enters busy state and blocks duplicate clicks or dismiss
    fireEvent.click(reuploadBtn);
    expect(onKeepLocal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Uploading…/i })).toBeDisabled();
    expect(signOutClearBtn).toBeDisabled();
    fireEvent.click(signOutClearBtn);
    expect(onUseRemote).not.toHaveBeenCalled();

    // Reject in-flight promise -> shows inline alert and re-enables buttons for retry
    await act(async () => {
      rejectKeepLocal(new Error('Daily free cloud sync quota reached.'));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Daily free cloud sync quota reached/i,
    );
    expect(
      screen.getByRole('button', { name: /Re-Upload Courses/i }),
    ).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign Out & Clear/i }));
    });
    await waitFor(() => expect(onUseRemote).toHaveBeenCalledTimes(1));
  });

  it('keeps SyncConflictModal mounted inside <App /> and displays inline error when resolveConflict fails in flight (Cluster 2 QA)', async () => {
    const { cloudSyncManager } = await import('../../src/services/cloudSync.js');

    render(<App />);

    // Put singleton cloudSyncManager into `remote-deleted` conflict state while mounted in <App />
    act(() => {
      cloudSyncManager.currentUser = { uid: 'u-qa', email: 'qa@example.com' };
      cloudSyncManager.status = 'conflict';
      cloudSyncManager.conflict = {
        reason: 'remote-deleted',
        remoteState: null,
        remoteRev: 0,
        remoteShareToken: null,
      };
      cloudSyncManager.emit();
    });

    expect(
      await screen.findByRole('heading', {
        name: /Cloud Data Deleted on Another Device/i,
      }),
    ).toBeInTheDocument();

    const origFactory = cloudSyncManager.firebaseFactory;
    cloudSyncManager.firebaseFactory = () => ({
      ...origFactory(),
      writeBatch: () => ({
        set: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockRejectedValue(
          Object.assign(new Error('Quota'), { code: 'resource-exhausted' }),
        ),
      }),
    });

    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Re-Upload Courses/i }));
      });

      // Modal MUST remain mounted in <App /> and display the inline role="alert" error!
      expect(await screen.findByRole('alert')).toHaveTextContent(
        /Daily free cloud sync quota reached/i,
      );
      expect(
        screen.getByRole('heading', {
          name: /Cloud Data Deleted on Another Device/i,
        }),
      ).toBeInTheDocument();
    } finally {
      cloudSyncManager.firebaseFactory = origFactory;
      act(() => {
        cloudSyncManager.currentUser = null;
        cloudSyncManager.conflict = null;
        cloudSyncManager.status = 'disconnected';
        cloudSyncManager.clearMeta();
        cloudSyncManager.emit();
      });
    }
  });

  it('hardens shared-view back-navigation, What-If live refresh, ShareModal context, and Save Copy Locally confirmation (#16)', async () => {
    const { createInitialState } = await import('../../src/domain/templates.js');
    const token = 'A'.repeat(32);

    const liveV1 = createInitialState();
    liveV1.studentName = 'Shared Friend V1';
    liveV1.terms[0].courses[0].code = 'ASTRO101';

    const liveV2 = createInitialState();
    liveV2.studentName = 'Shared Friend V2';
    liveV2.terms[0].courses[0].code = 'ASTRO202';

    let currentSharedPayload = liveV1;
    mockGetDoc.mockImplementation(async (ref) => {
      if (ref.path === `shares/${token}`) {
        return {
          exists: () => true,
          data: () => ({
            ownerUid: 'friend-uid',
            stateJson: JSON.stringify(currentSharedPayload),
            updatedAt: 'ts-1',
          }),
        };
      }
      return { exists: () => false, data: () => undefined };
    });

    window.history.replaceState({}, '', `/#view=${token}`);
    render(<App />);

    // 1. Enters Live Shared View
    expect(
      await screen.findByText(/Live Shared Grade Tracker/i),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Shared Friend V1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ASTRO101')).toBeInTheDocument();

    // 2. Opening Share while viewing someone else's share hides owner Live Link controls
    fireEvent.click(screen.getByRole('button', { name: /^Share$/i }));
    const shareDialog = await screen.findByRole('dialog', {
      name: /Share Read-Only View/i,
    });
    expect(
      within(shareDialog).queryByText(/Live Auto-Updating Link/i),
    ).not.toBeInTheDocument();
    expect(
      within(shareDialog).getByText(/One-Time Point-in-Time Snapshot/i),
    ).toBeInTheDocument();
    fireEvent.click(
      within(shareDialog).getByRole('button', { name: /Close share dialog/i }),
    );

    // 3. Turn on What-If Simulator and click `↻ Refresh` -> updates sandboxState too!
    fireEvent.click(screen.getByRole('button', { name: /What-If Simulator/i }));
    expect(screen.getByDisplayValue('ASTRO101')).toBeInTheDocument();

    currentSharedPayload = liveV2;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /↻ Refresh/i }));
    });
    expect(await screen.findByDisplayValue('ASTRO202')).toBeInTheDocument();

    // Exit What-If Simulator
    fireEvent.click(screen.getByRole('button', { name: /Exit Simulator/i }));

    // 4. Navigating back to `#` via hashchange exits shared view cleanly
    await act(async () => {
      window.history.replaceState({}, '', '/');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(
      screen.queryByText(/Live Shared Grade Tracker/i),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Tracker owner or label')).toHaveValue('My');

    // 5. Re-enter `#view=` and verify `Save Copy Locally` requires confirmation before overwriting
    await act(async () => {
      window.history.replaceState({}, '', `/#view=${token}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(
      await screen.findByText(/Live Shared Grade Tracker/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Save Copy Locally/i }));
    const confirmDialog = screen.getByRole('alertdialog', {
      name: /Replace Your Tracker Courses\?/i,
    });
    expect(storageService.load().studentName).toBe('My');

    fireEvent.click(
      within(confirmDialog).getByRole('button', { name: /Replace My Courses/i }),
    );
    expect(storageService.load().studentName).toBe('Shared Friend V2');
    expect(screen.getByLabelText('Tracker owner or label')).toHaveValue(
      'Shared Friend V2',
    );
  });

  it('closes CloudSyncModal, ShareModal, ScaleEditorModal, and SyncConflictModal on Escape key (#17)', async () => {
    const { cloudSyncManager } = await import('../../src/services/cloudSync.js');
    render(<App />);

    // 1. CloudSyncModal
    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/i }));
    expect(
      screen.getByRole('dialog', { name: /Sign In to Sync/i }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      screen.queryByRole('dialog', { name: /Sign In to Sync/i }),
    ).not.toBeInTheDocument();

    // 2. ShareModal
    fireEvent.click(screen.getByRole('button', { name: /^Share$/i }));
    expect(
      await screen.findByRole('dialog', { name: /Share Read-Only View/i }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      screen.queryByRole('dialog', { name: /Share Read-Only View/i }),
    ).not.toBeInTheDocument();

    // 3. ScaleEditorModal
    fireEvent.click(screen.getByRole('button', { name: /Customize/i }));
    expect(
      screen.getByRole('dialog', { name: /Customize Grading Scale/i }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      screen.queryByRole('dialog', { name: /Customize Grading Scale/i }),
    ).not.toBeInTheDocument();

    // 4. SyncConflictModal
    try {
      act(() => {
        cloudSyncManager.currentUser = { uid: 'u-esc', email: 'e@example.com' };
        cloudSyncManager.status = 'conflict';
        cloudSyncManager.conflict = {
          reason: 'remote-deleted',
          remoteState: null,
          remoteRev: 0,
          remoteShareToken: null,
        };
        cloudSyncManager.emit();
      });
      expect(
        await screen.findByRole('alertdialog', {
          name: /Cloud Data Deleted on Another Device/i,
        }),
      ).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(
        screen.queryByRole('alertdialog', {
          name: /Cloud Data Deleted on Another Device/i,
        }),
      ).not.toBeInTheDocument();
    } finally {
      act(() => {
        cloudSyncManager.currentUser = null;
        cloudSyncManager.conflict = null;
        cloudSyncManager.status = 'disconnected';
        cloudSyncManager.clearMeta();
        cloudSyncManager.emit();
      });
    }
  });

  it('does not confirm ConfirmDeleteModal on Enter when Cancel is focused and clears What-If delete modals on back-navigation (Cluster 3 QA)', async () => {
    const { createInitialState } = await import('../../src/domain/templates.js');
    const token = 'B'.repeat(32);
    const sharedPayload = createInitialState();
    sharedPayload.studentName = 'Friend';
    mockGetDoc.mockImplementation(async (ref) => {
      if (ref.path === `shares/${token}`) {
        return {
          exists: () => true,
          data: () => ({
            ownerUid: 'friend-uid',
            stateJson: JSON.stringify(sharedPayload),
            updatedAt: 'ts-1',
          }),
        };
      }
      return { exists: () => false, data: () => undefined };
    });

    window.history.replaceState({}, '', `/#view=${token}`);
    render(<App />);
    expect(
      await screen.findByText(/Live Shared Grade Tracker/i),
    ).toBeInTheDocument();

    // 1. Open Save Copy Locally -> focus Cancel -> press Enter -> must NOT confirm!
    fireEvent.click(screen.getByRole('button', { name: /Save Copy Locally/i }));
    const confirmDialog = screen.getByRole('alertdialog', {
      name: /Replace Your Tracker Courses\?/i,
    });
    const cancelBtn = within(confirmDialog).getByRole('button', {
      name: /^Cancel$/i,
    });
    cancelBtn.focus();
    fireEvent.keyDown(cancelBtn, { key: 'Enter', bubbles: true });
    expect(storageService.load().studentName).toBe('My');
    fireEvent.click(cancelBtn);

    // 2. Enter What-If Simulator on shared view, open Delete Course modal, then navigate Back -> modal MUST close!
    fireEvent.click(screen.getByRole('button', { name: /What-If Simulator/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete ECON101' }));
    expect(
      screen.getByRole('alertdialog', { name: /Delete course/i }),
    ).toBeInTheDocument();

    await act(async () => {
      window.history.replaceState({}, '', '/');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(
      screen.queryByRole('alertdialog', { name: /Delete course/i }),
    ).not.toBeInTheDocument();
  });

  it('allows clearing a Course Code input to empty without crashing and reverts cleanly on blur (#33)', () => {
    render(<App />);
    const codeInput = screen.getByDisplayValue('ECON101');
    const undoBtn = screen.getByRole('button', { name: /↶ Undo/i });
    expect(undoBtn).toBeDisabled();

    // Clearing directly via change (even without focus) keeps the app mounted and shows ''
    fireEvent.change(codeInput, { target: { value: '' } });
    expect(screen.getByText('Cumulative GPA')).toBeInTheDocument();
    expect(codeInput).toHaveValue('');

    // Blurring an empty draft restores the previous valid course code without creating bogus history
    fireEvent.blur(codeInput);
    expect(codeInput).toHaveValue('ECON101');
    expect(storageService.load().terms[0].courses[0].code).toBe('ECON101');
    expect(undoBtn).toBeDisabled();

    // Focusing, typing a partial edit, then clearing to '' never strands 'M' in storage and leaves Undo clean on blur
    fireEvent.focus(codeInput);
    fireEvent.change(codeInput, { target: { value: 'M' } });
    fireEvent.change(codeInput, { target: { value: '' } });
    expect(codeInput).toHaveValue('');
    expect(storageService.load().terms[0].courses[0].code).toBe('ECON101');
    fireEvent.blur(codeInput);
    expect(codeInput).toHaveValue('ECON101');
    expect(storageService.load().terms[0].courses[0].code).toBe('ECON101');
    expect(undoBtn).toBeDisabled();
  });

  it('preserves trailing and internal spaces while typing owner names ("Jane Doe") and course codes ("MATH 101"), and does not snap cleared owner name to "My" until blur (#34)', () => {
    render(<App />);
    const ownerInput = screen.getByLabelText('Tracker owner or label');

    // Clearing owner input stays empty while editing rather than snapping immediately to "My"
    fireEvent.focus(ownerInput);
    fireEvent.change(ownerInput, { target: { value: '' } });
    expect(ownerInput).toHaveValue('');

    // Typing "Jane Doe" one character at a time preserves "Jane " mid-stream
    let currentOwner = '';
    for (const ch of 'Jane Doe') {
      currentOwner += ch;
      fireEvent.change(ownerInput, { target: { value: currentOwner } });
      expect(ownerInput).toHaveValue(currentOwner);
    }
    fireEvent.blur(ownerInput);
    expect(ownerInput).toHaveValue('Jane Doe');
    expect(storageService.load().studentName).toBe('Jane Doe');

    // Clearing "Jane Doe" and blurring resets cleanly to "My"
    fireEvent.focus(ownerInput);
    fireEvent.change(ownerInput, { target: { value: '   ' } });
    expect(ownerInput).toHaveValue('   ');
    fireEvent.blur(ownerInput);
    expect(ownerInput).toHaveValue('My');
    expect(storageService.load().studentName).toBe('My');

    // Typing "MATH 101" character by character into Course Code preserves "MATH "
    const codeInput = screen.getByDisplayValue('ECON101');
    fireEvent.focus(codeInput);
    let currentCode = '';
    for (const ch of 'MATH 101') {
      currentCode += ch;
      fireEvent.change(codeInput, { target: { value: currentCode } });
      expect(codeInput).toHaveValue(currentCode);
    }
    fireEvent.blur(codeInput);
    expect(codeInput).toHaveValue('MATH 101');
    expect(storageService.load().terms[0].courses[0].code).toBe('MATH 101');
  });

  it('catches unexpected render errors in <ErrorBoundary> and allows recovery without losing local data (#33)', async () => {
    const { default: ErrorBoundary } = await import(
      '../../src/components/ErrorBoundary.jsx'
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;

    function FragileChild() {
      if (shouldThrow) {
        throw new Error('Simulated render boom');
      }
      return <div>Recovered tracker view</div>;
    }

    try {
      render(
        <ErrorBoundary
          onReset={() => {
            shouldThrow = false;
          }}
        >
          <FragileChild />
        </ErrorBoundary>,
      );

      const alertBox = screen.getByRole('alert');
      expect(within(alertBox).getByText(/Something went wrong/i)).toBeInTheDocument();
      expect(within(alertBox).getByText(/Simulated render boom/i)).toBeInTheDocument();
      expect(
        within(alertBox).getByRole('button', { name: /Download Local Backup/i }),
      ).toBeInTheDocument();

      fireEvent.click(within(alertBox).getByRole('button', { name: /Reload Tracker/i }));
      expect(screen.getByText('Recovered tracker view')).toBeInTheDocument();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('does not create Undo entries, touch lastUpdated, or call storageService.save when focusing and blurring unchanged cells (#35)', () => {
    render(<App />);
    const initialLastUpdated = storageService.load().lastUpdated;
    const saveSpy = vi.spyOn(storageService, 'save');

    try {
      const undoBtn = screen.getByRole('button', { name: /↶ Undo/i });
      const ecoSection = screen.getByRole('region', { name: 'Course ECON101' });
      const gradeInputs = within(ecoSection).getAllByLabelText(
        /ECON101 .* grade percent/i,
      );
      const weightInputs = within(ecoSection).getAllByLabelText(
        /ECON101 .* weight percent/i,
      );

      // Graded cell focus -> blur
      fireEvent.focus(gradeInputs[0]);
      fireEvent.blur(gradeInputs[0]);

      // Blank grade cell focus -> blur
      const blankCell = gradeInputs.find((el) => el.value === '');
      fireEvent.focus(blankCell);
      fireEvent.blur(blankCell);

      // Weight cell focus -> blur
      fireEvent.focus(weightInputs[0]);
      fireEvent.blur(weightInputs[0]);

      expect(undoBtn).toBeDisabled();
      expect(saveSpy).not.toHaveBeenCalled();
      expect(storageService.load().lastUpdated).toBe(initialLastUpdated);
    } finally {
      saveSpy.mockRestore();
    }
  });

  it('parses comma decimals ("85,5"), rejects hex/exponent strings ("0x10", "1e2"), and warns on values > 100% (#47)', () => {
    render(<App />);
    const ecoSection = screen.getByRole('region', { name: 'Course ECON101' });
    const gradeInputs = within(ecoSection).getAllByLabelText(
      /ECON101 .* grade percent/i,
    );
    const cell = gradeInputs[0];
    const originalVal = cell.value;

    // Reject hex and scientific notation
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: '0x10' } });
    fireEvent.blur(cell);
    expect(cell).toHaveValue(originalVal);

    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: '1e2' } });
    fireEvent.blur(cell);
    expect(cell).toHaveValue(originalVal);

    // Accept European comma decimal "85,5" -> 85.50, leading ".5" -> 0.50, and trailing "85." -> 85.00
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: '85,5' } });
    fireEvent.blur(cell);
    expect(cell).toHaveValue('85.50');
    expect(storageService.load().terms[0].courses[0].categories[0].grade).toBe(85.5);
    expect(cell).not.toHaveClass('cell-warn');

    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: '.5' } });
    fireEvent.blur(cell);
    expect(cell).toHaveValue('0.50');
    expect(storageService.load().terms[0].courses[0].categories[0].grade).toBe(0.5);

    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: '85.' } });
    fireEvent.blur(cell);
    expect(cell).toHaveValue('85.00');
    expect(storageService.load().terms[0].courses[0].categories[0].grade).toBe(85);

    // Values > 100 apply inline warning class
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: '105' } });
    fireEvent.blur(cell);
    expect(cell).toHaveValue('105.00');
    expect(cell).toHaveClass('cell-warn');
  });

  it('shows confirmation toasts without any toast Undo button while toolbar Undo still restores deletions (#44)', () => {
    render(<App />);
    const undoBtn = screen.getByRole('button', { name: /↶ Undo/i });

    // 1. Delete an assessment row -> toast has text and NO button
    const ecoSection = screen.getByRole('region', { name: 'Course ECON101' });
    const table = within(ecoSection).getByRole('table');
    const rowCountBefore = within(table).getAllByRole('row').length;
    fireEvent.click(within(table).getAllByRole('button', { name: /^Delete /i })[0]);
    fireEvent.click(within(table).getByRole('button', { name: /^Confirm delete /i }));

    const rowToast = screen.getByRole('status');
    expect(rowToast).toHaveTextContent(/Deleted "/i);
    expect(within(rowToast).queryByRole('button')).toBeNull();

    fireEvent.click(undoBtn);
    expect(within(table).getAllByRole('row').length).toBe(rowCountBefore);

    // 2. Delete a course -> toast has text and NO button, toolbar Undo restores course
    fireEvent.click(screen.getByRole('button', { name: 'Delete ECON101' }));
    fireEvent.click(screen.getByRole('button', { name: /^Delete Course$/i }));

    const courseToast = screen.getByRole('status');
    expect(courseToast).toHaveTextContent(/Deleted course "ECON101"\./i);
    expect(within(courseToast).queryByRole('button')).toBeNull();

    fireEvent.click(undoBtn);
    expect(screen.getByDisplayValue('ECON101')).toBeInTheDocument();
  });

  it('keeps UI toggles local without Firestore batch writes (#42) and preserves collapsed/activeTermId across Undo and Ctrl+Y Redo (#52)', async () => {
    const { cloudSyncManager } = await import('../../src/services/cloudSync.js');
    const commitSpy = vi.fn().mockResolvedValue(undefined);
    const origFactory = cloudSyncManager.firebaseFactory;
    cloudSyncManager.firebaseFactory = () => ({
      ...origFactory(),
      writeBatch: () => ({
        set: vi.fn(),
        delete: vi.fn(),
        commit: commitSpy,
      }),
    });

    try {
      render(<App />);

      // Add a second term, switch back to Fall Term, and edit ECON101 grade
      fireEvent.click(screen.getByRole('button', { name: /\+ Add Term/i }));
      const tabs = screen.getAllByRole('tab');
      fireEvent.click(tabs[0]);

      const ecoSection = screen.getByRole('region', { name: 'Course ECON101' });
      const firstGrade = within(ecoSection).getAllByLabelText(
        /ECON101 .* grade percent/i,
      )[0];
      fireEvent.focus(firstGrade);
      fireEvent.change(firstGrade, { target: { value: '99' } });
      fireEvent.blur(firstGrade);
      await act(async () => {
        await Promise.resolve();
      });

      // Simulate active signed-in synced state and verify UI toggles do NOT trigger writeBatch.commit
      act(() => {
        cloudSyncManager.currentUser = { uid: 'u-42', email: 'u@example.com' };
        cloudSyncManager.status = 'synced';
        cloudSyncManager.saveMeta({
          lastSyncedUid: 'u-42',
          lastSyncedRev: 1,
          dirty: false,
        });
        cloudSyncManager.lastSyncedStateSnapshot = storageService.load();
        cloudSyncManager.emit();
      });
      commitSpy.mockClear();

      // Collapse ECON101 and switch to Term 2 -> local only, zero cloud commits!
      fireEvent.click(screen.getByRole('button', { name: 'Collapse ECON101' }));
      fireEvent.click(screen.getAllByRole('tab')[1]);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
      expect(commitSpy).not.toHaveBeenCalled();

      // Undo the grade edit while on Term 2 -> stays on Term 2 AND keeps ECON101 collapsed!
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /↶ Undo/i }));
        await Promise.resolve();
      });
      expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
      expect(storageService.load().terms[0].courses[0].collapsed).toBe(true);
      expect(storageService.load().terms[0].courses[0].categories[0].grade).not.toBe(99);

      // Ctrl+Y Redo restores grade 99 while still keeping Term 2 active and ECON101 collapsed!
      await act(async () => {
        fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
        await Promise.resolve();
      });
      expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
      expect(storageService.load().terms[0].courses[0].collapsed).toBe(true);
      expect(storageService.load().terms[0].courses[0].categories[0].grade).toBe(99);
    } finally {
      cloudSyncManager.cancelDebounce();
      cloudSyncManager.firebaseFactory = origFactory;
      act(() => {
        cloudSyncManager.currentUser = null;
        cloudSyncManager.status = 'disconnected';
        cloudSyncManager.clearMeta();
        cloudSyncManager.emit();
      });
    }
  });

  it('surfaces a corrupt-load recovery banner with Download Backup (#36) and pauses editing on SchemaTooNewError (#37)', async () => {
    const { createInitialState } = await import('../../src/domain/templates.js');
    const corrupt = createInitialState();
    corrupt.studentName = 'Salvaged Student';
    corrupt.terms[0].courses[0].units = 999; // invalid (>100), sibling courses survive
    window.localStorage.setItem('grade_tracker_v1', JSON.stringify(corrupt));

    const { unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(screen.getByDisplayValue('Salvaged Student')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('ECON101')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('MATH101')).toBeInTheDocument();

    const recoveryAlert = screen.getByRole('alert');
    expect(recoveryAlert).toHaveTextContent(/Recovered Saved Courses/i);
    expect(
      within(recoveryAlert).getByRole('button', { name: /Download Backup/i }),
    ).toBeInTheDocument();
    fireEvent.click(within(recoveryAlert).getByRole('button', { name: /Dismiss/i }));
    expect(screen.queryByText(/Recovered Saved Courses/i)).not.toBeInTheDocument();
    unmount();

    // Now seed a v2 document in localStorage -> App shows App Update Required and locks inputs read-only without overwriting v2 data!
    const rawV2 = JSON.stringify({ ...createInitialState(), version: 2 });
    window.localStorage.setItem('grade_tracker_v1', rawV2);
    try {
      render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      expect(screen.getByRole('alert')).toHaveTextContent(/App Update Required/i);
      expect(screen.getByLabelText('Tracker owner or label')).toBeDisabled();
      // Collapsing a course works cleanly in-memory without touching localStorage
      fireEvent.click(screen.getByRole('button', { name: 'Collapse ECON101' }));
      expect(screen.getByRole('button', { name: 'Expand ECON101' })).toBeInTheDocument();
      expect(window.localStorage.getItem('grade_tracker_v1')).toBe(rawV2);
    } finally {
      window.localStorage.clear();
      storageService.load();
    }
  });

  it('displays Custom (<pct>%) in Target select (#40), enforces 0% floor/duplicate/overlap/gap rules + 12.0 GPA scales in ScaleEditorModal (#38), and flips 55% Pass/Fail courses to NP on 60% custom pass scales (#39)', async () => {
    const { createInitialState } = await import('../../src/domain/templates.js');
    const seeded = createInitialState();
    seeded.terms[0].courses[0].targetPct = 88;
    // Set MATH101 to Pass/Fail with a single 55% graded exam (P under default 50% threshold, NP under 60% threshold)
    seeded.terms[0].courses[1].passFail = true;
    seeded.terms[0].courses[1].categories = [
      { id: 'm-pf', name: 'Midterm', weight: 60, grade: 55 },
      { id: 'm-fin', name: 'Final', weight: 40, grade: null },
    ];
    window.localStorage.setItem('grade_tracker_v1', JSON.stringify(seeded));

    render(<App />);

    const targetSelect = screen.getByLabelText('ECON101 target grade');
    expect(targetSelect.value).toBe('88');
    expect(within(targetSelect).getByRole('option', { name: 'Custom (88%)' })).toBeInTheDocument();

    const mathSection = screen.getByRole('region', { name: 'Course MATH101' });
    expect(within(mathSection).getByTitle('Letter Grade')).toHaveTextContent('P');

    // Open Customize Grading Scale modal and remove the 0–49% F band
    fireEvent.click(screen.getByRole('button', { name: /Customize/i }));
    const dialog = screen.getByRole('dialog', { name: /Customize Grading Scale/i });
    const removeButtons = within(dialog).getAllByTitle('Remove band');
    fireEvent.click(removeButtons[removeButtons.length - 1]);

    // Saving without a 0% floor band must show an error and keep the dialog open
    fireEvent.click(within(dialog).getByRole('button', { name: /Save Scale/i }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/0% floor band/i);

    // Add back a 0% band, then blank out Row 1 Min % -> must reject empty string instead of coercing Number('') === 0!
    fireEvent.click(within(dialog).getByRole('button', { name: /\+ Add Band/i }));
    const numberInputs = within(dialog).getAllByRole('spinbutton');
    fireEvent.change(numberInputs[0], { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save Scale/i }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/invalid or blank values/i);

    // Duplicate Min % (85 === Row 2's 85) -> must reject duplicate Min %
    fireEvent.change(numberInputs[0], { target: { value: '85' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save Scale/i }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Duplicate Min %/i);

    // Overlapping range (88–100% vs 85–89%) -> must reject overlapping bands
    fireEvent.change(numberInputs[0], { target: { value: '88' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save Scale/i }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/overlap/i);

    // Gap warning note appears when Row 1 is 92–100% leaving 90–91% uncovered
    fireEvent.change(numberInputs[0], { target: { value: '92' } });
    expect(within(dialog).getByText(/Note: Percentage gap between 89% and 92%/i)).toBeInTheDocument();

    // Trim down to a 2-band custom 12-point scale with 60% passing cutoff: [60–100% H (12.0 GPA), 0–59% F (0.0 GPA)]
    while (within(dialog).getAllByTitle('Remove band').length > 2) {
      fireEvent.click(within(dialog).getAllByTitle('Remove band')[1]);
    }
    const twoBandNums = within(dialog).getAllByRole('spinbutton');
    const twoBandText = within(dialog).getAllByRole('textbox');
    // Row 0: 60..100, H, 12.0; Row 1: 0..59, F, 0.0
    fireEvent.change(twoBandNums[0], { target: { value: '60' } });
    fireEvent.change(twoBandNums[1], { target: { value: '100' } });
    fireEvent.change(twoBandText[0], { target: { value: 'H' } });
    fireEvent.change(twoBandNums[2], { target: { value: '12' } });
    fireEvent.change(twoBandNums[3], { target: { value: '0' } });
    fireEvent.change(twoBandNums[4], { target: { value: '59' } });
    fireEvent.change(twoBandText[1], { target: { value: 'F' } });
    fireEvent.change(twoBandNums[5], { target: { value: '0' } });

    fireEvent.click(within(dialog).getByRole('button', { name: /Save Scale/i }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // MATH101 (55% Pass/Fail) dynamically flips from P -> NP, and Target select updates to H / Pass (60%)!
    const updatedMath = screen.getByRole('region', { name: 'Course MATH101' });
    expect(within(updatedMath).getByTitle('Letter Grade')).toHaveTextContent('NP');
    const updatedEconSelect = screen.getByLabelText('ECON101 target grade');
    expect(
      within(updatedEconSelect).getByRole('option', { name: 'H / Pass (60%)' }),
    ).toBeInTheDocument();
    expect(
      within(updatedEconSelect).getByRole('option', { name: 'Custom (88%)' }),
    ).toBeInTheDocument();
  });

  it('traps Tab/Shift+Tab focus inside modals with initial Cancel focus and trigger restoration (#41), supports Arrow/F2 TermTabs, and restricts draggable to the ⋮⋮ handle (#50)', () => {
    render(<App />);

    // 1. Live toast status region is mounted from first render for reliable screen-reader announcements
    expect(screen.getByRole('status')).toBeInTheDocument();

    // 2. Course <section> is NOT draggable as a whole (#50); only its dedicated `.course-drag-handle` is draggable
    const ecoSection = screen.getByRole('region', { name: 'Course ECON101' });
    expect(ecoSection).not.toHaveAttribute('draggable');
    const dragHandle = ecoSection.querySelector('.course-drag-handle');
    expect(dragHandle).not.toBeNull();
    expect(dragHandle).toHaveAttribute('draggable', 'true');

    // Dragging handle 0 and dropping onto course 1 reorders courses cleanly
    const mathSection = screen.getByRole('region', { name: 'Course MATH101' });
    fireEvent.dragStart(dragHandle);
    fireEvent.dragOver(mathSection);
    fireEvent.drop(mathSection);
    fireEvent.dragEnd(dragHandle);
    const regionsAfterDrop = screen.getAllByRole('region', { name: /^Course /i });
    expect(regionsAfterDrop[0]).toHaveAccessibleName('Course MATH101');
    expect(regionsAfterDrop[1]).toHaveAccessibleName('Course ECON101');

    // 3. ConfirmDeleteModal focuses Cancel initially, wraps Tab & Shift+Tab inside the dialog, and restores trigger focus on close (#41)
    const deleteEcoBtn = screen.getByRole('button', { name: 'Delete ECON101' });
    deleteEcoBtn.focus();
    fireEvent.click(deleteEcoBtn);

    const confirmDialog = screen.getByRole('alertdialog');
    const closeBtn = within(confirmDialog).getByRole('button', { name: /Cancel deletion/i });
    const cancelBtn = within(confirmDialog).getByRole('button', { name: /^Cancel$/i });
    const confirmBtn = within(confirmDialog).getByRole('button', { name: /^Delete Course$/i });

    expect(document.activeElement).toBe(cancelBtn);

    // Tab from last focusable button wraps to first focusable button inside the modal
    confirmBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);

    // Shift+Tab from first focusable button wraps back to last focusable button
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirmBtn);

    // Closing modal restores focus to the exact trigger button (`Delete ECON101`)
    fireEvent.click(cancelBtn);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(deleteEcoBtn);

    // 4. TermTabs tablist contains strictly role="tab" children and supports ArrowRight + F2 keyboard rename
    fireEvent.click(screen.getByRole('button', { name: /\+ Add Term/i }));
    const tablist = screen.getByRole('tablist', { name: /Academic Terms/i });
    const tablistChildren = Array.from(tablist.children);
    expect(tablistChildren.every((el) => el.getAttribute('role') === 'tab')).toBe(true);

    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tabs[1], { key: 'ArrowRight' });
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(tabs[0], { key: 'F2' });
    const renameInput = screen.getByLabelText('Term name');
    fireEvent.change(renameInput, { target: { value: 'Winter Term' } });
    fireEvent.keyDown(renameInput, { key: 'Enter' });
    expect(within(tablist).getByRole('tab', { name: 'Winter Term' })).toBeInTheDocument();
  });

  it('normalizes legacy ?share=<token> query links into #share=<token> URL fragments on load (#53)', async () => {
    const { encodeShareSnapshot } = await import('../../src/services/share.js');
    const { createInitialState } = await import('../../src/domain/templates.js');
    const sample = createInitialState();
    sample.studentName = 'Query Shared';
    const token = await encodeShareSnapshot(sample);

    window.history.replaceState({}, '', `/grade-tracker/?utm_source=1&share=${encodeURIComponent(token)}`);
    expect(window.location.search).toContain('share=');

    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Query Shared')).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Read-Only Shared Snapshot/i).length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe('/grade-tracker/');
    expect(window.location.search).toBe('?utm_source=1');
    expect(window.location.hash).toBe(`#share=${token}`);
    unmount();

    // Corrupt snapshot in query/hash cleans up broken share param and loads local tracker
    window.history.replaceState({}, '', '/?share=corrupt-payload');
    render(<App />);
    await waitFor(() => {
      expect(window.location.search).toBe('');
      expect(window.location.hash).toBe('');
    });
  });

  it('passes automated axe accessibility checks across the main ledger and modal dialogs (#41, #54)', async () => {
    const { axe } = await import('vitest-axe');
    // jsdom does not implement HTMLCanvasElement.getContext needed by axe color-contrast; contrast ratios are enforced via WCAG 2.2 AA tokens in index.css
    const axeOpts = { rules: { 'color-contrast': { enabled: false } } };
    const { container } = render(<App />);

    // 1. Main ledger view
    const mainResults = await axe(container, axeOpts);
    expect(mainResults.violations).toEqual([]);

    // 2. Customize Grading Scale modal
    fireEvent.click(screen.getByRole('button', { name: /Customize/i }));
    expect(screen.getByRole('dialog', { name: /Customize Grading Scale/i })).toBeInTheDocument();
    const scaleModalResults = await axe(container, axeOpts);
    expect(scaleModalResults.violations).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Close grading scale editor/i }));

    // 3. Confirm Delete Course modal
    fireEvent.click(screen.getByRole('button', { name: 'Delete ECON101' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    const confirmResults = await axe(container, axeOpts);
    expect(confirmResults.violations).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));

    // 4. Cloud Sync modal
    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const syncResults = await axe(container, axeOpts);
    expect(syncResults.violations).toEqual([]);
    fireEvent.keyDown(document, { key: 'Escape' });

    // 5. Share modal
    fireEvent.click(screen.getByRole('button', { name: /^Share$/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Share Read-Only View/i })).toBeInTheDocument();
    });
    const shareResults = await axe(container, axeOpts);
    expect(shareResults.violations).toEqual([]);
  }, 20000);

  it('renders the graded-weight mini progress bar fill with block display and matching width (#71)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    render(<App />);

    // ECON101 sample course has 60% of 100% syllabus weight graded
    const ecoSection = screen.getByRole('region', { name: 'Course ECON101' });
    const fillEl = ecoSection.querySelector('.progress-mini-fill');
    expect(fillEl).not.toBeNull();
    expect(fillEl.style.width).toBe('60%');

    // Guard against `<span class="progress-mini-fill">` collapsing to 0x0 as an inline element
    const cssSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/styles/index.css'),
      'utf8',
    );
    const ruleMatch = cssSource.match(/\.progress-mini-fill\s*\{([^}]*)\}/);
    expect(ruleMatch).not.toBeNull();
    expect(ruleMatch[1]).toMatch(/display:\s*block\s*;/);
  });

  it('restores non-inert app state and origin trigger focus across modal-to-modal hand-offs (#74) while keeping .toast-live-region non-inert (#75)', async () => {
    const { cloudSyncManager } = await import('../../src/services/cloudSync.js');
    const { createInitialState } = await import('../../src/domain/templates.js');
    const { container } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    const appRoot = container.querySelector('.app-root');
    const headerEl = container.querySelector('header');
    const mainEl = container.querySelector('main');
    const shareBtn = screen.getByRole('button', { name: /^Share$/i });

    // 1. Flow A: ShareModal -> "Sign in with Google to Enable Live Link" -> CloudSyncModal -> Close
    shareBtn.focus();
    fireEvent.click(shareBtn);
    const shareDialog = await screen.findByRole('dialog', {
      name: /Share Read-Only View/i,
    });

    // While modal is open, header & main are inert, whereas .toast-live-region stays non-inert (#75)
    expect(Boolean(headerEl.inert)).toBe(true);
    expect(Boolean(mainEl.inert)).toBe(true);
    const toastRegion = container.querySelector('.toast-live-region');
    expect(toastRegion).not.toBeNull();
    expect(Boolean(toastRegion.inert)).toBe(false);
    expect(toastRegion.closest('[inert]')).toBeNull();

    // Hand off from ShareModal directly to CloudSyncModal in the same commit
    fireEvent.click(
      within(shareDialog).getByRole('button', {
        name: /Sign in with Google to Enable Live Link/i,
      }),
    );
    expect(
      screen.queryByRole('dialog', { name: /Share Read-Only View/i }),
    ).not.toBeInTheDocument();
    const syncDialog = screen.getByRole('dialog');
    expect(Boolean(headerEl.inert)).toBe(true);
    expect(Boolean(mainEl.inert)).toBe(true);
    expect(toastRegion.closest('[inert]')).toBeNull();

    // Close CloudSyncModal -> zero [inert] elements remain and focus returns to original Share button!
    fireEvent.click(
      within(syncDialog).getByRole('button', { name: /Close account dialog/i }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(Boolean(headerEl.inert)).toBe(false);
    expect(Boolean(mainEl.inert)).toBe(false);
    expect(
      Array.from(appRoot.querySelectorAll('*')).some((el) => Boolean(el.inert)),
    ).toBe(false);
    expect(document.activeElement).toBe(shareBtn);

    // 2. Flow B: Sign In -> CloudSyncModal -> initial-merge SyncConflictModal hand-off -> Resolve
    const signInBtn = screen.getByRole('button', { name: /^Sign In$/i });
    signInBtn.focus();
    fireEvent.click(signInBtn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const origResolveConflict = cloudSyncManager.resolveConflict.bind(cloudSyncManager);
    cloudSyncManager.resolveConflict = vi.fn(async () => {
      cloudSyncManager.conflict = null;
      cloudSyncManager.status = 'synced';
      cloudSyncManager.emit();
      return cloudSyncManager.getSnapshot();
    });

    try {
      const remoteState = createInitialState();
      remoteState.studentName = 'Cloud Student';
      act(() => {
        cloudSyncManager.currentUser = {
          uid: 'u-handoff',
          email: 'u@example.com',
          displayName: 'User',
        };
        cloudSyncManager.status = 'conflict';
        cloudSyncManager.conflict = {
          reason: 'initial-merge',
          remoteState,
          remoteRev: 1,
          remoteShareToken: null,
        };
        cloudSyncManager.emit();
      });

      const conflictDialog = await screen.findByRole('alertdialog', {
        name: /Cloud Sync Version Conflict/i,
      });
      expect(Boolean(mainEl.inert)).toBe(true);

      fireEvent.click(
        within(conflictDialog).getByRole('button', {
          name: /Keep This Device/i,
        }),
      );

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
      expect(Boolean(headerEl.inert)).toBe(false);
      expect(Boolean(mainEl.inert)).toBe(false);
      expect(
        Array.from(appRoot.querySelectorAll('*')).some((el) => Boolean(el.inert)),
      ).toBe(false);
    } finally {
      cloudSyncManager.resolveConflict = origResolveConflict;
      act(() => {
        cloudSyncManager.currentUser = null;
        cloudSyncManager.conflict = null;
        cloudSyncManager.status = 'disconnected';
        cloudSyncManager.clearMeta();
        cloudSyncManager.emit();
      });
    }
  });

  it('preserves >2-decimal stored values (33.333 weights and 85.305 grades) on unedited focus and blur without Undo or storage writes (#76)', async () => {
    const { createInitialState } = await import('../../src/domain/templates.js');
    const seeded = createInitialState();
    seeded.terms[0].courses[0].categories = [
      { id: 'c-1', name: 'Exam 1', weight: 33.333, grade: 85.305 },
      { id: 'c-2', name: 'Exam 2', weight: 33.333, grade: null },
      { id: 'c-3', name: 'Exam 3', weight: 33.333, grade: null },
    ];
    window.localStorage.setItem('grade_tracker_v1', JSON.stringify(seeded));

    const saveSpy = vi.spyOn(storageService, 'save');
    try {
      render(<App />);
      saveSpy.mockClear();

      const undoBtn = screen.getByRole('button', { name: /↶ Undo/i });
      const ecoSection = screen.getByRole('region', { name: 'Course ECON101' });
      const weightInputs = within(ecoSection).getAllByLabelText(
        /ECON101 .* weight percent/i,
      );
      const gradeInputs = within(ecoSection).getAllByLabelText(
        /ECON101 .* grade percent/i,
      );

      // Unfocused display shows 2-decimal half-up values ("33.33" and "85.31") and total weight 100.00% without warning
      expect(weightInputs[0]).toHaveValue('33.33');
      expect(gradeInputs[0]).toHaveValue('85.31');
      const weightStatus = ecoSection.querySelector('.weight-status');
      expect(weightStatus).toHaveTextContent('Weight: 100.00%');
      expect(weightStatus).not.toHaveClass('weight-warn');

      // Focusing reveals full stored precision ("33.333" and "85.305"), and blurring without edits preserves exact stored values
      for (const wInput of weightInputs) {
        fireEvent.focus(wInput);
        expect(wInput).toHaveValue('33.333');
        fireEvent.blur(wInput);
        expect(wInput).toHaveValue('33.33');
      }

      fireEvent.focus(gradeInputs[0]);
      expect(gradeInputs[0]).toHaveValue('85.305');
      fireEvent.blur(gradeInputs[0]);
      expect(gradeInputs[0]).toHaveValue('85.31');

      expect(undoBtn).toBeDisabled();
      expect(saveSpy).not.toHaveBeenCalled();
      expect(weightStatus).toHaveTextContent('Weight: 100.00%');
      expect(weightStatus).not.toHaveClass('weight-warn');

      const storedCategories = storageService.load().terms[0].courses[0].categories;
      expect(storedCategories.map((c) => c.weight)).toEqual([33.333, 33.333, 33.333]);
      expect(storedCategories[0].grade).toBe(85.305);
    } finally {
      saveSpy.mockRestore();
    }
  });
});
