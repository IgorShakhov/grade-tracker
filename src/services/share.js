import {
  DEFAULT_GRADE_SCALE,
  MAX_GPA_POINTS,
  MAX_SUB_ITEMS_PER_CATEGORY,
} from '../domain/constants.js';
import { validateTrackerState } from './storage.js';

const BASE64_CHUNK_SIZE = 0x8000;
const MAX_TOKEN_CHARS = 262_144;
const MAX_DECOMPRESSED_BYTES = 512 * 1024;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDefaultGradeScale(scale) {
  if (!Array.isArray(scale) || scale.length !== DEFAULT_GRADE_SCALE.length) {
    return false;
  }
  for (let i = 0; i < scale.length; i += 1) {
    const a = scale[i];
    const b = DEFAULT_GRADE_SCALE[i];
    if (
      !a ||
      a.min !== b.min ||
      a.max !== b.max ||
      a.letter !== b.letter ||
      a.gpa !== b.gpa
    ) {
      return false;
    }
  }
  return true;
}

function bytesToBase64Url(bytes) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const slice = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    chunks.push(String.fromCharCode.apply(null, slice));
  }
  const binary = chunks.join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(str, maxBytes = MAX_DECOMPRESSED_BYTES) {
  if (typeof str !== 'string' || str.length === 0 || str.length > MAX_TOKEN_CHARS) {
    throw new Error('Invalid base64url token length.');
  }
  if (!/^[A-Za-z0-9\-_]+={0,2}$/.test(str)) {
    throw new Error('Invalid base64url alphabet.');
  }
  const clean = str.replace(/=+$/, '');
  if (clean.length === 0 || clean.length % 4 === 1) {
    throw new Error('Malformed base64url length.');
  }

  const estimatedBytes = Math.floor((clean.length * 3) / 4);
  if (estimatedBytes > maxBytes) {
    throw new Error('Decoded payload exceeds maximum allowed size.');
  }

  const padLen = (4 - (clean.length % 4)) % 4;
  const padded = clean.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Uses Blob.prototype.stream() when available in browsers/Node, falling back cleanly
 * to ReadableStream in environments like jsdom@31 where Blob.prototype.stream is absent.
 */
function bytesToReadableStream(bytes) {
  if (typeof Blob !== 'undefined' && typeof Blob.prototype?.stream === 'function') {
    return new Blob([bytes]).stream();
  }
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readStreamBounded(stream, maxBytes = MAX_DECOMPRESSED_BYTES) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error('Stream exceeded maximum allowed byte size.');
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore lock release errors
    }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Compacts and compresses TrackerState into a URL-safe snapshot token ('z1.<base64url>'
 * via CompressionStream('deflate-raw'), or 'u1.<base64url>' fallback).
 */
export async function encodeShareSnapshot(state) {
  const valid = validateTrackerState(state);
  const foundIdx = valid.terms.findIndex((t) => t.id === valid.activeTermId);
  const activeIdx = foundIdx >= 0 ? foundIdx : 0;

  const compact = {
    n: valid.studentName,
    u: valid.lastUpdated,
    a: activeIdx,
    t: valid.terms.map((term) => ({
      n: term.name,
      c: term.courses.map((course) => {
        const entry = {
          c: course.code,
          t: course.title || '',
          u: course.units,
          pf: course.passFail ? 1 : 0,
          tg: course.targetPct ?? 85,
          k: course.categories.map((cat) =>
            Array.isArray(cat.items) && cat.items.length > 0
              ? [
                  cat.name,
                  cat.weight,
                  null,
                  cat.items.map((sub) => [sub.name, sub.grade]),
                  cat.dropLowest || 0,
                ]
              : [cat.name, cat.weight, cat.grade],
          ),
        };
        if (course.duration === 'full-year') {
          entry.d = 'fy';
        }
        return entry;
      }),
    })),
  };

  if (!isDefaultGradeScale(valid.gradeScale)) {
    compact.gs = valid.gradeScale.map((band) => [band.min, band.max, band.letter, band.gpa]);
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(compact));

  if (typeof CompressionStream === 'function') {
    try {
      const compressedStream = bytesToReadableStream(jsonBytes).pipeThrough(
        new CompressionStream('deflate-raw'),
      );
      const compressedBytes = await readStreamBounded(compressedStream, MAX_DECOMPRESSED_BYTES * 2);
      return `z1.${bytesToBase64Url(compressedBytes)}`;
    } catch {
      // Fall back to uncompressed 'u1.' if deflate-raw is unsupported in host runtime
    }
  }

  return `u1.${bytesToBase64Url(jsonBytes)}`;
}

/**
 * Decodes and deeply validates a 'z1.' or 'u1.' share token.
 * Guaranteed never to throw or trigger unhandled promise rejections on corrupt/truncated input.
 */
export async function decodeShareSnapshot(token) {
  try {
    if (typeof token !== 'string') return null;
    const trimmed = token.trim();
    if (!trimmed || trimmed.length > MAX_TOKEN_CHARS) return null;

    let jsonBytes;
    if (trimmed.startsWith('z1.')) {
      if (typeof DecompressionStream !== 'function') return null;
      const compressed = base64UrlToBytes(trimmed.slice(3), MAX_DECOMPRESSED_BYTES);
      if (compressed.byteLength === 0) return null;
      const decompressedStream = bytesToReadableStream(compressed).pipeThrough(
        new DecompressionStream('deflate-raw'),
      );
      jsonBytes = await readStreamBounded(decompressedStream, MAX_DECOMPRESSED_BYTES);
    } else if (trimmed.startsWith('u1.')) {
      jsonBytes = base64UrlToBytes(trimmed.slice(3), MAX_DECOMPRESSED_BYTES);
      if (jsonBytes.byteLength === 0) return null;
    } else {
      return null;
    }

    const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes);
    const compact = JSON.parse(jsonText);

    if (!isPlainObject(compact)) return null;
    if (compact.n !== undefined && typeof compact.n !== 'string') return null;
    if (compact.u !== undefined && typeof compact.u !== 'string') return null;
    if (!Array.isArray(compact.t) || compact.t.length === 0) return null;

    let decodedGradeScale;
    if (compact.gs !== undefined) {
      if (!Array.isArray(compact.gs) || compact.gs.length === 0) return null;
      decodedGradeScale = [];
      for (const row of compact.gs) {
        if (!Array.isArray(row) || row.length < 4) return null;
        const [min, max, letter, gpa] = row;
        if (
          typeof min !== 'number' || !Number.isFinite(min) || min < 0 || min > 100 ||
          typeof max !== 'number' || !Number.isFinite(max) || max < min || max > 100 ||
          typeof letter !== 'string' || letter.trim() === '' ||
          typeof gpa !== 'number' || !Number.isFinite(gpa) || gpa < 0 || gpa > MAX_GPA_POINTS
        ) {
          return null;
        }
        decodedGradeScale.push({
          min: min === 0 ? 0 : min,
          max: max === 0 ? 0 : max,
          letter: letter.trim(),
          gpa: gpa === 0 ? 0 : gpa,
        });
      }
    }

    const terms = [];
    for (let tIdx = 0; tIdx < compact.t.length; tIdx += 1) {
      const term = compact.t[tIdx];
      if (!isPlainObject(term)) return null;
      if (term.n !== undefined && typeof term.n !== 'string') return null;
      if (!Array.isArray(term.c)) return null;

      const courses = [];
      for (let cIdx = 0; cIdx < term.c.length; cIdx += 1) {
        const c = term.c[cIdx];
        if (!isPlainObject(c)) return null;
        if (typeof c.c !== 'string' || c.c.trim() === '') return null;
        if (c.t !== undefined && typeof c.t !== 'string') return null;
        if (typeof c.u !== 'number' || !Number.isFinite(c.u) || c.u < 0 || c.u > 100) return null;
        if (!Array.isArray(c.k)) return null;
        const unitsVal = c.u === 0 ? 0 : c.u;

        let targetPct = 85;
        if (c.tg !== undefined) {
          if (typeof c.tg !== 'number' || !Number.isFinite(c.tg) || c.tg <= 0 || c.tg > 100) {
            return null;
          }
          targetPct = c.tg === 0 ? 0 : c.tg;
        }

        const categories = [];
        for (let kIdx = 0; kIdx < c.k.length; kIdx += 1) {
          const tuple = c.k[kIdx];
          if (!Array.isArray(tuple) || tuple.length < 2) return null;
          const [catName, catWeight, catGrade, rawSubTuples, rawDropLowest] = tuple;
          if (typeof catName !== 'string') return null;
          if (
            typeof catWeight !== 'number' ||
            !Number.isFinite(catWeight) ||
            catWeight < 0 ||
            catWeight > 1000
          ) {
            return null;
          }
          const weightVal = catWeight === 0 ? 0 : catWeight;
          let gradeVal = null;
          if (catGrade !== null && catGrade !== undefined) {
            if (
              typeof catGrade !== 'number' ||
              !Number.isFinite(catGrade) ||
              catGrade < 0 ||
              catGrade > 1000
            ) {
              return null;
            }
            gradeVal = catGrade === 0 ? 0 : catGrade;
          }

          let decodedItems;
          let decodedDropLowest = 0;
          if (rawSubTuples !== undefined && rawSubTuples !== null) {
            if (
              !Array.isArray(rawSubTuples) ||
              rawSubTuples.length > MAX_SUB_ITEMS_PER_CATEGORY
            ) {
              return null;
            }
            decodedItems = [];
            for (let sIdx = 0; sIdx < rawSubTuples.length; sIdx += 1) {
              const subTuple = rawSubTuples[sIdx];
              if (!Array.isArray(subTuple) || subTuple.length < 1) return null;
              const [subName, subGrade] = subTuple;
              if (typeof subName !== 'string') return null;
              let subGradeVal = null;
              if (subGrade !== null && subGrade !== undefined) {
                if (
                  typeof subGrade !== 'number' ||
                  !Number.isFinite(subGrade) ||
                  subGrade < 0 ||
                  subGrade > 1000
                ) {
                  return null;
                }
                subGradeVal = subGrade === 0 ? 0 : subGrade;
              }
              decodedItems.push({
                id: `shared-sub-${tIdx}-${cIdx}-${kIdx}-${sIdx}`,
                name: subName,
                grade: subGradeVal,
              });
            }
            if (rawDropLowest !== undefined && rawDropLowest !== null) {
              if (
                typeof rawDropLowest !== 'number' ||
                !Number.isInteger(rawDropLowest) ||
                rawDropLowest < 0 ||
                rawDropLowest > 100
              ) {
                return null;
              }
              decodedDropLowest = rawDropLowest;
            }
          }

          const catObj = {
            id: `shared-cat-${tIdx}-${cIdx}-${kIdx}`,
            name: catName,
            weight: weightVal,
            grade: gradeVal,
          };
          if (decodedItems && decodedItems.length > 0) {
            catObj.items = decodedItems;
            catObj.dropLowest = decodedDropLowest;
            catObj.itemsExpanded = false;
          }
          categories.push(catObj);
        }

        const isPassFail = Boolean(c.pf !== undefined ? c.pf : c.cr);
        const duration = c.d === 'fy' || c.d === 'full-year' ? 'full-year' : 'term';

        courses.push({
          id: `shared-c-${tIdx}-${cIdx}`,
          code: c.c.trim(),
          title: c.t || '',
          units: unitsVal,
          duration,
          passFail: isPassFail,
          collapsed: false,
          targetPct,
          categories,
        });
      }

      terms.push({
        id: `shared-term-${tIdx}`,
        name: (term.n || '').trim() || `Term ${tIdx + 1}`,
        courses,
      });
    }

    const activeIdx =
      typeof compact.a === 'number' &&
      Number.isInteger(compact.a) &&
      compact.a >= 0 &&
      compact.a < terms.length
        ? compact.a
        : 0;

    const reconstructed = {
      version: 2,
      studentName: (compact.n || '').trim() || 'Shared',
      lastUpdated: (compact.u || '').trim() || new Date().toISOString(),
      activeTermId: terms[activeIdx].id,
      ...(decodedGradeScale ? { gradeScale: decodedGradeScale } : {}),
      terms,
    };

    return validateTrackerState(reconstructed);
  } catch {
    return null;
  }
}

