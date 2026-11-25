import { describe, it, expect, vi } from 'vitest';
import { STORAGE_KEY, DEFAULT_GRADE_SCALE } from '../../src/domain/constants.js';
import { createInitialState } from '../../src/domain/templates.js';
import {
  StorageService,
  storageService,
  registerCloudAdapter,
  createMemoryStorage,
  validateTrackerState,
} from '../../src/services/storage.js';
import {
  serializeStateToJson,
  parseImportedJson,
  serializeStateToCsv,
  buildExportFilename,
  exportStateAsJson,
  exportStateAsCsv,
} from '../../src/services/exporters.js';

/**
 * Minimal RFC-4180 parser to verify exported CSV rows & columns accurately.
 */
function parseRfc4180Csv(csvWithBom) {
  expect(csvWithBom.startsWith('\uFEFF')).toBe(true);
  const text = csvWithBom.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

describe('StorageService & CloudSyncAdapter (storage.js)', () => {
  it('seeds generic initial state on empty storage with Fall Term and 3 sample courses', () => {
    const mem = createMemoryStorage();
    const svc = new StorageService({ storage: mem });

    const loaded = svc.load();
    expect(loaded.studentName).toBe('My');
    expect(loaded.gradeScale).toEqual(DEFAULT_GRADE_SCALE);
    expect(loaded.terms).toHaveLength(1);
    expect(loaded.terms[0].name).toBe('Fall Term');
    expect(loaded.terms[0].courses.map((c) => c.code)).toEqual(['ECON101', 'MATH101', 'CS101']);

    const rawStored = JSON.parse(mem.getItem(STORAGE_KEY));
    expect(rawStored.studentName).toBe('My');
    expect(rawStored.terms[0].courses).toHaveLength(3);
  });

  it('saves immutably without mutating caller state and respects touchTimestamp option', () => {
    const mem = createMemoryStorage();
    const svc = new StorageService({ storage: mem });
    const prevState = createInitialState();
    prevState.lastUpdated = '2026-11-13T09:09:00.000Z';

    const savedWithTouch = svc.save(prevState, { touchTimestamp: true });
    expect(savedWithTouch).not.toBe(prevState);
    expect(prevState.lastUpdated).toBe('2026-11-13T09:09:00.000Z');
    expect(savedWithTouch.lastUpdated).not.toBe('2026-11-13T09:09:00.000Z');

    const savedWithoutTouch = svc.save(prevState, { touchTimestamp: false });
    expect(savedWithoutTouch.lastUpdated).toBe('2026-11-13T09:09:00.000Z');
    expect(svc.load().lastUpdated).toBe('2026-11-13T09:09:00.000Z');
  });

  it('handles missing localStorage, QuotaExceededError on setItem, and SecurityError on getItem gracefully', () => {
    const memFallbackSvc = new StorageService({ storage: null });
    const saved = memFallbackSvc.save(createInitialState(), { touchTimestamp: false });
    expect(memFallbackSvc.load().studentName).toBe(saved.studentName);

    const throwingStorage = {
      getItem() {
        throw new Error('SecurityError: blocked');
      },
      setItem() {
        throw new Error('QuotaExceededError: full');
      },
    };
    const resilientSvc = new StorageService({ storage: throwingStorage });
    const cloudSave = vi.fn().mockResolvedValue(undefined);
    resilientSvc.registerCloudAdapter({ save: cloudSave });

    expect(resilientSvc.load().terms[0].name).toBe('Fall Term');
    const next = resilientSvc.save(createInitialState(), { touchTimestamp: true });
    expect(next.studentName).toBe('My');
  });

  it('throws on malformed schemas in validateAndMigrate while self-healing cleanly in load()', () => {
    const mem = createMemoryStorage();
    const svc = new StorageService({ storage: mem });

    const corruptPayloads = [
      'not-json',
      '{}',
      '{"terms":[]}',
      '{"terms":[{"id":"t1","name":"Y1","courses":"not-array"}]}',
      '{"terms":[{"id":"t1","name":"Y1","courses":[{"code":"ECO101","units":0.5,"categories":"bad"}]}]}',
    ];

    for (const raw of corruptPayloads) {
      if (raw !== 'not-json') {
        expect(() => svc.validateAndMigrate(JSON.parse(raw))).toThrow(/Invalid tracker state/i);
      }
      mem.setItem(STORAGE_KEY, raw);
      const healed = svc.load();
      expect(healed.studentName).toBe('My');
      expect(healed.terms[0].name).toBe('Fall Term');
    }
  });

  it('migrates partial legacy objects (creditNoCredit -> passFail), normalizes duration/collapsed/gradeScale, and permits empty arrays', () => {
    const svc = new StorageService({ storage: createMemoryStorage() });
    const migrated = svc.validateAndMigrate({
      activeTermId: 'deleted-term-id',
      gradeScale: [
        { min: 0, max: 59, letter: 'F', gpa: 0.0 },
        { min: 60, max: 100, letter: 'P', gpa: 4.0 },
      ],
      terms: [
        {
          name: 'Term 1',
          courses: [
            {
              code: 'CSC108',
              units: 0.5,
              creditNoCredit: true,
              duration: 'full-year',
              collapsed: 1,
              categories: [{ name: 'Assignment 1', weight: 100, grade: 92 }],
            },
            {
              code: 'MAT102',
              units: 0.5,
              categories: [],
            },
          ],
        },
        {
          id: 't-empty',
          name: 'Term 2',
          courses: [],
        },
      ],
    });

    expect(migrated.studentName).toBe('My');
    expect(migrated).not.toHaveProperty('institution');
    expect(migrated.activeTermId).toBe(migrated.terms[0].id);
    expect(migrated.gradeScale).toEqual([
      { min: 60, max: 100, rangeLabel: '60–100%', boundLabel: '100%', letter: 'P', gpa: 4.0, tier: 'tier-a' },
      { min: 0, max: 59, rangeLabel: '0–59%', boundLabel: '59%', letter: 'F', gpa: 0.0, tier: 'tier-f' },
    ]);
    expect(migrated.terms[0].courses[0]).toMatchObject({
      passFail: true,
      duration: 'full-year',
      collapsed: true,
      targetPct: 85,
    });
    expect(migrated.terms[0].courses[0]).not.toHaveProperty('creditNoCredit');
    expect(migrated.terms[0].courses[1]).toMatchObject({
      passFail: false,
      duration: 'term',
      collapsed: false,
    });
    expect(migrated.terms[0].courses[0].categories[0].id).toBeTruthy();
    expect(migrated.terms[1].courses).toEqual([]);
  });

  it('supports subscribe() and registerCloudAdapter() lifecycle including sync/async error isolation', async () => {
    const mem = createMemoryStorage();
    const svc = new StorageService({ storage: mem });
    const listener = vi.fn();
    const unsubLocal = svc.subscribe(listener);

    let pushRemote = null;
    const unsubRemoteSpy = vi.fn();
    const cloudSave = vi.fn().mockResolvedValue(undefined);

    const detachCloud = svc.registerCloudAdapter({
      save: cloudSave,
      subscribe(cb) {
        pushRemote = cb;
        return unsubRemoteSpy;
      },
    });

    const saved = svc.save(createInitialState(), { touchTimestamp: true });
    await Promise.resolve();
    expect(cloudSave).toHaveBeenCalledWith(saved);
    expect(listener).toHaveBeenCalledWith(saved);

    const remoteState = createInitialState();
    remoteState.studentName = 'Alex Cloud';
    pushRemote(remoteState);
    expect(svc.load().studentName).toBe('Alex Cloud');
    expect(listener).toHaveBeenCalledTimes(2);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pushRemote({ terms: 'invalid' });
    expect(svc.load().studentName).toBe('Alex Cloud');

    svc.registerCloudAdapter({
      save() {
        throw new Error('Sync adapter failure');
      },
    });
    expect(unsubRemoteSpy).toHaveBeenCalledTimes(1);
    expect(() => svc.save(remoteState)).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));

    detachCloud();
    unsubLocal();
    warnSpy.mockRestore();

    const detachSingleton = registerCloudAdapter({ save: vi.fn() });
    expect(typeof detachSingleton).toBe('function');
    expect(storageService.cloudAdapter).not.toBeNull();
    detachSingleton();
    expect(storageService.cloudAdapter).toBeNull();
  });

  it('isolates async cloudAdapter.save() and subscribers from post-save or in-subscriber mutations', async () => {
    const svc = new StorageService({ storage: createMemoryStorage() });
    let cloudSavedSnapshot = null;
    let secondSubscriberName = null;

    svc.registerCloudAdapter({
      save(st) {
        cloudSavedSnapshot = st;
      },
    });

    svc.subscribe((st) => {
      st.studentName = 'MUTATED_BY_SUBSCRIBER_1';
      st.terms[0].courses.push({ code: 'FAKE' });
    });

    svc.subscribe((st) => {
      secondSubscriberName = st.studentName;
    });

    const returned = svc.save({
      studentName: 'OriginalStudent',
      terms: [{ name: 'T1', courses: [] }],
    });

    returned.studentName = 'MUTATED_AFTER_SAVE';
    returned.terms[0].courses.push({ code: 'MUTATED_COURSE' });

    await Promise.resolve();

    expect(secondSubscriberName).toBe('OriginalStudent');
    expect(cloudSavedSnapshot.studentName).toBe('OriginalStudent');
    expect(cloudSavedSnapshot.terms[0].courses).toEqual([]);
    expect(svc.load().studentName).toBe('OriginalStudent');
    expect(svc.load().terms[0].courses).toEqual([]);
  });

  it('canonicalizes -0 weights and grades to +0 in validateTrackerState and parseImportedJson', () => {
    const validated = validateTrackerState({
      terms: [
        {
          name: 'T1',
          courses: [
            {
              code: 'ECON101',
              units: 0.5,
              categories: [{ name: 'Q', weight: -0, grade: -0 }],
            },
          ],
        },
      ],
    });
    const cat = validated.terms[0].courses[0].categories[0];
    expect(Object.is(cat.weight, 0)).toBe(true);
    expect(Object.is(cat.grade, 0)).toBe(true);

    const imported = parseImportedJson(
      '{"terms":[{"name":"T1","courses":[{"code":"ECON101","units":0.5,"categories":[{"name":"Q","weight":-0,"grade":-0}]}]}]}',
    );
    const importedCat = imported.terms[0].courses[0].categories[0];
    expect(Object.is(importedCat.weight, 0)).toBe(true);
    expect(Object.is(importedCat.grade, 0)).toBe(true);
  });
});

