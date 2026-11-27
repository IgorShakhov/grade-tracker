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

export const CURRENT_SCHEMA_VERSION = 1;
export const MAX_CORRUPT_BACKUPS = 2;

export class SchemaTooNewError extends Error {
  constructor(foundVersion, maxSupportedVersion = CURRENT_SCHEMA_VERSION) {
    super(
      `Tracker data uses schema version ${foundVersion}, which is newer than this app supports (v${maxSupportedVersion}). Reload the page to update Grade Tracker before editing.`,
    );
    this.name = 'SchemaTooNewError';
    this.code = 'storage/schema-too-new';
    this.foundVersion = foundVersion;
    this.maxSupportedVersion = maxSupportedVersion;
  }
}

export function isSchemaTooNewError(err) {
  return (
    err instanceof SchemaTooNewError || err?.code === 'storage/schema-too-new'
  );
}

/**
 * Forward migration registry keyed by source schema version (`0 -> 1`, `1 -> 2`, ...).
 * Add `1: (rawV1) => ({ ... })` here when bumping `CURRENT_SCHEMA_VERSION` to `2` in M3.
 */
const SCHEMA_MIGRATIONS = {};

function runSchemaMigrations(raw) {
  if (!isPlainObject(raw)) {
    throw new Error('Invalid tracker state: root value must be a JSON object.');
  }

  if (raw.version !== undefined) {
    if (
      typeof raw.version !== 'number' ||
      !Number.isInteger(raw.version) ||
      raw.version < 0
    ) {
      throw new Error(
        'Invalid tracker state: "version" must be a non-negative integer.',
      );
    }
    if (raw.version > CURRENT_SCHEMA_VERSION) {
      throw new SchemaTooNewError(raw.version, CURRENT_SCHEMA_VERSION);
    }
  }

  let current = raw;
  let v = typeof raw.version === 'number' ? raw.version : 0;
  while (v < CURRENT_SCHEMA_VERSION) {
    const migrate = SCHEMA_MIGRATIONS[v];
    if (typeof migrate === 'function') {
      current = migrate(current);
    }
    v += 1;
  }
  return current;
}

function normalizeSingleCategory(cat, tIdx, cIdx, kIdx, courseCode, usedCatIds) {
  if (!isPlainObject(cat)) {
    throw new Error(
      `Invalid tracker state: category at index ${kIdx} in "${courseCode}" must be an object.`,
    );
  }
  if (cat.id !== undefined && typeof cat.id !== 'string') {
    throw new Error(
      `Invalid tracker state: category at index ${kIdx} in "${courseCode}" has non-string "id".`,
    );
  }
  if (typeof cat.name !== 'string') {
    throw new Error(
      `Invalid tracker state: category at index ${kIdx} in "${courseCode}" must have a string "name".`,
    );
  }
  if (
    typeof cat.weight !== 'number' ||
    !Number.isFinite(cat.weight) ||
    cat.weight < 0 ||
    cat.weight > 1000
  ) {
    throw new Error(
      `Invalid tracker state: category "${cat.name}" in "${courseCode}" must have a finite "weight" between 0 and 1000.`,
    );
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
      throw new Error(
        `Invalid tracker state: category "${cat.name}" in "${courseCode}" must have null or a finite "grade" between 0 and 1000.`,
      );
    }
    normalizedGrade = cat.grade === 0 ? 0 : cat.grade;
  }

  const catId = makeUniqueId(
    cat.id,
    `cat-${tIdx + 1}-${cIdx + 1}-${kIdx + 1}`,
    usedCatIds,
  );

  return {
    id: catId,
    name: cat.name,
    weight: normalizedWeight,
    grade: normalizedGrade,
  };
}

