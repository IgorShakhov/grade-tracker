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

describe('StorageService & CloudSyncAdapter (storage.js)', () => {
  it('seeds generic initial state on empty storage with Fall Term and 3 sample courses', () => {
    const mem = createMemoryStorage();
    const svc = new StorageService({ storage: mem });

    const loaded = svc.load();
    expect(loaded.studentName).toBe('My');
    expect(loaded.gradeScale).toEqual(DEFAULT_GRADE_SCALE);
    expect(loaded.terms).toHaveLength(1);
    expect(loaded.terms[0].name).toBe('Fall Term');
    expect(loaded.terms[0].courses.map((c) => c.code)).toEqual([
      'ECON101',
      'MATH101',
      'CS101',
    ]);

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
        expect(() => validateTrackerState(JSON.parse(raw))).toThrow(
          /Invalid tracker state/i,
        );
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
      {
        min: 60,
        max: 100,
        rangeLabel: '60–100%',
        boundLabel: '100%',
        letter: 'P',
        gpa: 4.0,
        tier: 'tier-a',
      },
      {
        min: 0,
        max: 59,
        rangeLabel: '0–59%',
        boundLabel: '59%',
        letter: 'F',
        gpa: 0.0,
        tier: 'tier-f',
      },
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

  it('backs up raw corrupt payloads to grade_tracker_v1_corrupt_<ts> (capped at 2) and salvages valid sibling courses (#36)', async () => {
    const { MAX_CORRUPT_BACKUPS } = await import('../../src/services/storage.js');
    const mem = createMemoryStorage();
    const svc = new StorageService({ storage: mem });

    const partialCorrupt = createInitialState();
    partialCorrupt.studentName = 'Alex Custom';
    // Corrupt course 0 (`units: 101` > 100), keep sibling courses MATH101 & CS101 valid
    partialCorrupt.terms[0].courses[0].units = 101;
    // Also corrupt one assessment row inside MATH101 (`weight: -5`) while keeping remaining rows valid
    partialCorrupt.terms[0].courses[1].categories.unshift({
      id: 'bad-cat',
      name: 'Invalid Row',
      weight: -5,
      grade: 80,
    });
    const rawCorruptJson = JSON.stringify(partialCorrupt);
    mem.setItem(STORAGE_KEY, rawCorruptJson);

    const loaded = svc.load();
    expect(loaded.studentName).toBe('Alex Custom');
    expect(loaded.terms[0].courses.map((c) => c.code)).toEqual(['MATH101', 'CS101']);
    expect(
      loaded.terms[0].courses[0].categories.some((cat) => cat.name === 'Invalid Row'),
    ).toBe(false);
    expect(loaded.terms[0].courses[0].categories.length).toBeGreaterThan(0);

    const notice = svc.getRecoveryNotice();
    expect(notice).toBeTruthy();
    expect(notice.salvaged).toBe(true);
    expect(notice.droppedCount).toBe(2);
    expect(notice.backupKey).toMatch(/^grade_tracker_v1_corrupt_\d+/);
    expect(mem.getItem(notice.backupKey)).toBe(rawCorruptJson);

    // Verify rolling backup cap (at most MAX_CORRUPT_BACKUPS = 2 kept) even under identical millisecond timestamps
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    try {
      for (let i = 0; i < 4; i += 1) {
        mem.setItem(STORAGE_KEY, `corrupt-payload-${i}`);
        svc.load();
      }
    } finally {
      nowSpy.mockRestore();
    }
    const backupKeys = [];
    for (let i = 0; i < mem.length; i += 1) {
      const k = mem.key(i);
      if (k && k.startsWith(`${STORAGE_KEY}_corrupt_`)) {
        backupKeys.push(k);
      }
    }
    expect(backupKeys.length).toBeLessThanOrEqual(MAX_CORRUPT_BACKUPS);
    const savedBackups = backupKeys.map((k) => mem.getItem(k));
    expect(savedBackups).toContain('corrupt-payload-2');
    expect(savedBackups).toContain('corrupt-payload-3');
  });

  it('throws SchemaTooNewError on future schema versions and refuses to overwrite newer local documents (#37)', async () => {
    const { SchemaTooNewError } = await import('../../src/services/storage.js');
    const futureDoc = {
      ...createInitialState(),
      version: 2,
      studentName: 'Future V2 User',
      futureSubItemsFeature: [{ dropLowest: 2 }],
    };

    expect(() => validateTrackerState(futureDoc)).toThrow(SchemaTooNewError);

    const mem = createMemoryStorage();
    const rawFuture = JSON.stringify(futureDoc);
    mem.setItem(STORAGE_KEY, rawFuture);

    const svc = new StorageService({ storage: mem });
    svc.load();
    expect(svc.schemaTooNew).toBe(true);
    // Must NEVER overwrite or strip the v2 document in localStorage!
    expect(mem.getItem(STORAGE_KEY)).toBe(rawFuture);
    expect(() => svc.save(createInitialState())).toThrow(SchemaTooNewError);
    expect(mem.getItem(STORAGE_KEY)).toBe(rawFuture);

    // Explicit resetClean() (e.g., Sign Out / Delete Cloud Data) unlocks schemaTooNew cleanly
    svc.resetClean();
    expect(svc.schemaTooNew).toBe(false);
    expect(() => svc.save(createInitialState())).not.toThrow();
  });
});