describe('JSON & CSV Exporters (exporters.js)', () => {
  it('round-trips JSON export/import including UTF-8 BOM-prefixed JSON files and legacy creditNoCredit migration', () => {
    const initial = createInitialState();
    const json = serializeStateToJson(initial);
    expect(parseImportedJson(json)).toEqual(initial);
    expect(parseImportedJson(`\uFEFF${json}`)).toEqual(initial);

    const legacyJson = JSON.stringify({
      studentName: 'Jordan',
      terms: [
        {
          name: 'Fall',
          courses: [
            {
              code: 'BIO101',
              units: 0.5,
              creditNoCredit: true,
              categories: [{ name: 'Lab', weight: 100, grade: 88 }],
            },
          ],
        },
      ],
    });
    const migrated = parseImportedJson(legacyJson);
    expect(migrated.terms[0].courses[0].passFail).toBe(true);
    expect(migrated.terms[0].courses[0]).not.toHaveProperty('creditNoCredit');
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['syntax error', '{bad json'],
    ['null root', 'null'],
    ['array root', '[]'],
    ['empty object', '{}'],
    ['empty terms', '{"terms":[]}'],
    ['non-array courses', '{"terms":[{"id":"t1","name":"Y1","courses":{}}]}'],
    ['missing course code', '{"terms":[{"id":"t1","name":"Y1","courses":[{"code":"  ","units":0.5,"categories":[]}]}]}'],
    ['negative units', '{"terms":[{"id":"t1","name":"Y1","courses":[{"code":"ECO101","units":-0.5,"categories":[]}]}]}'],
    ['oversize units (1e308)', '{"terms":[{"id":"t1","name":"Y1","courses":[{"code":"ECO101","units":1e308,"categories":[]}]}]}'],
    ['units > 100', '{"terms":[{"id":"t1","name":"Y1","courses":[{"code":"ECO101","units":101,"categories":[]}]}]}'],
    ['non-array categories', '{"terms":[{"id":"t1","name":"Y1","courses":[{"code":"ECO101","units":0.5,"categories":null}]}]}'],
    ['negative weight', '{"terms":[{"id":"t1","name":"Y1","courses":[{"code":"ECO101","units":0.5,"categories":[{"name":"Q","weight":-5,"grade":80}]}]}]}'],
    ['oversize weight (1e308)', '{"terms":[{"id":"t1","name":"Y1","courses":[{"code":"ECO101","units":0.5,"categories":[{"name":"Exam","weight":1e308,"grade":90}]}]}]}'],
    ['weight > 1000', '{"terms":[{"id":"t1","name":"Y1","courses":[{"code":"ECO101","units":0.5,"categories":[{"name":"Exam","weight":1001,"grade":90}]}]}]}'],
    ['string grade', '{"terms":[{"id":"t1","name":"Y1","courses":[{"code":"ECO101","units":0.5,"categories":[{"name":"Q","weight":10,"grade":"90"}]}]}]}'],
    ['oversize grade (1e308)', '{"terms":[{"id":"t1","name":"Y1","courses":[{"code":"ECO101","units":0.5,"categories":[{"name":"Exam","weight":100,"grade":1e308}]}]}]}'],
    ['grade > 1000', '{"terms":[{"id":"t1","name":"Y1","courses":[{"code":"ECO101","units":0.5,"categories":[{"name":"Exam","weight":100,"grade":1001}]}]}]}'],
    ['Infinity grade', '{"terms":[{"id":"t1","name":"Y1","courses":[{"code":"ECO101","units":0.5,"categories":[{"name":"Q","weight":10,"grade":1e500}]}]}]}'],
  ])('parseImportedJson throws descriptive Error on %s', (_label, payload) => {
    expect(() => parseImportedJson(payload)).toThrow(/Invalid/i);
  });

  it('serializes tracker state to UTF-8 BOM CRLF CSV with uniform 9-column RFC-4180 rows and custom gradeScale', () => {
    const state = createInitialState();
    state.gradeScale = [
      { min: 95, max: 100, letter: 'A+', gpa: 4.0 },
      { min: 80, max: 94, letter: 'A', gpa: 3.9 },
      { min: 0, max: 79, letter: 'B', gpa: 3.0 },
    ];
    const csv = serializeStateToCsv(state);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.includes('\r\n')).toBe(true);

    const rows = parseRfc4180Csv(csv);
    expect(rows[0]).toEqual([
      'Term',
      'Units',
      'Course',
      'Category',
      'Weight (%)',
      'Grade (%)',
      'Overall Grade',
      'Grade Point',
      'Letter',
    ]);

    for (const row of rows) {
      expect(row).toHaveLength(9);
    }

    // ECON101: (10*90 + 25*78 + 25*88) / 60 = 84.1666...% -> custom scale 'A' (3.9)
    expect(rows[1]).toEqual([
      'Fall Term',
      '0.5',
      'ECON101',
      '',
      '',
      '',
      '84.17%',
      '3.9',
      'A',
    ]);
    expect(rows[3]).toEqual(['', '', '', 'Midterm 1', '25.00%', '78.00%', '', '', '']);
    expect(rows[5]).toEqual(['', '', '', 'Final Exam', '40.00%', '', '', '', '']);
  });

  it('escapes commas, double quotes, LF, and CR per RFC-4180 and formats Pass/Fail & ungraded courses', () => {
    const specialState = {
      version: 1,
      studentName: 'Alex',
      lastUpdated: '2026-11-13T09:09:00.000Z',
      activeTermId: 't1',
      terms: [
        {
          id: 't1',
          name: 'Fall, 2026',
          courses: [
            {
              id: 'c1',
              code: 'ENG100',
              title: 'Writing',
              units: 0.5,
              passFail: true,
              targetPct: 85,
              categories: [
                { id: 'k1', name: 'Essays, "Alpha"', weight: 50, grade: 80 },
                { id: 'k2', name: 'Part 1\nPart 2\rEnd', weight: 50, grade: null },
              ],
            },
            {
              id: 'c2',
              code: 'PHL101',
              title: 'Philosophy',
              units: 0.5,
              passFail: false,
              targetPct: 85,
              categories: [{ id: 'k3', name: 'Final', weight: 100, grade: null }],
            },
          ],
        },
      ],
    };

    const csv = serializeStateToCsv(specialState);
    expect(csv).toContain('"Fall, 2026"');
    expect(csv).toContain('"Essays, ""Alpha"""');
    expect(csv).toContain('"Part 1\nPart 2\rEnd"');

    const rows = parseRfc4180Csv(csv);
    const engRow = rows.find((r) => r[2] === 'ENG100');
    expect(engRow).toEqual(['Fall, 2026', '0.5', 'ENG100', '', '', '', '80.00%', '', 'P']);

    const phlRow = rows.find((r) => r[2] === 'PHL101');
    expect(phlRow).toEqual(['Fall, 2026', '0.5', 'PHL101', '', '', '', '—', '', '—']);
  });

  it('triggers browser downloads with clean slugified filenames and handles missing URL.createObjectURL', () => {
    const fixedDate = new Date('2026-11-25T12:00:00.000Z');
    expect(buildExportFilename('Alex', 'grade-tracker', fixedDate)).toBe(
      'alex-grade-tracker-2026-11-25',
    );
    expect(buildExportFilename('Alex!', 'grades', fixedDate)).toBe('alex-grades-2026-11-25');
    expect(buildExportFilename('   ', 'grade-tracker', fixedDate)).toBe(
      'my-grades-grade-tracker-2026-11-25',
    );

    const clickedDownloads = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function recordClick() {
        clickedDownloads.push({ download: this.download, href: this.href });
      });

    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;

    try {
      URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      URL.revokeObjectURL = vi.fn();

      const state = createInitialState();
      state.studentName = 'Alex';
      exportStateAsJson(state);
      exportStateAsCsv(state);

      expect(clickedDownloads).toHaveLength(2);
      expect(clickedDownloads[0].download).toMatch(/^alex-grade-tracker-\d{4}-\d{2}-\d{2}\.json$/);
      expect(clickedDownloads[1].download).toMatch(/^alex-grades-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2);

      URL.createObjectURL = undefined;
      expect(() => exportStateAsJson({ ...state, studentName: 'Alex!' })).not.toThrow();
      expect(clickedDownloads[2].href.startsWith('data:application/json')).toBe(true);
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    }
  });
});
