import { STORAGE_KEY, DEFAULT_GRADE_SCALE } from '../domain/constants.js';
import { deriveTierFromGpa } from '../domain/calculations.js';
import { createInitialState } from '../domain/templates.js';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function makeUniqueId(preferred, fallbackBase, usedSet) {
  const base = typeof preferred === 'string' && preferred.trim() !== ''
    ? preferred.trim()
    : fallbackBase;
  if (!usedSet.has(base)) {
    usedSet.add(base);
    return base;
  }
  let suffix = 2;
  while (usedSet.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  const candidate = `${base}-${suffix}`;
  usedSet.add(candidate);
  return candidate;
}

function cloneDefaultGradeScale() {
  if (typeof structuredClone === 'function') {
    return structuredClone(DEFAULT_GRADE_SCALE);
  }
  return DEFAULT_GRADE_SCALE.map((band) => ({ ...band }));
}

function normalizeGradeScale(rawScale) {
  if (!Array.isArray(rawScale) || rawScale.length === 0) {
    return cloneDefaultGradeScale();
  }

  const normalized = [];
  for (const band of rawScale) {
    if (!isPlainObject(band)) {
      return cloneDefaultGradeScale();
    }
    if (
      typeof band.min !== 'number' ||
      !Number.isFinite(band.min) ||
      band.min < 0 ||
      band.min > 100
    ) {
      return cloneDefaultGradeScale();
    }
    if (
      typeof band.max !== 'number' ||
      !Number.isFinite(band.max) ||
      band.max < band.min ||
      band.max > 100
    ) {
      return cloneDefaultGradeScale();
    }
    if (typeof band.letter !== 'string' || band.letter.trim() === '') {
      return cloneDefaultGradeScale();
    }
    if (
      typeof band.gpa !== 'number' ||
      !Number.isFinite(band.gpa) ||
      band.gpa < 0 ||
      band.gpa > 100
    ) {
      return cloneDefaultGradeScale();
    }

    const min = band.min === 0 ? 0 : band.min;
    const max = band.max === 0 ? 0 : band.max;
    const gpa = band.gpa === 0 ? 0 : band.gpa;
    const letter = band.letter.trim();
    const rangeLabel = typeof band.rangeLabel === 'string' && band.rangeLabel.trim() !== ''
      ? band.rangeLabel.trim()
      : `${min}–${max}%`;
    const boundLabel = typeof band.boundLabel === 'string' && band.boundLabel.trim() !== ''
      ? band.boundLabel.trim()
      : `${max}%`;
    const tier = typeof band.tier === 'string' && band.tier.trim() !== ''
      ? band.tier.trim()
      : deriveTierFromGpa(gpa);

    normalized.push({
      min,
      max,
      rangeLabel,
      boundLabel,
      letter,
      gpa,
      tier,
    });
  }

  normalized.sort((a, b) => b.min - a.min);
  return normalized;
}

/**
 * Deeply validates and normalizes a raw TrackerState object without mutating input.
 * Throws a descriptive Error on any structural or type violation.
 */
export function validateTrackerState(raw) {
  if (!isPlainObject(raw)) {
    throw new Error('Invalid tracker state: root value must be a JSON object.');
  }

  if (raw.studentName !== undefined && typeof raw.studentName !== 'string') {
    throw new Error('Invalid tracker state: "studentName" must be a string.');
  }
  if (raw.lastUpdated !== undefined && typeof raw.lastUpdated !== 'string') {
    throw new Error('Invalid tracker state: "lastUpdated" must be an ISO timestamp string.');
  }
  if (raw.activeTermId !== undefined && typeof raw.activeTermId !== 'string') {
    throw new Error('Invalid tracker state: "activeTermId" must be a string.');
  }

  if (!Array.isArray(raw.terms) || raw.terms.length === 0) {
    throw new Error('Invalid tracker state: "terms" must be a non-empty array.');
  }

  const studentName = (raw.studentName || '').trim() || 'My';
  const lastUpdated = (raw.lastUpdated || '').trim() || new Date().toISOString();
  const gradeScale = normalizeGradeScale(raw.gradeScale);

  const usedTermIds = new Set();
  const usedCourseIds = new Set();
  const usedCatIds = new Set();

  const normalizedTerms = raw.terms.map((term, tIdx) => {
    if (!isPlainObject(term)) {
      throw new Error(`Invalid tracker state: term at index ${tIdx} must be an object.`);
    }
    if (term.id !== undefined && typeof term.id !== 'string') {
      throw new Error(`Invalid tracker state: term at index ${tIdx} has non-string "id".`);
    }
    if (term.name !== undefined && typeof term.name !== 'string') {
      throw new Error(`Invalid tracker state: term at index ${tIdx} has non-string "name".`);
    }

    const termId = makeUniqueId(term.id, `term-${tIdx + 1}`, usedTermIds);
    const termName = (term.name || '').trim() || `Term ${tIdx + 1}`;

    if (!Array.isArray(term.courses)) {
      throw new Error(`Invalid tracker state: term "${termName}" must have a "courses" array.`);
    }

    const normalizedCourses = term.courses.map((course, cIdx) => {
      if (!isPlainObject(course)) {
        throw new Error(`Invalid tracker state: course at index ${cIdx} in "${termName}" must be an object.`);
      }
      if (course.id !== undefined && typeof course.id !== 'string') {
        throw new Error(`Invalid tracker state: course at index ${cIdx} in "${termName}" has non-string "id".`);
      }
      if (typeof course.code !== 'string' || course.code.trim() === '') {
        throw new Error(`Invalid tracker state: course at index ${cIdx} in "${termName}" must have a non-empty string "code".`);
      }
      if (course.title !== undefined && typeof course.title !== 'string') {
        throw new Error(`Invalid tracker state: course "${course.code}" must have a string "title".`);
      }
      if (
        typeof course.units !== 'number' ||
        !Number.isFinite(course.units) ||
        course.units <= 0 ||
        course.units > 100
      ) {
        throw new Error(`Invalid tracker state: course "${course.code}" must have a finite numeric "units" greater than 0 and at most 100.`);
      }
      const normalizedUnits = course.units === 0 ? 0 : course.units;

      const rawPassFail = course.passFail !== undefined ? course.passFail : course.creditNoCredit;
      let passFail = false;
      if (rawPassFail !== undefined) {
        if (typeof rawPassFail === 'boolean' || rawPassFail === 0 || rawPassFail === 1) {
          passFail = Boolean(rawPassFail);
        } else {
          throw new Error(`Invalid tracker state: course "${course.code}" has invalid "passFail" flag.`);
        }
      }

      const duration = course.duration === 'full-year' ? 'full-year' : 'term';
      const collapsed = Boolean(course.collapsed);

      let targetPct = 85;
      if (course.targetPct !== undefined) {
        if (
          typeof course.targetPct !== 'number' ||
          !Number.isFinite(course.targetPct) ||
          course.targetPct <= 0 ||
          course.targetPct > 100
        ) {
          throw new Error(`Invalid tracker state: course "${course.code}" must have "targetPct" between 1 and 100.`);
        }
        targetPct = course.targetPct === 0 ? 0 : course.targetPct;
      }

      if (!Array.isArray(course.categories)) {
        throw new Error(`Invalid tracker state: course "${course.code}" must have a "categories" array.`);
      }

      const courseId = makeUniqueId(course.id, `c-${tIdx + 1}-${cIdx + 1}`, usedCourseIds);

      const normalizedCategories = course.categories.map((cat, kIdx) => {
        if (!isPlainObject(cat)) {
          throw new Error(`Invalid tracker state: category at index ${kIdx} in "${course.code}" must be an object.`);
        }
        if (cat.id !== undefined && typeof cat.id !== 'string') {
          throw new Error(`Invalid tracker state: category at index ${kIdx} in "${course.code}" has non-string "id".`);
        }
        if (typeof cat.name !== 'string') {
          throw new Error(`Invalid tracker state: category at index ${kIdx} in "${course.code}" must have a string "name".`);
        }
        if (
          typeof cat.weight !== 'number' ||
          !Number.isFinite(cat.weight) ||
          cat.weight < 0 ||
          cat.weight > 1000
        ) {
          throw new Error(`Invalid tracker state: category "${cat.name}" in "${course.code}" must have a finite "weight" between 0 and 1000.`);
        }
        const normalizedWeight = cat.weight === 0 ? 0 : cat.weight;

        let normalizedGrade = null;
        if (cat.grade !== null && cat.grade !== undefined) {
          if (
            typeof cat.grade !== 'number' ||
            !Number.isFinite(cat.grade) ||
            cat.grade < 0 ||
            cat.grade > 1000
          ) {
            throw new Error(`Invalid tracker state: category "${cat.name}" in "${course.code}" must have null or a finite "grade" between 0 and 1000.`);
          }
          normalizedGrade = cat.grade === 0 ? 0 : cat.grade;
        }

        const catId = makeUniqueId(cat.id, `cat-${tIdx + 1}-${cIdx + 1}-${kIdx + 1}`, usedCatIds);

        return {
          id: catId,
          name: cat.name,
          weight: normalizedWeight,
          grade: normalizedGrade,
        };
      });

      return {
        id: courseId,
        code: course.code.trim(),
        title: course.title ?? '',
        units: normalizedUnits,
        duration,
        passFail,
        collapsed,
        targetPct,
        categories: normalizedCategories,
      };
    });

    return {
      id: termId,
      name: termName,
      courses: normalizedCourses,
    };
  });

  const activeTermId = normalizedTerms.some((t) => t.id === raw.activeTermId)
    ? raw.activeTermId
    : normalizedTerms[0].id;

  return {
    version: 1,
    studentName,
    lastUpdated,
    activeTermId,
    gradeScale,
    terms: normalizedTerms,
  };
}

export function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
  };
}