function readShareFromQueryBody(body) {
  if (!body || typeof body !== 'string') return null;
  const queryCandidate = body.includes('?') && body.startsWith('/')
    ? body.slice(body.indexOf('?') + 1)
    : body;
  const params = new URLSearchParams(queryCandidate);
  const val = params.get('share');
  if (typeof val === 'string' && val.trim() !== '') {
    return val.trim();
  }
  return null;
}

/**
 * Extracts a share token from either `#share=<token>` (preferred) or `?share=<token>`.
 */
export function extractShareTokenFromUrl(locationLike) {
  const target = arguments.length === 0
    ? (typeof window !== 'undefined' ? window.location : null)
    : locationLike;

  if (!target) return null;

  let hash;
  let search;

  if (typeof target === 'string') {
    try {
      const parsed = new URL(target, 'http://localhost/');
      hash = parsed.hash;
      search = parsed.search;
    } catch {
      return null;
    }
  } else if (typeof target === 'object') {
    hash = typeof target.hash === 'string' ? target.hash : '';
    search = typeof target.search === 'string' ? target.search : '';
  } else {
    return null;
  }

  if (hash) {
    const hashBody = hash.startsWith('#') ? hash.slice(1) : hash;
    const fromHash = readShareFromQueryBody(hashBody);
    if (fromHash) return fromHash;
  }

  if (search) {
    const searchBody = search.startsWith('?') ? search.slice(1) : search;
    const fromSearch = readShareFromQueryBody(searchBody);
    if (fromSearch) return fromSearch;
  }

  return null;
}

