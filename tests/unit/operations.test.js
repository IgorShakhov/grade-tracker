import { describe, it, expect } from 'vitest';
import { createInitialState, createNewTerm } from '../../src/domain/templates.js';
import {
  deriveSubItemLabel,
  reorderArray,
  reorderCoursesInTerm,
  reorderCategoriesInCourse,
  moveCourseToTerm,
  duplicateCourseInTerm,
  setAllCoursesCollapsed,
  splitCategoryIntoSubItems,
  collapseCategoryToSingleScore,
  addSubItemToCategory,
  updateSubItemInCategory,
  deleteSubItemFromCategory,
  reorderSubItemsInCategory,
  setCategoryDropLowest,
  setCategoryItemsExpanded,
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

  it('splits, adds, updates, reorders, drops lowest, duplicates, and merges sub-assessments immutably (#100)', () => {
    expect(deriveSubItemLabel('Weekly Quizzes', 1)).toBe('Quiz 1');
    expect(deriveSubItemLabel('Labs', 2)).toBe('Lab 2');
    expect(deriveSubItemLabel('Assignments', 3)).toBe('Assignment 3');
    expect(deriveSubItemLabel('Participation', 1)).toBe('Item 1');

    const s0 = createInitialState();
    const termId = s0.terms[0].id;
    const courseId = s0.terms[0].courses[0].id;
    const catId = s0.terms[0].courses[0].categories[0].id; // Quizzes (grade: 90)

    const s1 = splitCategoryIntoSubItems(s0, termId, courseId, catId);
    const cat1 = s1.terms[0].courses[0].categories[0];
    expect(cat1.grade).toBeNull();
    expect(cat1.itemsExpanded).toBe(true);
    expect(cat1.items).toHaveLength(2);
    expect(cat1.items[0]).toMatchObject({ name: 'Quiz 1', grade: 90 });
    expect(cat1.items[1]).toMatchObject({ name: 'Quiz 2', grade: null });

    const s2 = addSubItemToCategory(s1, termId, courseId, catId);
    const s3 = updateSubItemInCategory(
      s2,
      termId,
      courseId,
      catId,
      s2.terms[0].courses[0].categories[0].items[1].id,
      { grade: 60 },
    );
    const s4 = setCategoryDropLowest(s3, termId, courseId, catId, 1);
    const s5 = reorderSubItemsInCategory(s4, termId, courseId, catId, 0, 2);
    const s6 = setCategoryItemsExpanded(s5, termId, courseId, catId, false);
    const cat6 = s6.terms[0].courses[0].categories[0];
    expect(cat6.dropLowest).toBe(1);
    expect(cat6.itemsExpanded).toBe(false);
    expect(cat6.items.map((x) => x.name)).toEqual(['Quiz 2', 'Quiz 3', 'Quiz 1']);

    // Duplicating course copies sub-item structure & dropLowest while clearing sub-item grades
    const dupState = duplicateCourseInTerm(s6, termId, courseId);
    const dupCat = dupState.terms[0].courses[1].categories[0];
    expect(dupCat.dropLowest).toBe(1);
    expect(dupCat.items.map((x) => [x.name, x.grade])).toEqual([
      ['Quiz 2', null],
      ['Quiz 3', null],
      ['Quiz 1', null],
    ]);

    // Deleting all sub-items reverts cleanly to single-score category
    let cur = s6;
    for (const sub of cat6.items) {
      cur = deleteSubItemFromCategory(cur, termId, courseId, catId, sub.id);
    }
    expect(cur.terms[0].courses[0].categories[0]).toEqual({
      id: catId,
      name: 'Quizzes',
      weight: 10,
      grade: null,
    });

    // Merging back to single score preserves computed grade
    const merged = collapseCategoryToSingleScore(s4, termId, courseId, catId, 90);
    expect(merged.terms[0].courses[0].categories[0]).toEqual({
      id: catId,
      name: 'Quizzes',
      weight: 10,
      grade: 90,
    });
  });
});