function normalizeCourseHeaderFields(course, tIdx, cIdx, termName, usedCourseIds) {
  if (!isPlainObject(course)) {
    throw new Error(
      `Invalid tracker state: course at index ${cIdx} in "${termName}" must be an object.`,
    );
  }
  if (course.id !== undefined && typeof course.id !== 'string') {
    throw new Error(
      `Invalid tracker state: course at index ${cIdx} in "${termName}" has non-string "id".`,
    );
  }
  if (typeof course.code !== 'string' || course.code.trim() === '') {
    throw new Error(
      `Invalid tracker state: course at index ${cIdx} in "${termName}" must have a non-empty string "code".`,
    );
  }
  if (course.title !== undefined && typeof course.title !== 'string') {
    throw new Error(
      `Invalid tracker state: course "${course.code}" must have a string "title".`,
    );
  }
  if (
    typeof course.units !== 'number' ||
    !Number.isFinite(course.units) ||
    course.units <= 0 ||
    course.units > 100
  ) {
    throw new Error(
      `Invalid tracker state: course "${course.code}" must have a finite numeric "units" greater than 0 and at most 100.`,
    );
  }
  const normalizedUnits = course.units === 0 ? 0 : course.units;

  const rawPassFail =
    course.passFail !== undefined ? course.passFail : course.creditNoCredit;
  let passFail = false;
  if (rawPassFail !== undefined) {
    if (
      typeof rawPassFail === 'boolean' ||
      rawPassFail === 0 ||
      rawPassFail === 1
    ) {
      passFail = Boolean(rawPassFail);
    } else {
      throw new Error(
        `Invalid tracker state: course "${course.code}" has invalid "passFail" flag.`,
      );
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
      throw new Error(
        `Invalid tracker state: course "${course.code}" must have "targetPct" between 1 and 100.`,
      );
    }
    targetPct = course.targetPct === 0 ? 0 : course.targetPct;
  }

  if (!Array.isArray(course.categories)) {
    throw new Error(
      `Invalid tracker state: course "${course.code}" must have a "categories" array.`,
    );
  }

  const courseId = makeUniqueId(
    course.id,
    `c-${tIdx + 1}-${cIdx + 1}`,
    usedCourseIds,
  );

  return {
    id: courseId,
    code: course.code.trim(),
    title: course.title ?? '',
    units: normalizedUnits,
    duration,
    passFail,
    collapsed,
    targetPct,
  };
}

/**
 * Deeply validates and normalizes a raw TrackerState object without mutating input.
 * Throws `SchemaTooNewError` if `raw.version > CURRENT_SCHEMA_VERSION`, or a descriptive
 * Error on any structural or type violation.
 */
export function validateTrackerState(raw) {
  const migrated = runSchemaMigrations(raw);

  if (migrated.studentName !== undefined && typeof migrated.studentName !== 'string') {
    throw new Error('Invalid tracker state: "studentName" must be a string.');
  }
  if (migrated.lastUpdated !== undefined && typeof migrated.lastUpdated !== 'string') {
    throw new Error(
      'Invalid tracker state: "lastUpdated" must be an ISO timestamp string.',
    );
  }
  if (migrated.activeTermId !== undefined && typeof migrated.activeTermId !== 'string') {
    throw new Error('Invalid tracker state: "activeTermId" must be a string.');
  }

  if (!Array.isArray(migrated.terms) || migrated.terms.length === 0) {
    throw new Error('Invalid tracker state: "terms" must be a non-empty array.');
  }

  const studentName = (migrated.studentName || '').trim() || 'My';
  const lastUpdated =
    (migrated.lastUpdated || '').trim() || new Date().toISOString();
  const gradeScale = normalizeGradeScale(migrated.gradeScale);

  const usedTermIds = new Set();
  const usedCourseIds = new Set();
  const usedCatIds = new Set();

  const normalizedTerms = migrated.terms.map((term, tIdx) => {
    if (!isPlainObject(term)) {
      throw new Error(
        `Invalid tracker state: term at index ${tIdx} must be an object.`,
      );
    }
    if (term.id !== undefined && typeof term.id !== 'string') {
      throw new Error(
        `Invalid tracker state: term at index ${tIdx} has non-string "id".`,
      );
    }
    if (term.name !== undefined && typeof term.name !== 'string') {
      throw new Error(
        `Invalid tracker state: term at index ${tIdx} has non-string "name".`,
      );
    }

    const termId = makeUniqueId(term.id, `term-${tIdx + 1}`, usedTermIds);
    const termName = (term.name || '').trim() || `Term ${tIdx + 1}`;

    if (!Array.isArray(term.courses)) {
      throw new Error(
        `Invalid tracker state: term "${termName}" must have a "courses" array.`,
      );
    }

    const normalizedCourses = term.courses.map((course, cIdx) => {
      const header = normalizeCourseHeaderFields(
        course,
        tIdx,
        cIdx,
        termName,
        usedCourseIds,
      );
      const normalizedCategories = course.categories.map((cat, kIdx) =>
        normalizeSingleCategory(
          cat,
          tIdx,
          cIdx,
          kIdx,
          header.code,
          usedCatIds,
        ),
      );
      return {
        ...header,
        categories: normalizedCategories,
      };
    });

    return {
      id: termId,
      name: termName,
      courses: normalizedCourses,
    };
  });

  const activeTermId = normalizedTerms.some((t) => t.id === migrated.activeTermId)
    ? migrated.activeTermId
    : normalizedTerms[0].id;

  return {
    version: CURRENT_SCHEMA_VERSION,
    studentName,
    lastUpdated,
    activeTermId,
    gradeScale,
    terms: normalizedTerms,
  };
}