/**
 * Builds `<origin><pathname>#share=<token>`, preserving subpath deployments like `/grade-tracker/`
 * as well as `file://` URLs while falling back safely to `http://localhost/` on malformed URLs.
 */
export function buildShareUrl(currentHref, token) {
  const rawFallback = typeof window !== 'undefined' && window.location?.href
    ? window.location.href
    : 'http://localhost/';

  let baseUrl;
  try {
    const parsedBase = new URL(rawFallback);
    baseUrl =
      parsedBase.protocol === 'http:' ||
      parsedBase.protocol === 'https:' ||
      parsedBase.protocol === 'file:'
        ? parsedBase
        : new URL('http://localhost/');
  } catch {
    baseUrl = new URL('http://localhost/');
  }

  let url;
  try {
    const candidate = typeof currentHref === 'string' && currentHref.trim() !== ''
      ? new URL(currentHref, baseUrl.href)
      : new URL(baseUrl.href);
    url =
      candidate.protocol === 'http:' ||
      candidate.protocol === 'https:' ||
      candidate.protocol === 'file:'
        ? candidate
        : new URL('http://localhost/');
  } catch {
    url = new URL('http://localhost/');
  }

  url.search = '';
  url.hash = `share=${encodeURIComponent(token ?? '')}`;
  return url.toString();
}

/**
 * Strips `#share` and `?share` from the browser address bar via history.replaceState.
 */
export function clearShareParamsFromCurrentUrl(win) {
  const targetWin = arguments.length === 0
    ? (typeof window !== 'undefined' ? window : null)
    : win;

  if (!targetWin?.location?.href || typeof targetWin.history?.replaceState !== 'function') {
    return;
  }

  try {
    const url = new URL(targetWin.location.href);
    url.searchParams.delete('share');

    let nextHash = url.hash;
    if (nextHash) {
      const hashBody = nextHash.startsWith('#') ? nextHash.slice(1) : nextHash;
      const hashParams = new URLSearchParams(hashBody);
      if (hashParams.has('share')) {
        hashParams.delete('share');
        const remaining = hashParams.toString();
        nextHash = remaining ? `#${remaining}` : '';
      }
    }

    const searchStr = url.searchParams.toString();
    const nextRelativeUrl = `${url.pathname}${searchStr ? `?${searchStr}` : ''}${nextHash}`;
    targetWin.history.replaceState(targetWin.history.state ?? null, '', nextRelativeUrl);
  } catch {
    // Ignore malformed location URLs
  }
}
