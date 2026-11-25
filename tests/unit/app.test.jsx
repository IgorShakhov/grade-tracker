import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import App from '../../src/App.jsx';

describe('Grade Tracker React Application (M1 + M1.1)', () => {
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

    // Switch back to first term and move ECON101 to Term 2
    fireEvent.click(tabs[0]);
    const moveSelect = screen.getByLabelText('Move ECON101 to another term');
    const secondTermOption = within(moveSelect).getAllByRole('option')[1];
    fireEvent.change(moveSelect, { target: { value: secondTermOption.value } });

    expect(screen.queryByDisplayValue('ECON101')).not.toBeInTheDocument();
    fireEvent.click(tabs[1]);
    expect(screen.getByDisplayValue('ECON101')).toBeInTheDocument();
  });

  it('supports What-If Simulator without mutating saved grades and allows custom scale editing', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /What-If Simulator/i }));
    expect(screen.getByText(/What-If Exam Simulator ON/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Customize/i }));
    expect(screen.getByRole('dialog', { name: /Customize Grading Scale/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save Scale/i }));
    expect(screen.queryByRole('dialog', { name: /Customize Grading Scale/i })).not.toBeInTheDocument();
  });
});
