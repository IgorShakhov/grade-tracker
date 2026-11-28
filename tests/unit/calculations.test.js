import { describe, it, expect, vi } from 'vitest';
import {
  STORAGE_KEY,
  DEFAULT_GRADE_SCALE,
  TARGET_PRESETS,
  UNIT_OPTIONS,
  DURATION_OPTIONS,
} from '../../src/domain/constants.js';
import {
  createInitialState,
  createEmptyState,
  createNewTerm,
  createNewCourse,
  duplicateCourseStructure,
  createNewCategory,
} from '../../src/domain/templates.js';
import {
  roundHalfUp,
  formatPercent,
  formatGpa,
  formatLastUpdated,
  lookupGrade,
  calculateTargetRequirement,
  calculateCourseStats,
  calculateAggregateStats,
  calculateGpaVisuals,
  calculateAllStats,
} from '../../src/domain/calculations.js';

function createBenchmarkState() {
  return {
    version: 1,
    studentName: 'Alex',
    lastUpdated: '2026-11-13T09:09:00.000Z',
    activeTermId: 'term-2026-y1',
    gradeScale: structuredClone(DEFAULT_GRADE_SCALE),
    terms: [
      {
        id: 'term-2026-y1',
        name: 'Year 1 · 2026–27',
        courses: [
          {
            id: 'c-eco101',
            code: 'ECO101',
            title: 'Principles of Microeconomics',
            units: 0.5,
            duration: 'term',
            passFail: false,
            collapsed: false,
            targetPct: 80,
            categories: [
              { id: 'eco-1', name: 'Entry Quiz',             weight: 1.00,  grade: 100.00 },
              { id: 'eco-2', name: 'Midterm 1',              weight: 25.00, grade: 63.50 },
              { id: 'eco-3', name: 'Midterm 2',              weight: 25.00, grade: null },
              { id: 'eco-4', name: 'Final Exam',             weight: 40.00, grade: null },
              { id: 'eco-5', name: 'Workshop Participation', weight: 4.50,  grade: 85.00 },
              { id: 'eco-6', name: 'Participation Quizzes',  weight: 4.50,  grade: 94.29 },
            ],
          },
          {
            id: 'c-fah101',
            code: 'FAH101',
            title: 'Monuments of Art History',
            units: 0.5,
            duration: 'term',
            passFail: false,
            collapsed: false,
            targetPct: 85,
            categories: [
              { id: 'fah-1', name: 'Online Quizzes',         weight: 15.00, grade: 83.33 },
              { id: 'fah-2', name: 'Tutorial Participation', weight: 16.00, grade: 100.00 },
              { id: 'fah-3', name: 'Assignment 1',           weight: 10.00, grade: 85.00 },
              { id: 'fah-4', name: 'Assignment 2',           weight: 25.00, grade: null },
              { id: 'fah-5', name: 'Final Exam',             weight: 34.00, grade: null },
            ],
          },
          {
            id: 'c-mat133',
            code: 'MAT133',
            title: 'Calculus & Linear Algebra',
            units: 1.0,
            duration: 'full-year',
            passFail: false,
            collapsed: false,
            targetPct: 85,
            categories: [
              { id: 'mat-1', name: 'Homework',               weight: 6.00,  grade: 95.83 },
              { id: 'mat-2', name: 'Reflections',            weight: 4.00,  grade: 85.71 },
              { id: 'mat-3', name: 'Tutorial Activities',    weight: 7.00,  grade: 83.33 },
              { id: 'mat-4', name: 'Projects/Presentations', weight: 18.00, grade: 94.09 },
              { id: 'mat-5', name: 'Quiz',                   weight: 3.00,  grade: 55.26 },
              { id: 'mat-6', name: 'Midterm 1',              weight: 7.00,  grade: null },
              { id: 'mat-7', name: 'Midterm 2',              weight: 10.00, grade: null },
              { id: 'mat-8', name: 'Midterm 3',              weight: 10.00, grade: null },
              { id: 'mat-9', name: 'Final Exam',             weight: 35.00, grade: null },
            ],
          },
          {
            id: 'c-mgt100',
            code: 'MGT100',
            title: 'Introduction to Management',
            units: 0.5,
            duration: 'term',
            passFail: false,
            collapsed: false,
            targetPct: 85,
            categories: [
              { id: 'mgt100-1', name: 'Quiz',                weight: 5.00,  grade: 91.00 },
              { id: 'mgt100-2', name: 'Midterm',             weight: 20.00, grade: 72.86 },
              { id: 'mgt100-3', name: 'Final Exam',          weight: 40.00, grade: null },
              { id: 'mgt100-4', name: 'Case Modules',        weight: 15.00, grade: 100.00 },
              { id: 'mgt100-5', name: 'Business Plan Comp.', weight: 20.00, grade: null },
            ],
          },
          {
            id: 'c-acc219',
            code: 'ACC219',
            title: 'Introduction to Financial Accounting',
            units: 0.5,
            duration: 'term',
            passFail: false,
            collapsed: false,
            targetPct: 85,
            categories: [
              { id: 'acc219-1', name: 'Planning for Success 1', weight: 3.00,  grade: 100.00 },
              { id: 'acc219-2', name: 'Assignments',            weight: 10.00, grade: 100.00 },
              { id: 'acc219-3', name: 'Midterm',                weight: 25.00, grade: null },
              { id: 'acc219-4', name: 'Planning for Success 2', weight: 2.00,  grade: null },
              { id: 'acc219-5', name: 'Team Contract',          weight: 3.00,  grade: 100.00 },
              { id: 'acc219-6', name: 'Team Mentor Check-In',   weight: 2.00,  grade: null },
              { id: 'acc219-7', name: 'Final Group Submission', weight: 15.00, grade: null },
              { id: 'acc219-8', name: 'Final Exam',             weight: 40.00, grade: null },
            ],
          },
        ],
      },
    ],
  };
}

describe('Domain Constants (constants.js)', () => {
  it('exports exact STORAGE_KEY, UNIT_OPTIONS, and DURATION_OPTIONS', () => {
    expect(STORAGE_KEY).toBe('grade_tracker_v1');
    expect(UNIT_OPTIONS).toEqual([0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0]);
    expect(DURATION_OPTIONS).toEqual([
      { value: 'term', label: 'Single Term' },
      { value: 'full-year', label: 'Full Year' },
    ]);
  });

  it('defines all 13 contiguous default 4.0 grading scale bands covering 0..100 with zero gaps', () => {
    expect(DEFAULT_GRADE_SCALE).toHaveLength(13);
    expect(DEFAULT_GRADE_SCALE[0]).toMatchObject({
      min: 90,
      max: 100,
      rangeLabel: '90–100%',
      boundLabel: '100%',
      letter: 'A+',
      gpa: 4.0,
      tier: 'tier-a',
    });
    expect(DEFAULT_GRADE_SCALE[12]).toMatchObject({
      min: 0,
      max: 49,
      rangeLabel: '0–49%',
      boundLabel: '49%',
      letter: 'F',
      gpa: 0.0,
      tier: 'tier-f',
    });

    for (let i = 0; i < DEFAULT_GRADE_SCALE.length - 1; i += 1) {
      const upper = DEFAULT_GRADE_SCALE[i];
      const lower = DEFAULT_GRADE_SCALE[i + 1];
      expect(upper.min).toBe(lower.max + 1);
    }
  });

  it('defines all 9 generic target calculator presets', () => {
    expect(TARGET_PRESETS).toEqual([
      { label: 'A+ (90%)', pct: 90 },
      { label: 'A (85%)', pct: 85 },
      { label: 'A- (80%)', pct: 80 },
      { label: 'B+ (77%)', pct: 77 },
      { label: 'B (73%)', pct: 73 },
      { label: 'B- (70%)', pct: 70 },
      { label: 'C+ (67%)', pct: 67 },
      { label: 'C (63%)', pct: 63 },
      { label: 'Pass (50%)', pct: 50 },
    ]);
  });
});