function resolveStorage(explicitStorage, hasExplicitOption) {
  if (hasExplicitOption) {
    if (
      explicitStorage &&
      typeof explicitStorage.getItem === 'function' &&
      typeof explicitStorage.setItem === 'function'
    ) {
      return explicitStorage;
    }
    return createMemoryStorage();
  }

  try {
    const candidate = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
    if (
      candidate &&
      typeof candidate.getItem === 'function' &&
      typeof candidate.setItem === 'function'
    ) {
      return candidate;
    }
  } catch {
    // SecurityError when accessing localStorage in restricted contexts; fall back to memory
  }
  return createMemoryStorage();
}

function cloneState(state) {
  if (typeof structuredClone === 'function') {
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state));
}

/**
 * StorageService manages localStorage persistence now and exposes a clean adapter hook
 * for Phase 2 CloudSyncAdapter (remote cloud sync).
 */
export class StorageService {
  constructor(options = {}) {
    const hasExplicitStorage = Boolean(options) && Object.prototype.hasOwnProperty.call(options, 'storage');
    this.storageKey = options?.storageKey || STORAGE_KEY;
    this.storage = resolveStorage(options?.storage, hasExplicitStorage);
    this.cloudAdapter = null;
    this.cloudUnsubscribe = null;
    this.listeners = new Set();
  }