/**
 * Attempts per-term, per-course, and per-category salvage on a partially corrupted
 * JSON object so valid sibling courses survive single-field corruption (#36).
 * Returns `{ state, droppedCount }` when salvageable, or `null` if no valid courses remain.
 */
function salvageTrackerState(raw) {
  if (!isPlainObject(raw) || !Array.isArray(raw.terms) || raw.terms.length === 0) {
    return null;
  }

  let droppedCount = 0;
  if (
    raw.version !== undefined &&
    (typeof raw.version !== 'number' ||
      !Number.isInteger(raw.version) ||
      raw.version < 0)
  ) {
    droppedCount += 1;
  }
  if (raw.studentName !== undefined && typeof raw.studentName !== 'string') {
    droppedCount += 1;
  }
  if (raw.lastUpdated !== undefined && typeof raw.lastUpdated !== 'string') {
    droppedCount += 1;
  }
  if (raw.activeTermId !== undefined && typeof raw.activeTermId !== 'string') {
    droppedCount += 1;
  }

  const studentName =
    typeof raw.studentName === 'string' && raw.studentName.trim() !== ''
      ? raw.studentName.trim()
      : 'My';
  const lastUpdated =
    typeof raw.lastUpdated === 'string' && raw.lastUpdated.trim() !== ''
      ? raw.lastUpdated.trim()
      : new Date().toISOString();
  const gradeScale = normalizeGradeScale(raw.gradeScale);

  const usedTermIds = new Set();
  const usedCourseIds = new Set();
  const usedCatIds = new Set();
  let hadAnyRawCourses = false;
  let salvagedCourseCount = 0;

  const salvagedTerms = [];
  raw.terms.forEach((term, tIdx) => {
    if (!isPlainObject(term) || !Array.isArray(term.courses)) {
      droppedCount += 1;
      return;
    }
    const safeIdInput = typeof term.id === 'string' ? term.id : undefined;
    const safeNameInput = typeof term.name === 'string' ? term.name : '';
    if (
      (term.id !== undefined && typeof term.id !== 'string') ||
      (term.name !== undefined && typeof term.name !== 'string')
    ) {
      droppedCount += 1;
    }

    const termId = makeUniqueId(safeIdInput, `term-${tIdx + 1}`, usedTermIds);
    const termName = safeNameInput.trim() || `Term ${tIdx + 1}`;
    if (term.courses.length > 0) {
      hadAnyRawCourses = true;
    }

    const salvagedCourses = [];
    term.courses.forEach((course, cIdx) => {
      let header;
      try {
        header = normalizeCourseHeaderFields(
          course,
          tIdx,
          cIdx,
          termName,
          usedCourseIds,
        );
      } catch {
        droppedCount += 1;
        return;
      }

      const salvagedCategories = [];
      course.categories.forEach((cat, kIdx) => {
        try {
          salvagedCategories.push(
            normalizeSingleCategory(
              cat,
              tIdx,
              cIdx,
              kIdx,
              header.code,
              usedCatIds,
            ),
          );
        } catch {
          droppedCount += 1;
        }
      });

      salvagedCourses.push({
        ...header,
        categories: salvagedCategories,
      });
      salvagedCourseCount += 1;
    });

    salvagedTerms.push({
      id: termId,
      name: termName,
      courses: salvagedCourses,
    });
  });

  if (salvagedTerms.length === 0 || (hadAnyRawCourses && salvagedCourseCount === 0)) {
    return null;
  }

  const activeTermId =
    typeof raw.activeTermId === 'string' &&
    salvagedTerms.some((t) => t.id === raw.activeTermId)
      ? raw.activeTermId
      : salvagedTerms[0].id;

  return {
    state: {
      version: CURRENT_SCHEMA_VERSION,
      studentName,
      lastUpdated,
      activeTermId,
      gradeScale,
      terms: salvagedTerms,
    },
    droppedCount: Math.max(1, droppedCount),
  };
}

