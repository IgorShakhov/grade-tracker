import { MAX_SUB_ITEMS_PER_CATEGORY } from './constants.js';
import { duplicateCourseStructure, createNewSubItem } from './templates.js';

export function deriveSubItemLabel(categoryName, itemNumber = 1) {
  const n =
    typeof itemNumber === 'number' && Number.isFinite(itemNumber) && itemNumber >= 1
      ? Math.floor(itemNumber)
      : 1;
  const raw = String(categoryName ?? '').trim();
  if (/quiz/i.test(raw)) return `Quiz ${n}`;
  if (/\blabs?\b/i.test(raw)) return `Lab ${n}`;
  if (/assignment/i.test(raw)) return `Assignment ${n}`;
  if (/homework|\bhw\b/i.test(raw)) return `Homework ${n}`;
  if (/problem\s*set|\bpset\b/i.test(raw)) return `Problem Set ${n}`;
  if (/discussion/i.test(raw)) return `Discussion ${n}`;
  if (/test/i.test(raw)) return `Test ${n}`;
  return `Item ${n}`;
}

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

function updateTargetCategory(state, termId, courseId, catId, transformCat) {
  if (!state || !Array.isArray(state.terms)) return state;
  let changed = false;
  const nextTerms = state.terms.map((t) => {
    if (t.id !== termId || !Array.isArray(t.courses)) return t;
    const nextCourses = t.courses.map((c) => {
      if (c.id !== courseId || !Array.isArray(c.categories)) return c;
      const nextCats = c.categories.map((cat) => {
        if (cat.id !== catId) return cat;
        const updated = transformCat(cat);
        if (updated === cat) return cat;
        changed = true;
        return updated;
      });
      return changed ? { ...c, categories: nextCats } : c;
    });
    return changed ? { ...t, courses: nextCourses } : t;
  });
  return changed ? { ...state, terms: nextTerms } : state;
}

export function splitCategoryIntoSubItems(state, termId, courseId, catId) {
  return updateTargetCategory(state, termId, courseId, catId, (cat) => {
    if (Array.isArray(cat.items) && cat.items.length > 0) {
      return cat.itemsExpanded ? cat : { ...cat, itemsExpanded: true };
    }
    const seedGrade =
      typeof cat.grade === 'number' && Number.isFinite(cat.grade)
        ? (cat.grade === 0 ? 0 : cat.grade)
        : null;
    const item1 = createNewSubItem(1, deriveSubItemLabel(cat.name, 1), seedGrade);
    const item2 = createNewSubItem(2, deriveSubItemLabel(cat.name, 2), null);
    return {
      id: cat.id,
      name: cat.name,
      weight: cat.weight,
      grade: null,
      items: [item1, item2],
      dropLowest: 0,
      itemsExpanded: true,
    };
  });
}

export function collapseCategoryToSingleScore(
  state,
  termId,
  courseId,
  catId,
  mergedGrade = null,
) {
  return updateTargetCategory(state, termId, courseId, catId, (cat) => {
    if (!Array.isArray(cat.items) || cat.items.length === 0) return cat;
    const cleanGrade =
      typeof mergedGrade === 'number' &&
      Number.isFinite(mergedGrade) &&
      mergedGrade >= 0 &&
      mergedGrade <= 1000
        ? (mergedGrade === 0 ? 0 : mergedGrade)
        : null;
    return {
      id: cat.id,
      name: cat.name,
      weight: cat.weight,
      grade: cleanGrade,
    };
  });
}