describe('Rounding & Formatting Helpers (calculations.js)', () => {
  it('rounds half-up accurately across IEEE-754 float midpoints without producing -0', () => {
    expect(roundHalfUp(85.30499999999999, 2)).toBe(85.31);
    expect(roundHalfUp(85.305, 2)).toBe(85.31);
    expect(roundHalfUp(88.435, 2)).toBe(88.44);
    expect(roundHalfUp(85.3049, 2)).toBe(85.3);
    expect(Object.is(roundHalfUp(-0.001, 2), 0)).toBe(true);
    expect(roundHalfUp(-10.005, 2)).toBe(-10.01);
    expect(Number.isNaN(roundHalfUp(NaN, 2))).toBe(true);
  });

  it('formats percentages and GPAs with graceful em-dash fallback on invalid inputs', () => {
    expect(formatPercent(85.30499999999999, 2)).toBe('85.31%');
    expect(formatPercent(100, 2)).toBe('100.00%');
    expect(formatPercent(34.6666666667, 1)).toBe('34.7%');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(NaN)).toBe('—');
    expect(formatPercent(Infinity)).toBe('—');

    expect(formatGpa(11.35 / 3.0, 1)).toBe('3.8');
    expect(formatGpa(11.35 / 3.0, 2)).toBe('3.78');
    expect(formatGpa(4, 1)).toBe('4.0');
    expect(formatGpa(0, 1)).toBe('0.0');
    expect(formatGpa(null)).toBe('—');
    expect(formatGpa(undefined)).toBe('—');
    expect(formatGpa(NaN)).toBe('—');
  });

  it('formats ISO timestamps in the active local/IANA timezone (#45) without UTC day-shift on YYYY-MM-DD', () => {
    expect(formatLastUpdated('2026-11-13T09:09:00.000Z')).toBe('Nov 13, 2026');
    expect(formatLastUpdated('2026-11-13T00:05:00.000Z')).toBe('Nov 13, 2026');
    expect(formatLastUpdated('2026-11-13T23:59:59.999Z')).toBe('Nov 13, 2026');
    // Evening edit in Americas: 2026-11-27T03:00:00Z is Nov 26 in America/Los_Angeles (#45)
    expect(formatLastUpdated('2026-11-27T03:00:00Z', 'America/Los_Angeles')).toBe(
      'Nov 26, 2026',
    );
    expect(formatLastUpdated('2026-11-27T03:00:00Z', 'Asia/Tokyo')).toBe(
      'Nov 27, 2026',
    );
    // Verify 1-arg call omits `timeZone` (so browsers use the user's real local timezone!)
    const OrigDTF = Intl.DateTimeFormat;
    const dtfSpy = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(function MockDTF(locale, opts) {
        expect(opts?.timeZone).toBeUndefined();
        return new OrigDTF(locale, { ...opts, timeZone: 'America/Los_Angeles' });
      });
    try {
      expect(formatLastUpdated('2026-11-27T03:00:00Z')).toBe('Nov 26, 2026');
    } finally {
      dtfSpy.mockRestore();
    }
    // Plain date-only strings keep their exact calendar day even in negative UTC offsets
    expect(formatLastUpdated('2026-11-27', 'America/Los_Angeles')).toBe(
      'Nov 27, 2026',
    );
    expect(formatLastUpdated('2026-02-31')).toBe('—');
    expect(formatLastUpdated('')).toBe('—');
    expect(formatLastUpdated('   ')).toBe('—');
    expect(formatLastUpdated('not-a-date')).toBe('—');
    expect(formatLastUpdated(null)).toBe('—');
    expect(formatLastUpdated(undefined)).toBe('—');
  });
});