export function createMemoryStorage() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
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
    const hasExplicitStorage =
      Boolean(options) && Object.prototype.hasOwnProperty.call(options, 'storage');
    this.storageKey = options?.storageKey || STORAGE_KEY;
    this.storage = resolveStorage(options?.storage, hasExplicitStorage);
    this.cloudAdapter = null;
    this.cloudUnsubscribe = null;
    this.listeners = new Set();
    this.schemaTooNew = false;
    this.schemaTooNewError = null;
    this.loadRecoveredFromCorruption = false;
    this.loadRecoveryInfo = null;
    this.lastRepairedSerialized = null;
  }

  getRecoveryNotice() {
    return this.loadRecoveryInfo ? { ...this.loadRecoveryInfo } : null;
  }

  dismissRecoveryNotice() {
    this.loadRecoveredFromCorruption = false;
    this.loadRecoveryInfo = null;
    this.lastRepairedSerialized = null;
  }

  resetClean() {
    this.schemaTooNew = false;
    this.schemaTooNewError = null;
    this.loadRecoveredFromCorruption = false;
    this.loadRecoveryInfo = null;
    this.lastRepairedSerialized = null;
    try {
      if (typeof this.storage.removeItem === 'function') {
        this.storage.removeItem(this.storageKey);
      }
    } catch {
      // Ignore storage errors
    }
    const fresh = createInitialState();
    this.saveLocalOnly(fresh);
    this.notify(fresh);
    return fresh;
  }

  backupCorruptPayload(raw) {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const prefix = `${this.storageKey}_corrupt_`;
    const nowTs = Date.now();
    try {
      const existingEntries = [];
      if (
        typeof this.storage.length === 'number' &&
        typeof this.storage.key === 'function'
      ) {
        for (let i = 0; i < this.storage.length; i += 1) {
          const k = this.storage.key(i);
          if (typeof k === 'string' && k.startsWith(prefix)) {
            const rest = k.slice(prefix.length);
            const m = /^(\d+)(?:_(\d+))?$/.exec(rest);
            existingEntries.push({
              key: k,
              ts: m ? Number(m[1]) : 0,
              seq: m && m[2] ? Number(m[2]) : 1,
            });
          }
        }
      }

      existingEntries.sort((a, b) => a.ts - b.ts || a.seq - b.seq);

      const maxExistingTs =
        existingEntries.length > 0
          ? existingEntries[existingEntries.length - 1].ts
          : 0;
      const effectiveTs = Math.max(nowTs, maxExistingTs);

      let maxSeqForTs = 0;
      for (const entry of existingEntries) {
        if (entry.ts === effectiveTs && entry.seq > maxSeqForTs) {
          maxSeqForTs = entry.seq;
        }
      }

      let backupKey =
        maxSeqForTs === 0
          ? `${prefix}${effectiveTs}`
          : `${prefix}${effectiveTs}_${maxSeqForTs + 1}`;
      while (this.storage.getItem(backupKey) !== null) {
        maxSeqForTs += 1;
        backupKey = `${prefix}${effectiveTs}_${maxSeqForTs + 1}`;
      }

      if (typeof this.storage.removeItem === 'function') {
        while (existingEntries.length >= MAX_CORRUPT_BACKUPS) {
          const oldest = existingEntries.shift();
          this.storage.removeItem(oldest.key);
        }
      }

      this.storage.setItem(backupKey, raw);
      return backupKey;
    } catch {
      return null;
    }
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
    let raw = null;
    try {
      raw = this.storage.getItem(this.storageKey);
    } catch {
      const fallback = createInitialState();
      this.saveLocalOnly(fallback);
      return fallback;
    }

    if (!raw) {
      this.schemaTooNew = false;
      this.schemaTooNewError = null;
      this.loadRecoveredFromCorruption = false;
      this.loadRecoveryInfo = null;
      this.lastRepairedSerialized = null;
      const initial = createInitialState();
      this.saveLocalOnly(initial);
      return initial;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
      const validated = this.validateAndMigrate(parsed);
      this.schemaTooNew = false;
      this.schemaTooNewError = null;
      if (raw !== this.lastRepairedSerialized) {
        this.loadRecoveredFromCorruption = false;
        this.loadRecoveryInfo = null;
        this.lastRepairedSerialized = null;
      }
      return validated;
    } catch (err) {
      if (isSchemaTooNewError(err)) {
        // Never overwrite or strip newer-schema localStorage documents (#37)
        this.schemaTooNew = true;
        this.schemaTooNewError = err;
        this.lastRepairedSerialized = null;
        return createInitialState();
      }

      this.schemaTooNew = false;
      this.schemaTooNewError = null;
      const backupKey = this.backupCorruptPayload(raw);
      const salvagedResult = parsed ? salvageTrackerState(parsed) : null;
      const recovered = salvagedResult ? salvagedResult.state : createInitialState();
      this.saveLocalOnly(recovered);
      this.lastRepairedSerialized = JSON.stringify(recovered);
      this.loadRecoveredFromCorruption = true;
      this.loadRecoveryInfo = {
        backupKey,
        raw,
        salvaged: Boolean(salvagedResult),
        droppedCount: salvagedResult ? salvagedResult.droppedCount : 0,
      };
      return recovered;
    }
  }

  saveLocalOnly(state) {
    if (this.schemaTooNew) {
      return;
    }
    this.lastRepairedSerialized = null;
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
    if (this.schemaTooNew) {
      throw (
        this.schemaTooNewError ||
        new SchemaTooNewError(CURRENT_SCHEMA_VERSION + 1, CURRENT_SCHEMA_VERSION)
      );
    }
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
