import { DEFAULT_GRADE_SCALE } from './constants.js';

let idCounter = 0;

function generateId(prefix = 'id') {
  idCounter += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}-${idCounter}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

function cloneGradeScale() {
  if (typeof structuredClone === 'function') {
    return structuredClone(DEFAULT_GRADE_SCALE);
  }
  return DEFAULT_GRADE_SCALE.map((band) => ({ ...band }));
}

export function createNewCategory() {
  return {
    id: generateId('cat'),
    name: 'New Assessment',
    weight: 0,
    grade: null,
  };
}

export function createNewCourse(index = 1, mode = 'standard') {
  const courseNum = typeof index === 'number' && Number.isFinite(index) && index >= 1
    ? Math.floor(index)
    : 1;
  const categories = mode === 'blank'
    ? []
    : [
        { id: generateId('cat'), name: 'Assignments', weight: 25, grade: null },
        { id: generateId('cat'), name: 'Midterm',     weight: 35, grade: null },
        { id: generateId('cat'), name: 'Final Exam',  weight: 40, grade: null },
      ];

  return {
    id: generateId('course'),
    code: `COURSE${100 + courseNum}`,
    title: 'Course Title',
    units: 0.5,
    duration: 'term',
    passFail: false,
    collapsed: false,
    targetPct: 85,
    categories,
  };
}

export function duplicateCourseStructure(sourceCourse) {
  const sourceCategories = Array.isArray(sourceCourse?.categories) ? sourceCourse.categories : [];
  const baseCode = typeof sourceCourse?.code === 'string' && sourceCourse.code.trim()
    ? sourceCourse.code.trim()
    : 'COURSE';

  return {
    id: generateId('course'),
    code: `${baseCode}-COPY`,
    title: typeof sourceCourse?.title === 'string' ? sourceCourse.title : 'Course Title',
    units: typeof sourceCourse?.units === 'number' && Number.isFinite(sourceCourse.units) && sourceCourse.units > 0
      ? sourceCourse.units
      : 0.5,
    duration: sourceCourse?.duration === 'full-year' ? 'full-year' : 'term',
    passFail: Boolean(sourceCourse?.passFail ?? sourceCourse?.creditNoCredit),
    collapsed: false,
    targetPct: typeof sourceCourse?.targetPct === 'number' && Number.isFinite(sourceCourse.targetPct)
      ? sourceCourse.targetPct
      : 85,
    categories: sourceCategories.map((cat) => ({
      id: generateId('cat'),
      name: typeof cat?.name === 'string' ? cat.name : 'Assessment',
      weight: typeof cat?.weight === 'number' && Number.isFinite(cat.weight) && cat.weight >= 0
        ? cat.weight
        : 0,
      grade: null,
    })),
  };
}

export function createNewTerm(existingTermsCount = 1) {
  const safeCount = typeof existingTermsCount === 'number' && Number.isFinite(existingTermsCount) && existingTermsCount >= 0
    ? Math.floor(existingTermsCount)
    : 1;
  return {
    id: generateId('term'),
    name: `Term ${safeCount + 1}`,
    courses: [createNewCourse(1, 'standard')],
  };
}

/**
 * Generic initial tracker state with 1 term ("Fall Term") and 3 sample courses
 * (ECON101, MATH101, CS101) containing graded and ungraded assessments summing to 100%.
 */
export function createInitialState() {
  const termId = 'term-fall-1';
  return {
    version: 1,
    studentName: 'My',
    lastUpdated: new Date().toISOString(),
    activeTermId: termId,
    gradeScale: cloneGradeScale(),
    terms: [
      {
        id: termId,
        name: 'Fall Term',
        courses: [
          {
            id: 'c-econ101',
            code: 'ECON101',
            title: 'Principles of Microeconomics',
            units: 0.5,
            duration: 'term',
            passFail: false,
            collapsed: false,
            targetPct: 85,
            categories: [
              { id: 'econ-1', name: 'Quizzes',     weight: 10, grade: 90 },
              { id: 'econ-2', name: 'Midterm 1',   weight: 25, grade: 78 },
              { id: 'econ-3', name: 'Assignments', weight: 25, grade: 88 },
              { id: 'econ-4', name: 'Final Exam',  weight: 40, grade: null },
            ],
          },
          {
            id: 'c-math101',
            code: 'MATH101',
            title: 'Calculus & Linear Algebra',
            units: 1.0,
            duration: 'full-year',
            passFail: false,
            collapsed: false,
            targetPct: 85,
            categories: [
              { id: 'math-1', name: 'Homework',    weight: 15, grade: 94 },
              { id: 'math-2', name: 'Midterm 1',   weight: 20, grade: 86 },
              { id: 'math-3', name: 'Midterm 2',   weight: 25, grade: null },
              { id: 'math-4', name: 'Final Exam',  weight: 40, grade: null },
            ],
          },
          {
            id: 'c-cs101',
            code: 'CS101',
            title: 'Introduction to Programming',
            units: 0.5,
            duration: 'term',
            passFail: false,
            collapsed: false,
            targetPct: 85,
            categories: [
              { id: 'cs-1', name: 'Labs',        weight: 20, grade: 96 },
              { id: 'cs-2', name: 'Assignments', weight: 30, grade: 91 },
              { id: 'cs-3', name: 'Final Exam',  weight: 50, grade: null },
            ],
          },
        ],
      },
    ],
  };
}

export function createEmptyState() {
  const firstTerm = createNewTerm(0);
  return {
    version: 1,
    studentName: 'My',
    lastUpdated: new Date().toISOString(),
    activeTermId: firstTerm.id,
    gradeScale: cloneGradeScale(),
    terms: [firstTerm],
  };
}
