import { calculateCourseStats, formatPercent, formatGpa } from '../domain/calculations.js';
import { validateTrackerState } from './storage.js';

const CSV_HEADERS = [
  'Term',
  'Units',
  'Course',
  'Category',
  'Weight (%)',
  'Grade (%)',
  'Overall Grade',
  'Grade Point',
  'Letter',
];

function escapeCsvCell(cell) {
  const str = cell === null || cell === undefined ? '' : String(cell);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function buildExportFilename(studentName, kind, date = new Date()) {
  const slug = String(studentName || 'my-grades')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'my-grades';
  const yyyyMmDd = date.toISOString().slice(0, 10);
  return `${slug}-${kind}-${yyyyMmDd}`;
}

export function serializeStateToJson(state) {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/**
 * Strictly parses and deeply validates imported JSON text.
 * Throws a descriptive Error if JSON syntax or nested schema is invalid.
 */
export function parseImportedJson(jsonText) {
  if (typeof jsonText !== 'string' || jsonText.trim() === '') {
    throw new Error('Invalid JSON import: file content is empty.');
  }

  const stripped = jsonText.replace(/^\uFEFF/, '');
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error(`Invalid JSON syntax: ${err.message}`);
  }

  return validateTrackerState(parsed);
}

/**
 * Serializes TrackerState into an Excel-compatible UTF-8 BOM CSV with CRLF line endings
 * and uniform 9-column RFC-4180 rows.
 */
export function serializeStateToCsv(state) {
  const rows = [CSV_HEADERS];
  const terms = Array.isArray(state?.terms) ? state.terms : [];
  const gradeScale = Array.isArray(state?.gradeScale) && state.gradeScale.length > 0
    ? state.gradeScale
    : undefined;
  const flatCourseEntries = [];

  for (const term of terms) {
    for (const course of (Array.isArray(term?.courses) ? term.courses : [])) {
      flatCourseEntries.push({ term, course });
    }
  }

  flatCourseEntries.forEach(({ term, course }, idx) => {
    const stats = calculateCourseStats(course, null, gradeScale);
    rows.push([
      term.name || '',
      course.units,
      course.code,
      '',
      '',
      '',
      formatPercent(stats.overallGrade, 2),
      stats.gpa !== null ? formatGpa(stats.gpa, 1) : '',
      stats.letter,
    ]);

    for (const cat of (Array.isArray(course.categories) ? course.categories : [])) {
      rows.push([
        '',
        '',
        '',
        cat.name,
        typeof cat.weight === 'number' && Number.isFinite(cat.weight) ? formatPercent(cat.weight, 2) : '',
        typeof cat.grade === 'number' && Number.isFinite(cat.grade) ? formatPercent(cat.grade, 2) : '',
        '',
        '',
        '',
      ]);
    }

    if (idx < flatCourseEntries.length - 1) {
      rows.push(['', '', '', '', '', '', '', '', '']);
    }
  });

  const csvBody = rows
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\r\n');

  return `\uFEFF${csvBody}`;
}

function triggerDownload(content, mimeType, filename) {
  if (typeof document === 'undefined' || !document.body) return;

  const blob = new Blob([content], { type: mimeType });
  const hasObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  const href = hasObjectUrl
    ? URL.createObjectURL(blob)
    : `data:${mimeType},${encodeURIComponent(content)}`;

  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  if (hasObjectUrl && typeof URL.revokeObjectURL === 'function') {
    const timer = setTimeout(() => {
      URL.revokeObjectURL(href);
    }, 1000);
    timer?.unref?.();
  }
}

export function exportStateAsJson(state) {
  const jsonContent = serializeStateToJson(state);
  const filename = `${buildExportFilename(state?.studentName, 'grade-tracker')}.json`;
  triggerDownload(jsonContent, 'application/json;charset=utf-8;', filename);
}

export function exportStateAsCsv(state) {
  const csvContent = serializeStateToCsv(state);
  const filename = `${buildExportFilename(state?.studentName, 'grades')}.csv`;
  triggerDownload(csvContent, 'text/csv;charset=utf-8;', filename);
}
