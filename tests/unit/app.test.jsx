import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import App from '../../src/App.jsx';

describe('Grade Tracker React Application (M1 + M1.1 + Undo/Redo & Confirmations)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('renders generic initial tracker with sample courses, GPA metrics, and grading scale', () => {
    render(<App />);
    expect(screen.getByLabelText('Tracker owner or label')).toHaveValue('My');
    expect(screen.getByText('Grading Scale')).toBeInTheDocument();
    expect(screen.getByText('Cumulative GPA')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ECON101')).toBeInTheDocument();
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

    // First click reveals "Delete?" inline confirmation without deleting row yet
    fireEvent.click(firstRowDelete);
    const confirmChip = within(table).getByRole('button', { name: /^Confirm delete /i });
    expect(confirmChip).toHaveTextContent('Delete?');

    const rowsBefore = within(table).getAllByRole('row').length;
    fireEvent.click(confirmChip);
    expect(within(table).getAllByRole('row').length).toBe(rowsBefore - 1);

    // Undo restores the assessment row
    fireEvent.click(screen.getByRole('button', { name: /↶ Undo/i }));
    expect(within(table).getAllByRole('row').length).toBe(rowsBefore);
  });

  it('isolates ALL What-If edits (both already-graded and ungraded rows) in memory and reverts 100% on exit (Issue #4)', () => {
    render(<App />);
    const savedBefore = window.localStorage.getItem('grade_tracker_v1');

    // Grab ECON101's already-graded first row and ungraded Final Exam row before entering What-If
    const ecoBefore = screen.getByRole('region', { name: 'Course ECON101' });
    const firstGradeBefore = within(ecoBefore).getAllByLabelText(/ECON101 .* grade percent/i)[0].value;
    expect(firstGradeBefore).not.toBe('');

    // Enter What-If Simulator
    fireEvent.click(screen.getByRole('button', { name: /What-If Simulator/i }));
    expect(screen.getByText(/What-If Exam Simulator ON/i)).toBeInTheDocument();

    const ecoSim = screen.getByRole('region', { name: 'Course ECON101' });
    const simGradeInputs = within(ecoSim).getAllByLabelText(/ECON101 .* grade percent/i);
    const gradedInput = simGradeInputs[0];
    const blankInput = simGradeInputs.find((el) => el.value === '');

    // Change BOTH an already-graded assessment AND a blank ungraded assessment
    fireEvent.focus(gradedInput);
    fireEvent.change(gradedInput, { target: { value: '12.50' } });
    fireEvent.blur(gradedInput);

    fireEvent.focus(blankInput);
    fireEvent.change(blankInput, { target: { value: '98.00' } });
    fireEvent.blur(blankInput);

    expect(screen.getByRole('button', { name: /Reset Simulation \(2\)/i })).toBeInTheDocument();
    // Saved localStorage must remain completely untouched while simulating
    expect(window.localStorage.getItem('grade_tracker_v1')).toBe(savedBefore);

    // Exit What-If Simulator -> ALL values must snap back to original saved state
    fireEvent.click(screen.getByRole('button', { name: /Exit Simulator/i }));
    expect(screen.queryByText(/What-If Exam Simulator ON/i)).not.toBeInTheDocument();

    const ecoAfter = screen.getByRole('region', { name: 'Course ECON101' });
    const afterInputs = within(ecoAfter).getAllByLabelText(/ECON101 .* grade percent/i);
    expect(afterInputs[0].value).toBe(firstGradeBefore);
    expect(afterInputs.some((el) => el.value === '12.50' || el.value === '98.00')).toBe(false);
    expect(window.localStorage.getItem('grade_tracker_v1')).toBe(savedBefore);
  });
});
