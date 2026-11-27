export const STORAGE_KEY = 'grade_tracker_v1';
export const MAX_GPA_POINTS = 100;

export const DEFAULT_GRADE_SCALE = [
  { min: 90, max: 100, rangeLabel: '90–100%', boundLabel: '100%', letter: 'A+', gpa: 4.0, tier: 'tier-a' },
  { min: 85, max: 89,  rangeLabel: '85–89%',  boundLabel: '89%',  letter: 'A',  gpa: 4.0, tier: 'tier-a' },
  { min: 80, max: 84,  rangeLabel: '80–84%',  boundLabel: '84%',  letter: 'A-', gpa: 3.7, tier: 'tier-a' },
  { min: 77, max: 79,  rangeLabel: '77–79%',  boundLabel: '79%',  letter: 'B+', gpa: 3.3, tier: 'tier-b' },
  { min: 73, max: 76,  rangeLabel: '73–76%',  boundLabel: '76%',  letter: 'B',  gpa: 3.0, tier: 'tier-b' },
  { min: 70, max: 72,  rangeLabel: '70–72%',  boundLabel: '72%',  letter: 'B-', gpa: 2.7, tier: 'tier-b' },
  { min: 67, max: 69,  rangeLabel: '67–69%',  boundLabel: '69%',  letter: 'C+', gpa: 2.3, tier: 'tier-c' },
  { min: 63, max: 66,  rangeLabel: '63–66%',  boundLabel: '66%',  letter: 'C',  gpa: 2.0, tier: 'tier-c' },
  { min: 60, max: 62,  rangeLabel: '60–62%',  boundLabel: '62%',  letter: 'C-', gpa: 1.7, tier: 'tier-c' },
  { min: 57, max: 59,  rangeLabel: '57–59%',  boundLabel: '59%',  letter: 'D+', gpa: 1.3, tier: 'tier-d' },
  { min: 53, max: 56,  rangeLabel: '53–56%',  boundLabel: '56%',  letter: 'D',  gpa: 1.0, tier: 'tier-d' },
  { min: 50, max: 52,  rangeLabel: '50–52%',  boundLabel: '52%',  letter: 'D-', gpa: 0.7, tier: 'tier-d' },
  { min: 0,  max: 49,  rangeLabel: '0–49%',   boundLabel: '49%',  letter: 'F',  gpa: 0.0, tier: 'tier-f' },
];

export const TARGET_PRESETS = [
  { label: 'A+ (90%)', pct: 90 },
  { label: 'A (85%)',  pct: 85 },
  { label: 'A- (80%)', pct: 80 },
  { label: 'B+ (77%)', pct: 77 },
  { label: 'B (73%)',  pct: 73 },
  { label: 'B- (70%)', pct: 70 },
  { label: 'C+ (67%)', pct: 67 },
  { label: 'C (63%)',  pct: 63 },
  { label: 'Pass (50%)', pct: 50 },
];

export const UNIT_OPTIONS = [0.25, 0.5, 1.0, 1.5, 2.0];

export const DURATION_OPTIONS = [
  { value: 'term', label: 'Single Term' },
  { value: 'full-year', label: 'Full Year' },
];