export function addSubItemToCategory(state, termId, courseId, catId) {
  return updateTargetCategory(state, termId, courseId, catId, (cat) => {
    const currentItems = Array.isArray(cat.items) ? cat.items : [];
    if (currentItems.length >= MAX_SUB_ITEMS_PER_CATEGORY) return cat;
    let maxTrailingNum = 0;
    for (const sub of currentItems) {
      const m = /(\d+)\s*$/.exec(String(sub?.name || ''));
      if (m) {
        const parsed = Number(m[1]);
        if (Number.isFinite(parsed) && parsed > maxTrailingNum) {
          maxTrailingNum = parsed;
        }
      }
    }
    const nextIdx = Math.max(currentItems.length + 1, maxTrailingNum + 1);
    const nextItem = createNewSubItem(
      nextIdx,
      deriveSubItemLabel(cat.name, nextIdx),
      null,
    );
    return {
      id: cat.id,
      name: cat.name,
      weight: cat.weight,
      grade: null,
      items: [...currentItems, nextItem],
      dropLowest:
        typeof cat.dropLowest === 'number' && Number.isInteger(cat.dropLowest)
          ? cat.dropLowest
          : 0,
      itemsExpanded: true,
    };
  });
}

export function updateSubItemInCategory(
  state,
  termId,
  courseId,
  catId,
  subItemId,
  patch,
) {
  if (!patch || typeof patch !== 'object') return state;
  const keys = Object.keys(patch);
  if (keys.length === 0) return state;

  return updateTargetCategory(state, termId, courseId, catId, (cat) => {
    if (!Array.isArray(cat.items) || cat.items.length === 0) return cat;
    let itemChanged = false;
    const nextItems = cat.items.map((sub) => {
      if (sub.id !== subItemId) return sub;
      if (keys.every((k) => Object.is(sub[k], patch[k]))) return sub;
      itemChanged = true;
      return { ...sub, ...patch };
    });
    return itemChanged ? { ...cat, items: nextItems } : cat;
  });
}

export function deleteSubItemFromCategory(
  state,
  termId,
  courseId,
  catId,
  subItemId,
) {
  return updateTargetCategory(state, termId, courseId, catId, (cat) => {
    if (!Array.isArray(cat.items) || cat.items.length === 0) return cat;
    const nextItems = cat.items.filter((sub) => sub.id !== subItemId);
    if (nextItems.length === cat.items.length) return cat;
    if (nextItems.length === 0) {
      return {
        id: cat.id,
        name: cat.name,
        weight: cat.weight,
        grade: null,
      };
    }
    const clampedDrop = Math.min(cat.dropLowest || 0, Math.max(0, nextItems.length - 1));
    return {
      ...cat,
      items: nextItems,
      dropLowest: clampedDrop,
    };
  });
}

export function reorderSubItemsInCategory(
  state,
  termId,
  courseId,
  catId,
  fromIndex,
  toIndex,
) {
  return updateTargetCategory(state, termId, courseId, catId, (cat) => {
    if (!Array.isArray(cat.items)) return cat;
    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= cat.items.length ||
      toIndex >= cat.items.length ||
      fromIndex === toIndex
    ) {
      return cat;
    }
    return {
      ...cat,
      items: reorderArray(cat.items, fromIndex, toIndex),
    };
  });
}

export function setCategoryDropLowest(
  state,
  termId,
  courseId,
  catId,
  dropLowest,
) {
  const safeDrop =
    typeof dropLowest === 'number' &&
    Number.isInteger(dropLowest) &&
    dropLowest >= 0 &&
    dropLowest <= 100
      ? dropLowest
      : 0;
  return updateTargetCategory(state, termId, courseId, catId, (cat) => {
    if (!Array.isArray(cat.items) || cat.items.length === 0) return cat;
    if ((cat.dropLowest || 0) === safeDrop) return cat;
    return {
      ...cat,
      dropLowest: safeDrop,
    };
  });
}

export function setCategoryItemsExpanded(
  state,
  termId,
  courseId,
  catId,
  expanded,
) {
  const nextExpanded = Boolean(expanded);
  return updateTargetCategory(state, termId, courseId, catId, (cat) => {
    if (!Array.isArray(cat.items) || cat.items.length === 0) return cat;
    if (Boolean(cat.itemsExpanded) === nextExpanded) return cat;
    return {
      ...cat,
      itemsExpanded: nextExpanded,
    };
  });
}