describe('Grade Scale Lookup (lookupGrade)', () => {
  it.each([
    [100, 'A+', 4.0, 'tier-a', 100],
    [90, 'A+', 4.0, 'tier-a', 90],
    [89.5, 'A+', 4.0, 'tier-a', 90],
    [89.49, 'A', 4.0, 'tier-a', 89],
    [85, 'A', 4.0, 'tier-a', 85],
    [84.49, 'A-', 3.7, 'tier-a', 84],
    [80, 'A-', 3.7, 'tier-a', 80],
    [79, 'B+', 3.3, 'tier-b', 79],
    [77, 'B+', 3.3, 'tier-b', 77],
    [76, 'B', 3.0, 'tier-b', 76],
    [73, 'B', 3.0, 'tier-b', 73],
    [72, 'B-', 2.7, 'tier-b', 72],
    [70, 'B-', 2.7, 'tier-b', 70],
    [69, 'C+', 2.3, 'tier-c', 69],
    [67, 'C+', 2.3, 'tier-c', 67],
    [66, 'C', 2.0, 'tier-c', 66],
    [63, 'C', 2.0, 'tier-c', 63],
    [62, 'C-', 1.7, 'tier-c', 62],
    [60, 'C-', 1.7, 'tier-c', 60],
    [59, 'D+', 1.3, 'tier-d', 59],
    [57, 'D+', 1.3, 'tier-d', 57],
    [56, 'D', 1.0, 'tier-d', 56],
    [53, 'D', 1.0, 'tier-d', 53],
    [52, 'D-', 0.7, 'tier-d', 52],
    [50, 'D-', 0.7, 'tier-d', 50],
    [49.5, 'D-', 0.7, 'tier-d', 50],
    [49.49, 'F', 0.0, 'tier-f', 49],
    [0, 'F', 0.0, 'tier-f', 0],
  ])('maps %d%% -> %s (%d)', (pct, letter, gpa, tier, roundedPct) => {
    expect(lookupGrade(pct)).toEqual({ letter, gpa, tier, roundedPct });
  });

  it('handles IEEE-754 boundary drift, clamping, and null/NaN inputs', () => {
    const ieee895 = (((20 * 89.5) / 100) / 20) * 100;
    expect(lookupGrade(ieee895)).toEqual({
      letter: 'A+',
      gpa: 4.0,
      tier: 'tier-a',
      roundedPct: 90,
    });

    expect(lookupGrade(105)).toEqual({ letter: 'A+', gpa: 4.0, tier: 'tier-a', roundedPct: 100 });
    expect(lookupGrade(-5)).toEqual({ letter: 'F', gpa: 0.0, tier: 'tier-f', roundedPct: 0 });
    expect(lookupGrade(null)).toEqual({ letter: '—', gpa: null, tier: 'tier-none', roundedPct: null });
    expect(lookupGrade(undefined)).toEqual({ letter: '—', gpa: null, tier: 'tier-none', roundedPct: null });
    expect(lookupGrade(NaN)).toEqual({ letter: '—', gpa: null, tier: 'tier-none', roundedPct: null });
  });

  it('supports custom user-configured grade scales (unsorted and without explicit tier)', () => {
    const customScale = [
      { min: 0, max: 59, letter: 'F', gpa: 0.0 },
      { min: 93, max: 100, letter: 'A', gpa: 4.0 },
      { min: 80, max: 92, letter: 'B', gpa: 3.0 },
      { min: 70, max: 79, letter: 'C', gpa: 2.0 },
      { min: 60, max: 69, letter: 'D', gpa: 1.0 },
    ];

    expect(lookupGrade(95, customScale)).toEqual({ letter: 'A', gpa: 4.0, tier: 'tier-a', roundedPct: 95 });
    expect(lookupGrade(90, customScale)).toEqual({ letter: 'B', gpa: 3.0, tier: 'tier-b', roundedPct: 90 });
    expect(lookupGrade(75, customScale)).toEqual({ letter: 'C', gpa: 2.0, tier: 'tier-c', roundedPct: 75 });
    expect(lookupGrade(62, customScale)).toEqual({ letter: 'D', gpa: 1.0, tier: 'tier-d', roundedPct: 62 });
    expect(lookupGrade(55, customScale)).toEqual({ letter: 'F', gpa: 0.0, tier: 'tier-f', roundedPct: 55 });

    const stateWithCustomScale = {
      version: 1,
      studentName: 'My',
      activeTermId: 't1',
      gradeScale: customScale,
      terms: [
        {
          id: 't1',
          name: 'Fall Term',
          courses: [
            {
              id: 'c1',
              code: 'CS201',
              units: 0.5,
              passFail: false,
              categories: [{ id: 'k1', name: 'Exam', weight: 100, grade: 91 }],
            },
          ],
        },
      ],
    };
    const courseStats = calculateCourseStats(stateWithCustomScale.terms[0].courses[0], null, customScale);
    expect(courseStats.letter).toBe('B');
    expect(courseStats.gpa).toBe(3.0);
    expect(courseStats.tier).toBe('tier-b');

    const { overall } = calculateAllStats(stateWithCustomScale);
    expect(overall.cumulativeGpa).toBe(3.0);
  });

  it('returns 0.0 GPA ("F") below lowest band (#38), supports decimal custom thresholds, derives dynamic Pass/Fail threshold (#39), and builds valid >0% Target options (#40)', async () => {
    const { getPassingThreshold, buildTargetOptions } = await import(
      '../../src/domain/calculations.js'
    );

    const scaleWithoutZero = [
      { min: 80, max: 100, letter: 'A', gpa: 4.0 },
      { min: 50, max: 79, letter: 'C', gpa: 2.0 },
    ];
    const belowFloor = lookupGrade(30, scaleWithoutZero);
    expect(belowFloor.gpa).toBe(0);
    expect(belowFloor.letter).toBe('F');
    expect(belowFloor.tier).toBe('tier-f');
    expect(belowFloor.roundedPct).toBe(30);

    // Decimal custom thresholds (`92.8`, `50.2`) compare directly without premature integer rounding
    const decimalScale = [
      { min: 92.8, max: 100, letter: 'A', gpa: 4.0 },
      { min: 50.2, max: 92.7, letter: 'P', gpa: 2.0 },
      { min: 0, max: 50.1, letter: 'F', gpa: 0.0 },
    ];
    expect(lookupGrade(92.6, decimalScale).letter).toBe('P');
    expect(lookupGrade(92.8, decimalScale).letter).toBe('A');
    expect(
      calculateCourseStats(
        {
          id: 'pf-dec',
          code: 'DEC101',
          units: 0.5,
          passFail: true,
          categories: [{ id: 'k1', name: 'Exam', weight: 100, grade: 50.15 }],
        },
        null,
        decimalScale,
      ).letter,
    ).toBe('NP');
    expect(
      calculateCourseStats(
        {
          id: 'pf-dec2',
          code: 'DEC102',
          units: 0.5,
          passFail: true,
          categories: [{ id: 'k1', name: 'Exam', weight: 100, grade: 50.25 }],
        },
        null,
        decimalScale,
      ).letter,
    ).toBe('P');

    const custom60PassScale = [
      { min: 85, max: 100, letter: 'H', gpa: 4.0 },
      { min: 60, max: 84, letter: 'P', gpa: 2.0 },
      { min: 0, max: 59, letter: 'F', gpa: 0.0 },
    ];
    expect(getPassingThreshold(custom60PassScale)).toBe(60);

    const pf55 = calculateCourseStats(
      {
        id: 'pf-1',
        code: 'MED101',
        units: 0.5,
        passFail: true,
        categories: [{ id: 'k1', name: 'Exam', weight: 100, grade: 55 }],
      },
      null,
      custom60PassScale,
    );
    expect(pf55.letter).toBe('NP');
    expect(pf55.gpa).toBeNull();

    const pf60 = calculateCourseStats(
      {
        id: 'pf-2',
        code: 'MED102',
        units: 0.5,
        passFail: true,
        categories: [{ id: 'k1', name: 'Exam', weight: 100, grade: 60 }],
      },
      null,
      custom60PassScale,
    );
    expect(pf60.letter).toBe('P');

    const opts = buildTargetOptions(custom60PassScale, 88);
    expect(opts).toEqual([
      { label: 'H (85%)', pct: 85 },
      { label: 'Pass (60%)', pct: 60 },
      { label: 'Custom (88%)', pct: 88 },
    ]);

    // If a custom scale gives >0 GPA at min: 0, buildTargetOptions never emits invalid pct: 0
    const zeroGpaPosScale = [
      { min: 80, max: 100, letter: 'A', gpa: 4.0 },
      { min: 0, max: 79, letter: 'D', gpa: 1.0 },
    ];
    expect(buildTargetOptions(zeroGpaPosScale).every((o) => o.pct > 0)).toBe(true);
  });
});

describe('Exact Weighted Math Benchmark (5-Course Fixture)', () => {
  it('matches exact course percentages, grade points, letters, targets, and cGPA', () => {
    const state = createBenchmarkState();
    expect(state.studentName).toBe('Alex');
    expect(state.lastUpdated).toBe('2026-11-13T09:09:00.000Z');
    expect(formatLastUpdated(state.lastUpdated)).toBe('Nov 13, 2026');
    expect(state.activeTermId).toBe('term-2026-y1');
    expect(state.terms).toHaveLength(1);

    const courses = state.terms[0].courses;
    expect(courses).toHaveLength(5);

    const expectedByCode = {
      ECO101: {
        units: 0.5,
        pct: '71.27%',
        gpa: '2.7',
        letter: 'B-',
        roundedPct: 71,
        gradedWeight: 35,
        remainingWeight: 65,
        req: '84.70%',
      },
      FAH101: {
        units: 0.5,
        pct: '90.24%',
        gpa: '4.0',
        letter: 'A+',
        roundedPct: 90,
        gradedWeight: 41,
        remainingWeight: 59,
        req: '81.36%',
      },
      MAT133: {
        units: 1.0,
        pct: '88.44%',
        gpa: '4.0',
        letter: 'A',
        roundedPct: 88,
        gradedWeight: 38,
        remainingWeight: 62,
        req: '82.89%',
      },
      MGT100: {
        units: 0.5,
        pct: '85.31%',
        gpa: '4.0',
        letter: 'A',
        roundedPct: 85,
        gradedWeight: 40,
        remainingWeight: 60,
        req: '84.80%',
      },
      ACC219: {
        units: 0.5,
        pct: '100.00%',
        gpa: '4.0',
        letter: 'A+',
        roundedPct: 100,
        gradedWeight: 16,
        remainingWeight: 84,
        req: '82.14%',
      },
    };

    for (const course of courses) {
      const exp = expectedByCode[course.code];
      const stats = calculateCourseStats(course);

      expect(Object.keys(stats).sort()).toEqual([
        'categoryBreakdowns',
        'gpa',
        'gradedWeight',
        'hasSimulated',
        'isWeightValid',
        'letter',
        'maxPossible',
        'minPossible',
        'overallGrade',
        'remainingWeight',
        'requiredOnRemaining',
        'roundedPct',
        'targetPct',
        'targetStatus',
        'tier',
        'totalWeight',
        'weightedPoints',
      ]);

      expect(course.units).toBe(exp.units);
      expect(stats.totalWeight).toBeCloseTo(100, 5);
      expect(stats.isWeightValid).toBe(true);
      expect(stats.gradedWeight).toBeCloseTo(exp.gradedWeight, 5);
      expect(stats.remainingWeight).toBeCloseTo(exp.remainingWeight, 5);
      expect(formatPercent(stats.overallGrade, 2)).toBe(exp.pct);
      expect(formatGpa(stats.gpa, 1)).toBe(exp.gpa);
      expect(stats.letter).toBe(exp.letter);
      expect(stats.roundedPct).toBe(exp.roundedPct);
      expect(stats.targetStatus).toBe('achievable');
      expect(formatPercent(stats.requiredOnRemaining, 2)).toBe(exp.req);
    }

    const { overall, termStats } = calculateAllStats(state);
    expect(overall.totalUnitsEnrolled).toBe(3.0);
    expect(overall.gpaUnits).toBe(3.0);
    expect(formatGpa(overall.cumulativeGpa, 1)).toBe('3.8');
    expect(formatGpa(overall.cumulativeGpa, 2)).toBe('3.78');
    expect(formatPercent(overall.weightedAverage, 2)).toBe('87.28%');
    expect(formatPercent(overall.completionPct, 1)).toBe('34.7%');
    expect(termStats).toEqual(overall);
  });
});

