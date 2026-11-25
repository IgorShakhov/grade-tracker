import { duplicateCourseStructure } from './templates.js';

export function reorderArray(items, fromIndex, toIndex) {
  if (!Array.isArray(items)) return [];
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return items.slice();
  }
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function reorderCoursesInTerm(state, termId, fromIndex, toIndex) {
  if (!state || !Array.isArray(state.terms)) return state;
  const term = state.terms.find((t) => t?.id === termId);
  if (!term || !Array.isArray(term.courses)) return state;
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= term.courses.length ||
    toIndex >= term.courses.length ||
    fromIndex === toIndex
  ) {
    return state;
  }

  return {
    ...state,
    terms: state.terms.map((t) => (
      t.id === termId
        ? { ...t, courses: reorderArray(t.courses, fromIndex, toIndex) }
        : t
    )),
  };
}

export function reorderCategoriesInCourse(state, termId, courseId, fromIndex, toIndex) {
  if (!state || !Array.isArray(state.terms)) return state;
  const term = state.terms.find((t) => t?.id === termId);
  if (!term || !Array.isArray(term.courses)) return state;
  const course = term.courses.find((c) => c?.id === courseId);
  if (!course || !Array.isArray(course.categories)) return state;
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= course.categories.length ||
    toIndex >= course.categories.length ||
    fromIndex === toIndex
  ) {
    return state;
  }

  return {
    ...state,
    terms: state.terms.map((t) => (
      t.id === termId
        ? {
            ...t,
            courses: t.courses.map((c) => (
              c.id === courseId
                ? { ...c, categories: reorderArray(c.categories, fromIndex, toIndex) }
                : c
            )),
          }
        : t
    )),
  };
}

export function moveCourseToTerm(state, fromTermId, toTermId, courseId) {
  if (!state || !Array.isArray(state.terms) || fromTermId === toTermId) return state;
  const fromTerm = state.terms.find((t) => t?.id === fromTermId);
  const toTerm = state.terms.find((t) => t?.id === toTermId);
  if (!fromTerm || !toTerm || !Array.isArray(fromTerm.courses) || !Array.isArray(toTerm.courses)) {
    return state;
  }
  const courseToMove = fromTerm.courses.find((c) => c?.id === courseId);
  if (!courseToMove) return state;

  return {
    ...state,
    terms: state.terms.map((t) => {
      if (t.id === fromTermId) {
        return {
          ...t,
          courses: t.courses.filter((c) => c?.id !== courseId),
        };
      }
      if (t.id === toTermId) {
        return {
          ...t,
          courses: [...t.courses, courseToMove],
        };
      }
      return t;
    }),
  };
}

export function duplicateCourseInTerm(state, termId, courseId) {
  if (!state || !Array.isArray(state.terms)) return state;
  const term = state.terms.find((t) => t?.id === termId);
  if (!term || !Array.isArray(term.courses)) return state;
  const idx = term.courses.findIndex((c) => c?.id === courseId);
  if (idx === -1) return state;

  const duplicated = duplicateCourseStructure(term.courses[idx]);
  return {
    ...state,
    terms: state.terms.map((t) => {
      if (t.id !== termId) return t;
      const nextCourses = [
        ...t.courses.slice(0, idx + 1),
        duplicated,
        ...t.courses.slice(idx + 1),
      ];
      return { ...t, courses: nextCourses };
    }),
  };
}

export function setAllCoursesCollapsed(state, termId, collapsed) {
  if (!state || !Array.isArray(state.terms)) return state;
  const term = state.terms.find((t) => t?.id === termId);
  if (!term || !Array.isArray(term.courses)) return state;
  const nextCollapsed = Boolean(collapsed);

  return {
    ...state,
    terms: state.terms.map((t) => (
      t.id === termId
        ? {
            ...t,
            courses: t.courses.map((c) => ({ ...c, collapsed: nextCollapsed })),
          }
        : t
    )),
  };
}