  /**
   * Register an optional Phase 2 CloudSyncAdapter:
   * { load?, save?, subscribe?, signIn?, signOut?, getUser? }
   * Returns an unsubscribe / detach function.
   */
  registerCloudAdapter(adapter) {
    if (typeof this.cloudUnsubscribe === 'function') {
      try {
        this.cloudUnsubscribe();
      } catch {
        // Ignore cleanup errors on previous adapter
      }
      this.cloudUnsubscribe = null;
    }

    this.cloudAdapter = adapter || null;

    if (adapter && typeof adapter.subscribe === 'function') {
      const maybeUnsub = adapter.subscribe((remoteState) => {
        if (!remoteState) return;
        try {
          const validated = this.validateAndMigrate(remoteState);
          this.saveLocalOnly(validated);
          this.notify(validated);
        } catch (err) {
          console.warn('Ignored invalid remote cloud state:', err);
        }
      });
      if (typeof maybeUnsub === 'function') {
        this.cloudUnsubscribe = maybeUnsub;
      }
    }

    return () => {
      if (typeof this.cloudUnsubscribe === 'function') {
        try {
          this.cloudUnsubscribe();
        } catch {
          // Ignore cleanup errors
        }
        this.cloudUnsubscribe = null;
      }
      if (this.cloudAdapter === adapter) {
        this.cloudAdapter = null;
      }
    };
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notify(state) {
    for (const listener of this.listeners) {
      try {
        listener(cloneState(state));
      } catch (err) {
        console.error('StorageService listener error:', err);
      }
    }
  }

  load() {
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) {
        const initial = createInitialState();
        this.saveLocalOnly(initial);
        return initial;
      }
      const parsed = JSON.parse(raw);
      return this.validateAndMigrate(parsed);
    } catch {
      const fallback = createInitialState();
      this.saveLocalOnly(fallback);
      return fallback;
    }
  }

  saveLocalOnly(state) {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(state));
    } catch {
      // Swallow QuotaExceededError / SecurityError safely so UI and cloud sync continue
    }
  }

  /**
   * Pure state validator/normalizer with zero storage, cloud, or listener side effects,
   * safe to call inside React `<StrictMode>` state updaters (#14).
   */
  prepareForSave(state, { touchTimestamp = true, nowIso = new Date().toISOString() } = {}) {
    const cloned = this.validateAndMigrate(state);
    return {
      ...cloned,
      lastUpdated: touchTimestamp ? nowIso : cloned.lastUpdated,
    };
  }

  save(
    state,
    { touchTimestamp = true, notifyListeners = true, syncToCloud = true } = {},
  ) {
    const nextState = this.prepareForSave(state, { touchTimestamp });

    this.saveLocalOnly(nextState);

    if (
      syncToCloud &&
      this.cloudAdapter &&
      typeof this.cloudAdapter.save === 'function'
    ) {
      const adapter = this.cloudAdapter;
      const cloudSnapshot = cloneState(nextState);
      Promise.resolve()
        .then(() => adapter.save(cloudSnapshot))
        .catch((err) => {
          console.warn('Cloud sync save failed (local copy is safe):', err);
        });
    }

    if (notifyListeners) {
      this.notify(nextState);
    }
    return cloneState(nextState);
  }

  validateAndMigrate(raw) {
    return validateTrackerState(raw);
  }
}

export const storageService = new StorageService();

export function registerCloudAdapter(adapter) {
  return storageService.registerCloudAdapter(adapter);
}