describe('Templates & Factory Isolation (templates.js)', () => {
  it('returns fresh deep clones from createInitialState with generic sample courses', () => {
    const a = createInitialState();
    const b = createInitialState();
    a.studentName = 'Edited';
    a.gradeScale[0].min = 95;
    a.terms[0].courses[0].categories[0].grade = 12;

    expect(b.studentName).toBe('My');
    expect(b.gradeScale).toEqual(DEFAULT_GRADE_SCALE);
    expect(b.terms[0].name).toBe('Fall Term');
    expect(b.terms[0].courses.map((c) => c.code)).toEqual(['ECON101', 'MATH101', 'CS101']);
    expect(b.terms[0].courses[0].categories[0].grade).toBe(90);

    for (const course of b.terms[0].courses) {
      const stats = calculateCourseStats(course);
      expect(stats.isWeightValid).toBe(true);
      expect(course.passFail).toBe(false);
      expect(course.collapsed).toBe(false);
    }
  });

  it('creates empty starter state with Term 1 and COURSE101', () => {
    const empty = createEmptyState();
    expect(empty.studentName).toBe('My');
    expect(empty.gradeScale).toEqual(DEFAULT_GRADE_SCALE);
    expect(empty.terms).toHaveLength(1);
    expect(empty.terms[0].name).toBe('Term 1');
    expect(empty.terms[0].courses).toHaveLength(1);
    expect(empty.terms[0].courses[0].code).toBe('COURSE101');
    expect(empty.activeTermId).toBe(empty.terms[0].id);
  });

  it('supports standard and blank course presets, progressive term names, and duplicateCourseStructure', () => {
    expect(createNewTerm(0).name).toBe('Term 1');
    expect(createNewTerm(1).name).toBe('Term 2');
    expect(createNewTerm(2).name).toBe('Term 3');

    const standard = createNewCourse(1, 'standard');
    const blank = createNewCourse(2, 'blank');
    const extraCat = createNewCategory();

    expect(standard).toMatchObject({
      code: 'COURSE101',
      title: 'Course Title',
      units: 0.5,
      duration: 'term',
      passFail: false,
      collapsed: false,
      targetPct: 85,
    });
    expect(standard.categories).toHaveLength(3);
    expect(calculateCourseStats(standard).isWeightValid).toBe(true);

    expect(blank.code).toBe('COURSE102');
    expect(blank.categories).toEqual([]);
    expect(extraCat).toMatchObject({ name: 'New Assessment', weight: 0, grade: null });

    const source = {
      id: 'c-orig',
      code: 'MATH101',
      title: 'Calculus',
      units: 1.0,
      duration: 'full-year',
      passFail: true,
      collapsed: true,
      targetPct: 90,
      categories: [
        { id: 'cat-1', name: 'Midterm', weight: 40, grade: 88 },
        { id: 'cat-2', name: 'Final', weight: 60, grade: 92 },
      ],
    };
    const dup = duplicateCourseStructure(source);
    expect(dup.id).not.toBe(source.id);
    expect(dup.code).toBe('MATH101-COPY');
    expect(dup.title).toBe('Calculus');
    expect(dup.units).toBe(1.0);
    expect(dup.duration).toBe('full-year');
    expect(dup.passFail).toBe(true);
    expect(dup.collapsed).toBe(false);
    expect(dup.targetPct).toBe(90);
    expect(dup.categories).toHaveLength(2);
    expect(dup.categories[0].id).not.toBe('cat-1');
    expect(dup.categories[1].id).not.toBe('cat-2');
    expect(dup.categories.map((c) => ({ name: c.name, weight: c.weight, grade: c.grade }))).toEqual([
      { name: 'Midterm', weight: 40, grade: null },
      { name: 'Final', weight: 60, grade: null },
    ]);

    const allIds = [
      standard.id,
      blank.id,
      extraCat.id,
      dup.id,
      ...standard.categories.map((k) => k.id),
      ...dup.categories.map((k) => k.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

describe('Target Calculator Edge Cases (calculateTargetRequirement)', () => {
  it('handles achievable targets including exact 100.00% with IEEE-754 float drift', () => {
    const course = {
      id: 'c-exact',
      code: 'MAT133',
      units: 1.0,
      targetPct: 92.4,
      categories: [
        { id: 'k1', name: 'Graded', weight: 38, grade: 80 },
        { id: 'k2', name: 'Final', weight: 62, grade: null },
      ],
    };
    const res = calculateTargetRequirement(course, 92.4);
    expect(res.status).toBe('achievable');
    expect(formatPercent(res.requiredOnRemaining, 2)).toBe('100.00%');
  });

  it('marks targets > 100% on remaining weight as unreachable and reports maxPossible', () => {
    const eco101 = createBenchmarkState().terms[0].courses[0];
    const res = calculateTargetRequirement(eco101, 90);
    expect(res.status).toBe('unreachable');
    expect(formatPercent(res.requiredOnRemaining, 2)).toBe('100.09%');
    expect(formatPercent(res.maxPossible, 2)).toBe('89.94%');
  });

  it('marks already clinched targets (<= 0% needed) as secured', () => {
    const course = {
      id: 'c-sec',
      code: 'MGT100',
      units: 0.5,
      categories: [
        { id: 'k1', name: 'Coursework', weight: 60, grade: 90 },
        { id: 'k2', name: 'Final', weight: 40, grade: null },
      ],
    };
    const passRes = calculateTargetRequirement(course, 50);
    expect(passRes.status).toBe('secured');
    expect(passRes.requiredOnRemaining).toBeLessThan(0);

    const exactZeroRes = calculateTargetRequirement(course, 54);
    expect(exactZeroRes.status).toBe('secured');
    expect(exactZeroRes.requiredOnRemaining).toBe(0);
  });

  it('marks fully graded courses (including fractional 33.33 + 33.33 + 33.34 weights) as complete', () => {
    const course = {
      id: 'c-done',
      code: 'CSC108',
      units: 0.5,
      categories: [
        { id: 'k1', name: 'A1', weight: 33.33, grade: 80 },
        { id: 'k2', name: 'A2', weight: 33.33, grade: 85 },
        { id: 'k3', name: 'A3', weight: 33.34, grade: 90 },
      ],
    };
    const stats = calculateCourseStats(course);
    expect(stats.remainingWeight).toBe(0);
    expect(stats.requiredOnRemaining).toBeNull();
    expect(stats.targetStatus).toBe('complete');
    expect(stats.maxPossible).toBeCloseTo(stats.overallGrade, 8);
    expect(stats.minPossible).toBeCloseTo(stats.overallGrade, 8);
  });
});

describe('Pass/Fail, What-If Simulator Overlay & Multi-Term GPA', () => {
  it('handles passFail and legacy creditNoCredit flags and excludes them from GPA units', () => {
    const ungradedPf = {
      id: 'c1',
      code: 'SOC100',
      units: 0.5,
      passFail: true,
      categories: [{ id: 'k1', name: 'Final', weight: 100, grade: null }],
    };
    expect(calculateCourseStats(ungradedPf)).toMatchObject({
      letter: 'P/F',
      gpa: null,
      tier: 'tier-cr',
    });

    const borderlinePf = {
      id: 'c2',
      code: 'SOC100',
      units: 0.5,
      passFail: true,
      categories: [{ id: 'k1', name: 'Quiz', weight: 20, grade: 49.5 }],
    };
    expect(calculateCourseStats(borderlinePf)).toMatchObject({
      letter: 'P',
      gpa: null,
      tier: 'tier-cr',
      roundedPct: 50,
    });

    const failingPf = {
      id: 'c3',
      code: 'SOC100',
      units: 0.5,
      creditNoCredit: true,
      categories: [{ id: 'k1', name: 'Quiz', weight: 20, grade: 49.49 }],
    };
    expect(calculateCourseStats(failingPf)).toMatchObject({
      letter: 'NP',
      gpa: null,
      tier: 'tier-cr',
      roundedPct: 49,
    });

    const state = createBenchmarkState();
    state.terms[0].courses[0].passFail = true;
    const { overall } = calculateAllStats(state);
    expect(overall.totalUnitsEnrolled).toBe(3.0);
    expect(overall.gpaUnits).toBe(2.5);
    expect(overall.cumulativeGpa).toBe(4.0);

    const allPfAgg = calculateAggregateStats([borderlinePf]);
    expect(allPfAgg.cumulativeGpa).toBeNull();
    expect(allPfAgg.totalUnitsEnrolled).toBe(0.5);
    expect(allPfAgg.gpaUnits).toBe(0);
  });

  it('applies What-If simGrades to both graded and ungraded categories without mutating source state', () => {
    const state = createBenchmarkState();
    const eco101 = state.terms[0].courses[0];

    const simGrades = {
      'eco-2': 99,
      'eco-3': 85,
      'eco-4': 90,
    };

    const simStats = calculateCourseStats(eco101, simGrades);
    expect(simStats.hasSimulated).toBe(true);
    expect(simStats.categoryBreakdowns.find((c) => c.id === 'eco-2')).toMatchObject({
      effectiveGrade: 99,
      isSimulated: true,
    });
    expect(simStats.categoryBreakdowns.find((c) => c.id === 'eco-3')).toMatchObject({
      effectiveGrade: 85,
      isSimulated: true,
    });
    // Original course object remains completely untouched
    expect(eco101.categories.find((c) => c.id === 'eco-2').grade).toBe(63.5);
    expect(eco101.categories.find((c) => c.id === 'eco-3').grade).toBeNull();
    expect(formatPercent(simStats.overallGrade, 2)).toBe('91.07%');
    expect(simStats.letter).toBe('A+');
    expect(simStats.gpa).toBe(4.0);
  });

  it('computes independent active Term GPA and cross-term Cumulative GPA across multiple terms', () => {
    const state = createBenchmarkState();
    const year2 = {
      id: 'term-y2',
      name: 'Year 2 · 2027–28',
      courses: [
        {
          id: 'c-eco200',
          code: 'ECO200',
          title: 'Microeconomic Theory',
          units: 1.0,
          passFail: false,
          targetPct: 85,
          categories: [{ id: 'k-final', name: 'Final', weight: 100, grade: 75 }],
        },
      ],
    };
    state.terms.push(year2);
    state.activeTermId = 'term-y2';

    const { overall, termStats } = calculateAllStats(state);
    expect(termStats.cumulativeGpa).toBe(3.0);
    expect(overall.totalUnitsEnrolled).toBe(4.0);
    expect(formatGpa(overall.cumulativeGpa, 1)).toBe('3.6');
    expect(formatGpa(overall.cumulativeGpa, 2)).toBe('3.59');

    const year3 = createNewTerm(2);
    state.terms.push(year3);
    state.activeTermId = year3.id;
    const afterY3 = calculateAllStats(state);
    expect(afterY3.termStats.cumulativeGpa).toBeNull();
    expect(formatGpa(afterY3.overall.cumulativeGpa, 2)).toBe('3.59');
  });

  it('flags invalid weight totals (!= 100%) and safely ignores 0%-weight graded rows', () => {
    const unbalanced = {
      id: 'c-unbal',
      code: 'CSC148',
      units: 0.5,
      categories: [
        { id: 'z0', name: 'Zero Weight Bonus', weight: 0, grade: 100 },
        { id: 'z1', name: 'Midterm', weight: 40, grade: 80 },
        { id: 'z2', name: 'Final', weight: 45, grade: null },
      ],
    };
    const stats = calculateCourseStats(unbalanced);
    expect(stats.totalWeight).toBe(85);
    expect(stats.isWeightValid).toBe(false);
    expect(stats.gradedWeight).toBe(40);
    expect(stats.overallGrade).toBe(80);
  });

  it('prevents IEEE-754 overflow, RangeError, NaN, and false NP on huge finite numbers and malformed decimals', () => {
    expect(roundHalfUp(1e308, 2)).toBe(1e308);
    expect(roundHalfUp(-1e308, 2)).toBe(-1e308);
    expect(roundHalfUp(Number.MAX_VALUE, 2)).toBe(Number.MAX_VALUE);

    for (const formatted of [
      formatPercent(1e308, 2),
      formatPercent(-1e308, 2),
      formatGpa(1e308, 1),
    ]) {
      expect(formatted).not.toContain('Infinity');
      expect(formatted).not.toContain('NaN');
    }

    expect(formatPercent(85.305, NaN)).toBe('85.31%');
    expect(formatPercent(85.305, -1)).toBe('85.31%');
    expect(formatPercent(85.305, 101)).toBe('85.31%');
    expect(formatPercent(85.305, Infinity)).toBe('85.31%');
    expect(formatGpa(11.35 / 3.0, NaN)).toBe('3.8');
    expect(formatGpa(11.35 / 3.0, -1)).toBe('3.8');
    expect(formatGpa(11.35 / 3.0, 101)).toBe('3.8');

    const hugeGradeStats = calculateCourseStats({
      id: 'c-huge-grade',
      code: 'ECO101',
      units: 0.5,
      passFail: false,
      targetPct: 85,
      categories: [{ id: 'k1', name: 'Midterm', weight: 100, grade: 1e307 }],
    });
    expect(hugeGradeStats.overallGrade).toBe(1e307);
    expect(hugeGradeStats.letter).toBe('A+');
    expect(hugeGradeStats.gpa).toBe(4.0);
    expect(hugeGradeStats.roundedPct).toBe(100);
    expect(Number.isFinite(hugeGradeStats.maxPossible)).toBe(true);
    expect(Number.isFinite(hugeGradeStats.minPossible)).toBe(true);

    const hugeWeightPfStats = calculateCourseStats({
      id: 'c-huge-weights',
      code: 'ECO102',
      units: 0.5,
      passFail: true,
      targetPct: 85,
      categories: [
        { id: 'k1', name: 'Midterm', weight: 1e308, grade: 80 },
        { id: 'k2', name: 'Final', weight: 1e308, grade: 90 },
      ],
    });
    expect(hugeWeightPfStats.overallGrade).toBe(85);
    expect(hugeWeightPfStats.letter).toBe('P');
    expect(hugeWeightPfStats.gpa).toBeNull();
    expect(hugeWeightPfStats.maxPossible).toBe(85);
    expect(hugeWeightPfStats.minPossible).toBe(85);

    const hugePartialStats = calculateCourseStats({
      id: 'c-huge-partial',
      code: 'ECO103',
      units: 0.5,
      passFail: false,
      targetPct: 85,
      categories: [
        { id: 'k1', name: 'Midterm', weight: 1e308, grade: 80 },
        { id: 'k2', name: 'Final', weight: 1e308, grade: null },
      ],
    });
    expect(hugePartialStats.overallGrade).toBe(80);
    expect(hugePartialStats.requiredOnRemaining).toBe(90);
    expect(hugePartialStats.targetStatus).toBe('achievable');

    const mixedTracker = calculateAllStats({
      version: 1,
      studentName: 'Alex',
      lastUpdated: '2026-11-13T09:09:00.000Z',
      activeTermId: 't1',
      terms: [
        {
          id: 't1',
          name: 'Year 1',
          courses: [
            {
              id: 'c-norm',
              code: 'MAT133',
              units: 1.0,
              passFail: false,
              targetPct: 85,
              categories: [{ id: 'm1', name: 'Final', weight: 100, grade: 90 }],
            },
            {
              id: 'c2',
              code: 'ECO102',
              units: 0.5,
              passFail: true,
              targetPct: 85,
              categories: [
                { id: 'k1', name: 'M', weight: 1e308, grade: 80 },
                { id: 'k2', name: 'F', weight: 1e308, grade: 90 },
              ],
            },
          ],
        },
      ],
    });
    expect(mixedTracker.overall.cumulativeGpa).toBe(4.0);
    expect(mixedTracker.overall.weightedAverage).toBeCloseTo((90 * 1.0 + 85 * 0.5) / 1.5, 8);
    expect(mixedTracker.overall.completionPct).toBeCloseTo(100, 8);

    const hugeUnitsTracker = calculateAllStats({
      version: 1,
      studentName: 'Alex',
      lastUpdated: '2026-11-13T09:09:00.000Z',
      activeTermId: 't1',
      terms: [
        {
          id: 't1',
          name: 'Year 1',
          courses: [
            {
              id: 'cu1',
              code: 'ECO101',
              units: 1e308,
              passFail: false,
              targetPct: 85,
              categories: [{ id: 'k1', name: 'Exam', weight: 100, grade: 80 }],
            },
            {
              id: 'cu2',
              code: 'MGT100',
              units: 1e308,
              passFail: false,
              targetPct: 85,
              categories: [{ id: 'k2', name: 'Exam', weight: 100, grade: 90 }],
            },
          ],
        },
      ],
    });
    expect(hugeUnitsTracker.overall.cumulativeGpa).toBeCloseTo(3.85, 8);
    expect(hugeUnitsTracker.overall.weightedAverage).toBeCloseTo(85, 8);
    expect(hugeUnitsTracker.overall.completionPct).toBeCloseTo(100, 8);
    expect(Number.isFinite(hugeUnitsTracker.overall.totalUnitsEnrolled)).toBe(true);
    expect(Number.isFinite(hugeUnitsTracker.overall.gpaUnits)).toBe(true);
  });
});

describe('Mixed-Scale, Subnormal & Cancellation Invariants', () => {
  it('keeps graded overallGrade completely independent from normal or overflowing ungraded weights', () => {
    const sub101Pf = calculateCourseStats({
      id: 'sub1-pf',
      code: 'SUB101',
      units: 0.5,
      passFail: true,
      targetPct: 85,
      categories: [
        { id: 'k1', name: 'Micro Quiz', weight: Number.MIN_VALUE, grade: 80 },
        { id: 'k2', name: 'Final Exam', weight: 100, grade: null },
      ],
    });
    expect(sub101Pf.overallGrade).toBe(80);
    expect(sub101Pf.roundedPct).toBe(80);
    expect(sub101Pf.letter).toBe('P');
    expect(sub101Pf.gpa).toBeNull();

    const sub101Graded = calculateCourseStats({
      id: 'sub1-gpa',
      code: 'SUB101',
      units: 0.5,
      passFail: false,
      targetPct: 85,
      categories: [
        { id: 'k1', name: 'Micro Quiz', weight: Number.MIN_VALUE, grade: 80 },
        { id: 'k2', name: 'Final Exam', weight: 100, grade: null },
      ],
    });
    expect(sub101Graded.overallGrade).toBe(80);
    expect(sub101Graded.roundedPct).toBe(80);
    expect(sub101Graded.letter).toBe('A-');
    expect(sub101Graded.gpa).toBe(3.7);

    const sub102 = calculateCourseStats({
      id: 'sub2',
      code: 'SUB102',
      units: 0.5,
      passFail: false,
      targetPct: 85,
      categories: [
        { id: 'k1', name: 'Micro Quiz', weight: 1e-321, grade: 85 },
        { id: 'k2', name: 'Final Exam', weight: 100, grade: null },
      ],
    });
    expect(sub102.overallGrade).toBe(85);
    expect(sub102.roundedPct).toBe(85);
    expect(sub102.letter).toBe('A');
    expect(sub102.gpa).toBe(4.0);

    const mix101 = calculateCourseStats({
      id: 'mix1',
      code: 'MIX101',
      units: 0.5,
      passFail: false,
      targetPct: 85,
      categories: [
        { id: 'k1', name: 'Quiz', weight: 1e-20, grade: 80 },
        { id: 'k2', name: 'Midterm', weight: 1e308, grade: null },
        { id: 'k3', name: 'Final', weight: 1e308, grade: null },
      ],
    });
    expect(mix101.overallGrade).toBe(80);
    expect(mix101.roundedPct).toBe(80);
    expect(mix101.letter).toBe('A-');
    expect(mix101.gpa).toBe(3.7);
  });

  it('preserves precision for tiny/subnormal grades and multi-decade graded category mixes', () => {
    const subGradeA = calculateCourseStats({
      id: 'sg-a',
      code: 'SG101',
      units: 0.5,
      passFail: false,
      targetPct: 85,
      categories: [{ id: 'k1', name: 'Quiz', weight: 50, grade: Number.MIN_VALUE }],
    });
    expect(subGradeA.overallGrade).toBe(Number.MIN_VALUE);

    const subGradeB = calculateCourseStats({
      id: 'sg-b',
      code: 'SG102',
      units: 0.5,
      passFail: false,
      targetPct: 85,
      categories: [{ id: 'k1', name: 'Quiz', weight: Number.MIN_VALUE, grade: Number.MIN_VALUE }],
    });
    expect(subGradeB.overallGrade).toBe(Number.MIN_VALUE);

    const subGradeC = calculateCourseStats({
      id: 'sg-c',
      code: 'SG103',
      units: 0.5,
      passFail: false,
      targetPct: 85,
      categories: [{ id: 'k1', name: 'Quiz', weight: 1e-200, grade: 1e-200 }],
    });
    expect(subGradeC.overallGrade).toBeCloseTo(1e-200, 210);
    expect(subGradeC.overallGrade).toBeGreaterThan(0);

    const dominantHuge = calculateCourseStats({
      id: 'dom-huge',
      code: 'DOM101',
      units: 0.5,
      passFail: false,
      targetPct: 85,
      categories: [
        { id: 'k1', name: 'Major', weight: 1e308, grade: 90 },
        { id: 'k2', name: 'Minor', weight: 1e-20, grade: 50 },
      ],
    });
    expect(dominantHuge.overallGrade).toBe(90);
    expect(dominantHuge.letter).toBe('A+');

    const dominantZero = calculateCourseStats({
      id: 'dom-zero',
      code: 'DOM102',
      units: 0.5,
      passFail: false,
      targetPct: 85,
      categories: [
        { id: 'k1', name: 'Major Zero', weight: 1e308, grade: 0 },
        { id: 'k2', name: 'Minor', weight: 100, grade: 100 },
      ],
    });
    expect(dominantZero.overallGrade).toBeCloseTo(0, 12);
    expect(dominantZero.letter).toBe('F');
    expect(dominantZero.gpa).toBe(0);

    const crossDecade = calculateCourseStats({
      id: 'cross-dec',
      code: 'DOM103',
      units: 0.5,
      passFail: false,
      targetPct: 85,
      categories: [
        { id: 'k1', name: 'Zero Heavy', weight: 1e200, grade: 0 },
        { id: 'k2', name: 'Extreme Bonus', weight: 1e-200, grade: 1e300 },
      ],
    });
    expect(crossDecade.overallGrade).toBeGreaterThan(0);
    expect(Math.abs(Math.log10(crossDecade.overallGrade) - (-100))).toBeLessThan(1e-12);
  });

  it('computes cancellation-free remainingWeight and consistent targetStatus across extremes', () => {
    const rw101 = calculateCourseStats({
      id: 'rw1',
      code: 'RW101',
      units: 0.5,
      passFail: false,
      targetPct: 85,
      categories: [
        { id: 'k1', name: 'Huge Graded', weight: 1e18, grade: 80 },
        { id: 'k2', name: 'Ungraded Final', weight: 50, grade: null },
      ],
    });
    expect(rw101.remainingWeight).toBe(50);
    expect(rw101.targetStatus).toBe('unreachable');
    expect(Number.isFinite(rw101.requiredOnRemaining)).toBe(true);
    expect(rw101.requiredOnRemaining).toBeCloseTo(85 + (1e18 / 50) * 5, 0);

    const rw101Scaled = calculateCourseStats({
      id: 'rw1-s',
      code: 'RW101S',
      units: 0.5,
      passFail: false,
      targetPct: 90,
      categories: [
        { id: 'k1', name: 'Huge 1', weight: 1e308, grade: 80 },
        { id: 'k2', name: 'Huge 2', weight: 1e308, grade: 90 },
        { id: 'k3', name: 'Ungraded Final', weight: 50, grade: null },
      ],
    });
    expect(rw101Scaled.overallGrade).toBe(85);
    expect(rw101Scaled.remainingWeight).toBe(50);
    expect(rw101Scaled.targetStatus).toBe('unreachable');
    expect(Number.isFinite(rw101Scaled.requiredOnRemaining)).toBe(true);
    expect(rw101Scaled.requiredOnRemaining / 2e307).toBeCloseTo(1, 10);

    const tm101 = calculateCourseStats({
      id: 'tm1',
      code: 'TM101',
      units: 0.5,
      passFail: false,
      targetPct: 1e308,
      categories: [
        { id: 'k1', name: 'Huge Graded', weight: 1e13, grade: 80 },
        { id: 'k2', name: 'Remaining', weight: 1, grade: null },
      ],
    });
    expect(tm101.remainingWeight).toBe(1);
    expect(tm101.targetStatus).toBe('unreachable');
    expect(tm101.requiredOnRemaining).toBe(Number.MAX_VALUE);

    const rw103 = calculateCourseStats({
      id: 'rw3',
      code: 'RW103',
      units: 0.5,
      passFail: false,
      targetPct: 1e308,
      categories: [
        { id: 'k1', name: 'Graded', weight: 50, grade: 80 },
        { id: 'k2', name: 'Tiny Ungraded', weight: 5e-10, grade: null },
      ],
    });
    expect(rw103.remainingWeight).toBe(5e-10);
    expect(rw103.targetStatus).toBe('unreachable');
    expect(rw103.requiredOnRemaining).toBe(Number.MAX_VALUE);

    const infRatioCourse = {
      id: 'inf-r',
      code: 'INF101',
      units: 0.5,
      passFail: false,
      categories: [
        { id: 'k1', name: 'Graded', weight: 1e308, grade: 80 },
        { id: 'k2', name: 'Ungraded', weight: 1e-20, grade: null },
      ],
    };
    const belowRes = calculateTargetRequirement(infRatioCourse, 75);
    expect(belowRes.status).toBe('secured');
    expect(belowRes.requiredOnRemaining).toBe(-Number.MAX_VALUE);
    expect(belowRes.minPossible).toBe(80);
    expect(belowRes.maxPossible).toBe(80);

    const equalRes = calculateTargetRequirement(infRatioCourse, 80);
    expect(equalRes.status).toBe('achievable');
    expect(equalRes.requiredOnRemaining).toBe(80);

    const aboveRes = calculateTargetRequirement(infRatioCourse, 85);
    expect(aboveRes.status).toBe('unreachable');
    expect(aboveRes.requiredOnRemaining).toBe(Number.MAX_VALUE);

    const zeroRatioExtreme = calculateCourseStats({
      id: 'zr-ext',
      code: 'ZR101',
      units: 0.5,
      passFail: false,
      targetPct: 1e308,
      categories: [
        { id: 'k1', name: 'Tiny Negative', weight: Number.MIN_VALUE, grade: -1e308 },
        { id: 'k2', name: 'Main Final', weight: 100, grade: null },
      ],
    });
    expect(Number.isFinite(zeroRatioExtreme.requiredOnRemaining)).toBe(true);
    expect(zeroRatioExtreme.targetStatus).toBe('unreachable');
  });

  it('prevents product underflow and mixed-scale NaN in calculateAggregateStats', () => {
    const und101 = calculateAggregateStats([
      {
        id: 'u1',
        code: 'UND101',
        units: Number.MIN_VALUE,
        passFail: false,
        targetPct: 85,
        categories: [{ id: 'k1', name: 'Midterm', weight: 0.1, grade: 90 }],
      },
    ]);
    expect(und101.completionPct).toBe(100);
    expect(und101.cumulativeGpa).toBe(4.0);
    expect(und101.weightedAverage).toBeCloseTo(90, 12);
    expect(und101.totalUnitsEnrolled).toBe(Number.MIN_VALUE);
    expect(und101.gpaUnits).toBe(Number.MIN_VALUE);

    const tinyGradedHugeUngraded = calculateAggregateStats([
      {
        id: 'm-low',
        code: 'MIX201',
        units: 0.5,
        passFail: false,
        targetPct: 85,
        categories: [
          { id: 'k1', name: 'Quiz', weight: 1e-20, grade: 80 },
          { id: 'k2', name: 'Final', weight: 1e308, grade: null },
        ],
      },
    ]);
    expect(Number.isFinite(tinyGradedHugeUngraded.completionPct)).toBe(true);
    expect(tinyGradedHugeUngraded.completionPct).toBe(0);
    expect(tinyGradedHugeUngraded.cumulativeGpa).toBe(3.7);
    expect(tinyGradedHugeUngraded.weightedAverage).toBe(80);

    const hugeGradedTinyUngraded = calculateAggregateStats([
      {
        id: 'm-high',
        code: 'MIX202',
        units: 0.5,
        passFail: false,
        targetPct: 85,
        categories: [
          { id: 'k1', name: 'Midterm', weight: 1e308, grade: 80 },
          { id: 'k2', name: 'Quiz', weight: 1e-20, grade: null },
        ],
      },
    ]);
    expect(Number.isFinite(hugeGradedTinyUngraded.completionPct)).toBe(true);
    expect(hugeGradedTinyUngraded.completionPct).toBe(100);
    expect(hugeGradedTinyUngraded.cumulativeGpa).toBe(3.7);
    expect(hugeGradedTinyUngraded.weightedAverage).toBe(80);

    const multiCourseExtreme = calculateAggregateStats([
      {
        id: 'mc-1',
        code: 'SUB201',
        units: Number.MIN_VALUE,
        passFail: false,
        targetPct: 85,
        categories: [
          { id: 'k1', name: 'Quiz', weight: Number.MIN_VALUE, grade: 95 },
          { id: 'k2', name: 'Final', weight: 100, grade: null },
        ],
      },
      {
        id: 'mc-2',
        code: 'HUGE201',
        units: 1e308,
        passFail: false,
        targetPct: 85,
        categories: [
          { id: 'k3', name: 'Midterm', weight: 1e308, grade: 80 },
          { id: 'k4', name: 'Final', weight: 1e308, grade: null },
        ],
      },
    ]);
    expect(Number.isFinite(multiCourseExtreme.cumulativeGpa)).toBe(true);
    expect(multiCourseExtreme.cumulativeGpa).toBe(3.7);
    expect(Number.isFinite(multiCourseExtreme.weightedAverage)).toBe(true);
    expect(multiCourseExtreme.weightedAverage).toBe(80);
    expect(Number.isFinite(multiCourseExtreme.completionPct)).toBe(true);
    expect(multiCourseExtreme.completionPct).toBeCloseTo(50, 8);
    expect(multiCourseExtreme.completionPct).toBeGreaterThanOrEqual(0);
    expect(multiCourseExtreme.completionPct).toBeLessThanOrEqual(100);
  });

  it('guarantees structural IEEE-754 invariants across all subnormal, normal, and huge scale combinations', () => {
    const weights = [0, Number.MIN_VALUE, 1e-321, 1e-200, 5e-10, 0.5, 50, 1e18, 1e308];
    const grades = [null, 0, Number.MIN_VALUE, 50, 80, 85, 100, 1e307, -50];
    const targets = [-50, 0, 50, 80, 85, 100, 1e308];
    let verifiedPairs = 0;

    for (const w1 of weights) {
      for (const g1 of [null, 0, 80, 85, Number.MIN_VALUE, 1e307]) {
        const soloCourse = {
          id: 'solo',
          code: 'INV100',
          units: 0.5,
          passFail: false,
          targetPct: 85,
          categories: [{ id: 'k1', name: 'C1', weight: w1, grade: g1 }],
        };
        const soloStats = calculateCourseStats(soloCourse);

        for (const w2 of weights) {
          const withUngraded = calculateCourseStats({
            ...soloCourse,
            categories: [
              { id: 'k1', name: 'C1', weight: w1, grade: g1 },
              { id: 'k2', name: 'C2', weight: w2, grade: null },
            ],
          });
          expect(withUngraded.overallGrade).toBe(soloStats.overallGrade);
          expect(withUngraded.letter).toBe(soloStats.letter);
          expect(withUngraded.gpa).toBe(soloStats.gpa);
          expect(withUngraded.roundedPct).toBe(soloStats.roundedPct);

          for (const g2 of grades) {
            for (const targetPct of targets) {
              const s = calculateCourseStats({
                id: 'pair',
                code: 'INV101',
                units: w1 > 0 ? w1 : 0.5,
                passFail: false,
                targetPct,
                categories: [
                  { id: 'k1', name: 'C1', weight: w1, grade: g1 },
                  { id: 'k2', name: 'C2', weight: w2, grade: g2 },
                ],
              });

              const hasPosUngraded = (w1 > 0 && g1 === null) || (w2 > 0 && g2 === null);
              if (
                (s.remainingWeight > 0) !== hasPosUngraded ||
                (s.targetStatus === 'complete') !== !hasPosUngraded ||
                (s.requiredOnRemaining === null) !== !hasPosUngraded
              ) {
                throw new Error(
                  `Contradictory remaining/status for w1=${w1}, g1=${g1}, w2=${w2}, g2=${g2}, target=${targetPct}: ${JSON.stringify(s)}`
                );
              }

              for (const num of [
                s.totalWeight,
                s.gradedWeight,
                s.remainingWeight,
                s.weightedPoints,
                s.overallGrade,
                s.gpa,
                s.roundedPct,
                s.requiredOnRemaining,
                s.maxPossible,
                s.minPossible,
              ]) {
                if (num !== null && (!Number.isFinite(num) || Object.is(num, -0))) {
                  throw new Error(
                    `Non-finite or -0 output (${String(num)}) for w1=${w1}, g1=${g1}, w2=${w2}, g2=${g2}, target=${targetPct}`
                  );
                }
              }
              verifiedPairs += 1;
            }
          }
        }
      }
    }

    expect(verifiedPairs).toBe(weights.length * 6 * weights.length * grades.length * targets.length);
  });
});

describe('Term GPA Trend & Grade Distribution Visuals (#102)', () => {
  it('computes multi-term GPA progression, running cumulative GPA, deltas across ungraded gaps, and tier/Pass-Fail distribution', () => {
    const state = {
      gradeScale: DEFAULT_GRADE_SCALE,
      activeTermId: 't3',
      terms: [
        {
          id: 't1',
          name: 'Fall Y1',
          courses: [
            {
              id: 'c1',
              code: 'CS101',
              units: 3,
              passFail: false,
              categories: [{ id: 'k1', name: 'Exam', weight: 100, grade: 86 }], // A -> 4.0
            },
            {
              id: 'c2',
              code: 'HIST101',
              units: 3,
              passFail: false,
              categories: [{ id: 'k2', name: 'Essay', weight: 100, grade: 74 }], // B -> 3.0
            },
          ],
        },
        {
          id: 't2',
          name: 'Summer Blank',
          courses: [
            {
              id: 'c3',
              code: 'PLAN200',
              units: 3,
              passFail: false,
              categories: [{ id: 'k3', name: 'Final', weight: 100, grade: null }],
            },
          ],
        },
        {
          id: 't3',
          name: 'Fall Y2',
          courses: [
            {
              id: 'c4',
              code: 'CS201',
              units: 4,
              passFail: false,
              categories: [{ id: 'k4', name: 'Project', weight: 100, grade: 92 }], // A+ -> 4.0
            },
            {
              id: 'c5',
              code: 'SEM100',
              units: 1,
              passFail: true,
              categories: [{ id: 'k5', name: 'Attendance', weight: 100, grade: 80 }], // P
            },
          ],
        },
      ],
    };

    const visuals = calculateGpaVisuals(state);
    expect(visuals.scaleMaxGpa).toBe(4.0);
    expect(visuals.gradedTermCount).toBe(2);
    expect(visuals.gradedCourseCount).toBe(4);
    expect(visuals.ungradedCourseCount).toBe(1);
    expect(visuals.gradedUnits).toBe(11);

    // Term 1: (3*4.0 + 3*3.0) / 6 = 3.50
    expect(visuals.termSeries[0]).toMatchObject({
      termId: 't1',
      termName: 'Fall Y1',
      termGpa: 3.5,
      runningCumulativeGpa: 3.5,
      deltaFromPrev: null,
    });
    // Term 2 (ungraded): termGpa null, runningCumulativeGpa stays 3.50
    expect(visuals.termSeries[1]).toMatchObject({
      termId: 't2',
      termGpa: null,
      runningCumulativeGpa: 3.5,
      deltaFromPrev: null,
    });
    // Term 3: 4.00 term GPA (+0.50 delta vs Fall Y1); cumulative (21 + 16) / 10 = 3.70
    expect(visuals.termSeries[2].termGpa).toBeCloseTo(4.0, 5);
    expect(visuals.termSeries[2].deltaFromPrev).toBeCloseTo(0.5, 5);
    expect(visuals.termSeries[2].runningCumulativeGpa).toBeCloseTo(3.7, 5);

    const tierA = visuals.distribution.find((b) => b.key === 'tier-a');
    const tierB = visuals.distribution.find((b) => b.key === 'tier-b');
    const passRow = visuals.distribution.find((b) => b.key === 'pass');
    expect(tierA).toMatchObject({
      label: 'A+ / A / A-',
      count: 2,
      units: 7,
      roundedPct: 50,
    });
    expect(tierB).toMatchObject({
      label: 'B+ / B / B-',
      count: 1,
      units: 3,
      roundedPct: 25,
    });
    expect(passRow).toMatchObject({
      label: 'P (Pass)',
      count: 1,
      units: 1,
      roundedPct: 25,
    });
  });
});
