import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react';
import { storageService } from '../../src/services/storage.js';

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
    getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined }),
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
});

