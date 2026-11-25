import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_GRADE_SCALE } from '../../src/domain/constants.js';
import { createInitialState, createNewTerm } from '../../src/domain/templates.js';
import { calculateAllStats, formatGpa, formatPercent } from '../../src/domain/calculations.js';
import {
  encodeShareSnapshot,
  decodeShareSnapshot,
  extractShareTokenFromUrl,
  buildShareUrl,
  clearShareParamsFromCurrentUrl,
} from '../../src/services/share.js';

function jsonToU1Token(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `u1.${b64}`;
}

describe('Share Snapshot Codec & URL Helpers (share.js)', () => {
  let unhandledRejections = [];
  const rejectionHandler = (reason) => {
    unhandledRejections.push(reason);
  };

  beforeEach(() => {
    unhandledRejections = [];
    process.on('unhandledRejection', rejectionHandler);
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off('unhandledRejection', rejectionHandler);
    expect(unhandledRejections).toEqual([]);
  });

  it('round-trips initial state via compressed z1. token with 100% data and GPA parity (omitting default gradeScale)', async () => {
    const initial = createInitialState();
    initial.studentName = 'Alex';
    const token = await encodeShareSnapshot(initial);

    expect(token.startsWith('z1.')).toBe(true);
    expect(token.length).toBeLessThan(1200);

    const decoded = await decodeShareSnapshot(token);
    expect(decoded).not.toBeNull();
    expect(decoded.studentName).toBe('Alex');
    expect(decoded.gradeScale).toEqual(DEFAULT_GRADE_SCALE);
    expect(decoded.terms).toHaveLength(1);
    expect(decoded.terms[0].name).toBe('Fall Term');
    expect(decoded.terms[0].courses).toHaveLength(3);
    expect(decoded.terms[0].courses[1].duration).toBe('full-year');

    const origStats = calculateAllStats(initial);
    const decodedStats = calculateAllStats(decoded);
    expect(formatGpa(decodedStats.overall.cumulativeGpa, 2)).toBe(
      formatGpa(origStats.overall.cumulativeGpa, 2),
    );
    expect(formatPercent(decodedStats.overall.weightedAverage, 2)).toBe(
      formatPercent(origStats.overall.weightedAverage, 2),
    );
  });

  it('works identically when Blob.prototype.stream is present (real browser path) and absent (jsdom)', async () => {
    const originalStream = Blob.prototype.stream;
    Blob.prototype.stream = function polyfillStream() {
      return new ReadableStream({
        start: async (controller) => {
          const buf = await this.arrayBuffer();
          controller.enqueue(new Uint8Array(buf));
          controller.close();
        },
      });
    };

    try {
      const state = createInitialState();
      state.studentName = 'Taylor';
      const token = await encodeShareSnapshot(state);
      expect(token.startsWith('z1.')).toBe(true);
      const decoded = await decodeShareSnapshot(token);
      expect(decoded?.studentName).toBe('Taylor');
      expect(await decodeShareSnapshot('z1.AAAA')).toBeNull();
    } finally {
      if (originalStream === undefined) {
        delete Blob.prototype.stream;
      } else {
        Blob.prototype.stream = originalStream;
      }
    }
  });

  it('preserves multi-term activeTermId index, passFail, duration, and custom gradeScale across round-trips', async () => {
    const state = createInitialState();
    const term2 = createNewTerm(1);
    const term3 = createNewTerm(2);
    state.terms.push(term2, term3);
    state.activeTermId = term2.id;
    state.terms[0].courses[0].passFail = true;
    state.terms[0].courses[1].duration = 'full-year';
    state.gradeScale = [
      { min: 93, max: 100, letter: 'A', gpa: 4.0 },
      { min: 80, max: 92, letter: 'B', gpa: 3.0 },
      { min: 70, max: 79, letter: 'C', gpa: 2.0 },
      { min: 60, max: 69, letter: 'D', gpa: 1.0 },
      { min: 0, max: 59, letter: 'F', gpa: 0.0 },
    ];

    const token = await encodeShareSnapshot(state);
    const decoded = await decodeShareSnapshot(token);

    expect(decoded.terms).toHaveLength(3);
    expect(decoded.activeTermId).toBe(decoded.terms[1].id);
    expect(decoded.terms[1].name).toBe('Term 2');
    expect(decoded.terms[0].courses[0].passFail).toBe(true);
    expect(decoded.terms[0].courses[1].duration).toBe('full-year');
    expect(decoded.terms[0].courses[2].duration).toBe('term');
    expect(decoded.gradeScale).toHaveLength(5);
    expect(decoded.gradeScale[1]).toMatchObject({
      min: 80,
      max: 92,
      letter: 'B',
      gpa: 3.0,
      tier: 'tier-b',
      rangeLabel: '80–92%',
      boundLabel: '92%',
    });
  });

  it('maintains backward compatibility for legacy "cr" field and omitted/out-of-range "a"', async () => {
    const basePayload = {
      n: 'Jordan',
      u: '2026-11-13T09:09:00.000Z',
      t: [
        { n: 'Term 1', c: [{ c: 'ECON101', t: 'Micro', u: 0.5, cr: 1, tg: 80, k: [['Quiz', 100, 90]] }] },
        { n: 'Term 2', c: [{ c: 'ECON200', t: 'Micro II', u: 0.5, cr: 0, tg: 85, k: [['Exam', 100, null]] }] },
      ],
    };

    const decodedNoA = await decodeShareSnapshot(jsonToU1Token(basePayload));
    expect(decodedNoA.activeTermId).toBe(decodedNoA.terms[0].id);
    expect(decodedNoA.terms[0].courses[0].passFail).toBe(true);
    expect(decodedNoA.terms[1].courses[0].passFail).toBe(false);
    expect(decodedNoA.terms[0].courses[0].duration).toBe('term');

    const decodedOutOfBounds = await decodeShareSnapshot(jsonToU1Token({ ...basePayload, a: 99 }));
    expect(decodedOutOfBounds.activeTermId).toBe(decodedOutOfBounds.terms[0].id);

    const decodedNegative = await decodeShareSnapshot(jsonToU1Token({ ...basePayload, a: -1 }));
    expect(decodedNegative.activeTermId).toBe(decodedNegative.terms[0].id);
  });

  it('omits gs from compact token when using DEFAULT_GRADE_SCALE', async () => {
    const origCS = globalThis.CompressionStream;
    try {
      globalThis.CompressionStream = undefined;
      const defaultState = createInitialState();
      const u1Token = await encodeShareSnapshot(defaultState);
      const rawJson = JSON.parse(
        atob(u1Token.slice(3).replace(/-/g, '+').replace(/_/g, '/')),
      );
      expect(rawJson.gs).toBeUndefined();
      expect(rawJson.t[0].c[0].d).toBeUndefined();
      expect(rawJson.t[0].c[1].d).toBe('fy');
    } finally {
      globalThis.CompressionStream = origCS;
    }
  });

  it('falls back to u1. when CompressionStream is unavailable and returns null if DecompressionStream is missing on z1.', async () => {
    const origCS = globalThis.CompressionStream;
    const origDS = globalThis.DecompressionStream;

    try {
      const state = createInitialState();
      state.studentName = 'Morgan';
      const validZ1 = await encodeShareSnapshot(state);
      expect(validZ1.startsWith('z1.')).toBe(true);

      globalThis.CompressionStream = undefined;
      const u1Token = await encodeShareSnapshot(state);
      expect(u1Token.startsWith('u1.')).toBe(true);
      const fromU1 = await decodeShareSnapshot(u1Token);
      expect(fromU1?.studentName).toBe('Morgan');

      globalThis.DecompressionStream = undefined;
      expect(await decodeShareSnapshot(validZ1)).toBeNull();
    } finally {
      globalThis.CompressionStream = origCS;
      globalThis.DecompressionStream = origDS;
    }
  });

  it('handles large >70KB multi-term payloads via chunked base64url without call-stack overflow', async () => {
    const largeState = createInitialState();
    largeState.terms = Array.from({ length: 8 }, (_, tIdx) => ({
      id: `t-${tIdx}`,
      name: `Term ${tIdx + 1} · Academic Ledger — Extended Description`,
      courses: Array.from({ length: 10 }, (__, cIdx) => ({
        id: `c-${tIdx}-${cIdx}`,
        code: `MGT${100 + tIdx * 10 + cIdx}`,
        title: `Advanced Quantitative Seminar ${tIdx + 1}.${cIdx + 1} — Research Methods`,
        units: 0.5,
        duration: 'term',
        passFail: false,
        collapsed: false,
        targetPct: 85,
        categories: Array.from({ length: 12 }, (___, kIdx) => ({
          id: `k-${tIdx}-${cIdx}-${kIdx}`,
          name: `Assessment Component #${kIdx + 1} (Case Study & Presentation)`,
          weight: kIdx < 11 ? 8 : 12,
          grade: kIdx % 2 === 0 ? 87.5 : null,
        })),
      })),
    }));
    largeState.activeTermId = 't-5';

    const rawJsonSize = JSON.stringify(largeState).length;
    expect(rawJsonSize).toBeGreaterThan(70_000);

    const token = await encodeShareSnapshot(largeState);
    const decoded = await decodeShareSnapshot(token);
    expect(decoded).not.toBeNull();
    expect(decoded.terms).toHaveLength(8);
    expect(decoded.activeTermId).toBe(decoded.terms[5].id);
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['null', null],
    ['undefined', undefined],
    ['number', 123],
    ['unknown prefix', 'bad-prefix.abc'],
    ['bare z1.', 'z1.'],
    ['bare u1.', 'u1.'],
    ['invalid base64 chars z1.', 'z1.!!!'],
    ['mod-4 invalid length z1.', 'z1.abcde'],
    ['truncated deflate stream z1.AAAA', 'z1.AAAA'],
    ['random garbage deflate bytes', 'z1.AQIDBAUGBwgJCgsM'],
    ['non-JSON u1. payload', 'u1.bm90LWpzb24'],
    ['JSON null root', jsonToU1Token(null)],
    ['JSON array root', jsonToU1Token([])],
    ['empty object', jsonToU1Token({})],
    ['non-array terms', jsonToU1Token({ t: 'bad' })],
    ['null term item', jsonToU1Token({ t: [null] })],
    ['non-array courses', jsonToU1Token({ t: [{ n: 'T', c: 'bad' }] })],
    ['negative course units', jsonToU1Token({ t: [{ n: 'T', c: [{ c: 'ECO101', u: -1, k: [] }] }] })],
    ['oversize course units (1e308)', jsonToU1Token({ t: [{ n: 'T', c: [{ c: 'ECO101', u: 1e308, k: [] }] }] })],
    ['oversize category weight (1e308)', jsonToU1Token({ t: [{ n: 'T', c: [{ c: 'ECO101', u: 0.5, k: [['Q', 1e308, 90]] }] }] })],
    ['oversize category grade (1e308)', jsonToU1Token({ t: [{ n: 'T', c: [{ c: 'ECO101', u: 0.5, k: [['Q', 100, 1e308]] }] }] })],
    ['invalid custom gradeScale', jsonToU1Token({ gs: 'bad', t: [{ n: 'T', c: [{ c: 'ECO101', u: 0.5, k: [] }] }] })],
    ['Infinity category weight (1e500)', 'u1.' + btoa('{"t":[{"n":"T","c":[{"c":"ECO101","u":0.5,"k":[["Q",1e500,90]]}]}]}').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')],
  ])('safely resolves %s to null with zero exceptions or unhandled rejections', async (_label, badToken) => {
    const result = await decodeShareSnapshot(badToken);
    expect(result).toBeNull();
  });

  it('canonicalizes -0 weights and grades to +0 when decoding share snapshots', async () => {
    const rawJsonWithNegZero = '{"t":[{"n":"Term 1","c":[{"c":"ECO101","u":0.5,"k":[["Quiz",-0,-0]]}]}]}';
    const rawU1 = `u1.${btoa(rawJsonWithNegZero).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    const decoded = await decodeShareSnapshot(rawU1);
    expect(decoded).not.toBeNull();
    const cat = decoded.terms[0].courses[0].categories[0];
    expect(Object.is(cat.weight, 0)).toBe(true);
    expect(Object.is(cat.grade, 0)).toBe(true);
  });

  it('aborts decompression bombs (>512KB) and oversize tokens (>256KB) cleanly to null', async () => {
    const bombPlain = new Uint8Array(2 * 1024 * 1024);
    const csStream = new ReadableStream({
      start(c) {
        c.enqueue(bombPlain);
        c.close();
      },
    }).pipeThrough(new CompressionStream('deflate-raw'));
    const reader = csStream.getReader();
    const parts = [];
    let len = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      len += value.byteLength;
    }
    const compressedBomb = new Uint8Array(len);
    let offset = 0;
    for (const p of parts) {
      compressedBomb.set(p, offset);
      offset += p.byteLength;
    }
    let bin = '';
    for (let i = 0; i < compressedBomb.length; i += 1) {
      bin += String.fromCharCode(compressedBomb[i]);
    }
    const bombToken = `z1.${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    expect(bombToken.length).toBeLessThan(10_000);

    expect(await decodeShareSnapshot(bombToken)).toBeNull();

    const hugeToken = `u1.${'A'.repeat(300_000)}`;
    expect(await decodeShareSnapshot(hugeToken)).toBeNull();
  });

  it('extracts share tokens from #share= and ?share= URLs safely', () => {
    expect(extractShareTokenFromUrl({ hash: '#share=z1.abc_123-XYZ', search: '' })).toBe('z1.abc_123-XYZ');
    expect(extractShareTokenFromUrl({ hash: '', search: '?share=z1.query_tok' })).toBe('z1.query_tok');
    expect(extractShareTokenFromUrl({ hash: '#foo=1&share=z1.hash_tok', search: '' })).toBe('z1.hash_tok');
    expect(extractShareTokenFromUrl({ hash: '#share=z1.hash_wins', search: '?share=u1.query' })).toBe('z1.hash_wins');
    expect(extractShareTokenFromUrl({ hash: '#share=', search: '' })).toBeNull();
    expect(extractShareTokenFromUrl({ hash: '#section', search: '?other=1' })).toBeNull();
    expect(() => extractShareTokenFromUrl({ hash: '#share=%E0%A4%A', search: '' })).not.toThrow();
    expect(extractShareTokenFromUrl(null)).toBeNull();
    expect(extractShareTokenFromUrl(undefined)).toBeNull();
  });

  it('builds clean <origin><pathname>#share=<token> URLs at root, /grade-tracker/, file://, and malformed hrefs', () => {
    expect(buildShareUrl('http://127.0.0.1:4173/', 'z1.tok_1')).toBe(
      'http://127.0.0.1:4173/#share=z1.tok_1',
    );
    expect(buildShareUrl('https://example.github.io/grade-tracker/', 'z1.tok_2')).toBe(
      'https://example.github.io/grade-tracker/#share=z1.tok_2',
    );
    expect(
      buildShareUrl('http://127.0.0.1:4173/grade-tracker/?share=old&x=1#share=older', 'z1.tok_3'),
    ).toBe('http://127.0.0.1:4173/grade-tracker/#share=z1.tok_3');
    expect(buildShareUrl('file:///home/student/dist/index.html', 'z1.abc')).toBe(
      'file:///home/student/dist/index.html#share=z1.abc',
    );
    expect(buildShareUrl('file:///home/student/dist/index.html?share=old#older', 'z1.abc')).toBe(
      'file:///home/student/dist/index.html#share=z1.abc',
    );
    expect(buildShareUrl('http://[::1', 'z1.abc')).toBe('http://localhost/#share=z1.abc');
  });

  it('strips #share and ?share parameters cleanly via clearShareParamsFromCurrentUrl', () => {
    const calls = [];
    const makeMockWin = (href) => ({
      location: { href },
      history: {
        state: { idx: 1 },
        replaceState(st, title, url) {
          calls.push({ st, title, url });
        },
      },
    });

    clearShareParamsFromCurrentUrl(makeMockWin('http://localhost:4173/grade-tracker/#share=z1.abc'));
    clearShareParamsFromCurrentUrl(makeMockWin('http://localhost:4173/grade-tracker/?share=z1.abc'));
    clearShareParamsFromCurrentUrl(
      makeMockWin('http://localhost:4173/grade-tracker/?keep=1&share=z1.abc#share=z1.xyz'),
    );
    clearShareParamsFromCurrentUrl(null);

    expect(calls.map((c) => c.url)).toEqual([
      '/grade-tracker/',
      '/grade-tracker/',
      '/grade-tracker/?keep=1',
    ]);
  });
});
