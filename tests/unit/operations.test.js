import { describe, it, expect } from 'vitest';
import { createInitialState, createNewTerm } from '../../src/domain/templates.js';
import {
  reorderArray,
  reorderCoursesInTerm,
  reorderCategoriesInCourse,
  moveCourseToTerm,
  duplicateCourseInTerm,
  setAllCoursesCollapsed,
} from '../../src/domain/operations.js';

describe('Immutable Domain Operations (operations.js)', () => {
  it('reorders arrays cleanly without mutating the source array and handles invalid indices safely', () => {
    const orig = ['a', 'b', 'c', 'd'];
    expect(reorderArray(orig, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderArray(orig, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(orig).toEqual(['a', 'b', 'c', 'd']);

    expect(reorderArray(orig, 1, 1)).toEqual(['a', 'b', 'c', 'd']);
    expect(reorderArray(orig, -1, 2)).toEqual(['a', 'b', 'c', 'd']);
    expect(reorderArray(orig, 0, 99)).toEqual(['a', 'b', 'c', 'd']);
    expect(reorderArray(null, 0, 1)).toEqual([]);
  });

  it('reorders courses within a term immutably', () => {
    const state = createInitialState();
    const termId = state.terms[0].id;
    const next = reorderCoursesInTerm(state, termId, 0, 2);

    expect(next).not.toBe(state);
    expect(next.terms[0].courses.map((c) => c.code)).toEqual(['MATH101', 'CS101', 'ECON101']);
    expect(state.terms[0].courses.map((c) => c.code)).toEqual(['ECON101', 'MATH101', 'CS101']);

    // Out of bounds / unknown term returns original state reference
    expect(reorderCoursesInTerm(state, 'missing', 0, 1)).toBe(state);
    expect(reorderCoursesInTerm(state, termId, 0, 10)).toBe(state);
  });

  it('reorders categories within a course immutably', () => {
    const state = createInitialState();
    const termId = state.terms[0].id;
    const courseId = state.terms[0].courses[0].id;
    const next = reorderCategoriesInCourse(state, termId, courseId, 3, 0);

    expect(next).not.toBe(state);
    expect(next.terms[0].courses[0].categories.map((k) => k.name)).toEqual([
      'Final Exam',
      'Quizzes',
      'Midterm 1',
      'Assignments',
    ]);
    expect(state.terms[0].courses[0].categories.map((k) => k.name)).toEqual([
      'Quizzes',
      'Midterm 1',
      'Assignments',
      'Final Exam',
    ]);

    expect(reorderCategoriesInCourse(state, termId, 'missing', 0, 1)).toBe(state);
    expect(reorderCategoriesInCourse(state, termId, courseId, -1, 1)).toBe(state);
  });

  it('moves a course between terms to the end of the target term and no-ops on same/missing term', () => {
    const state = createInitialState();
    const term1 = state.terms[0];
    const term2 = createNewTerm(1);
    state.terms.push(term2);

    const movedCourseId = term1.courses[1].id; // MATH101
    const next = moveCourseToTerm(state, term1.id, term2.id, movedCourseId);

    expect(next.terms[0].courses.map((c) => c.code)).toEqual(['ECON101', 'CS101']);
    expect(next.terms[1].courses.map((c) => c.code)).toEqual(['COURSE101', 'MATH101']);
    expect(state.terms[0].courses.map((c) => c.code)).toEqual(['ECON101', 'MATH101', 'CS101']);

    expect(moveCourseToTerm(state, term1.id, term1.id, movedCourseId)).toBe(state);
    expect(moveCourseToTerm(state, term1.id, 'missing-term', movedCourseId)).toBe(state);
    expect(moveCourseToTerm(state, term1.id, term2.id, 'missing-course')).toBe(state);
  });

  it('duplicates a course right after the source course with cleared grades and fresh IDs', () => {
    const state = createInitialState();
    const termId = state.terms[0].id;
    const sourceCourse = state.terms[0].courses[0];
    sourceCourse.collapsed = true;

    const next = duplicateCourseInTerm(state, termId, sourceCourse.id);
    expect(next.terms[0].courses.map((c) => c.code)).toEqual([
      'ECON101',
      'ECON101-COPY',
      'MATH101',
      'CS101',
    ]);

    const copy = next.terms[0].courses[1];
    expect(copy.id).not.toBe(sourceCourse.id);
    expect(copy.collapsed).toBe(false);
    expect(copy.units).toBe(sourceCourse.units);
    expect(copy.duration).toBe(sourceCourse.duration);
    expect(copy.categories.map((c) => ({ name: c.name, weight: c.weight, grade: c.grade }))).toEqual(
      sourceCourse.categories.map((c) => ({ name: c.name, weight: c.weight, grade: null })),
    );
    expect(copy.categories.every((c, idx) => c.id !== sourceCourse.categories[idx].id)).toBe(true);

    // Original remains untouched
    expect(state.terms[0].courses).toHaveLength(3);
    expect(state.terms[0].courses[0].categories[0].grade).toBe(90);
    expect(duplicateCourseInTerm(state, termId, 'missing')).toBe(state);
  });

  it('collapses and expands all courses in a term immutably', () => {
    const state = createInitialState();
    const termId = state.terms[0].id;

    const collapsedState = setAllCoursesCollapsed(state, termId, true);
    expect(collapsedState.terms[0].courses.every((c) => c.collapsed === true)).toBe(true);
    expect(state.terms[0].courses.every((c) => c.collapsed === false)).toBe(true);

    const expandedState = setAllCoursesCollapsed(collapsedState, termId, false);
    expect(expandedState.terms[0].courses.every((c) => c.collapsed === false)).toBe(true);

    expect(setAllCoursesCollapsed(state, 'missing', true)).toBe(state);
  });
});
