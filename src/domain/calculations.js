import { DEFAULT_GRADE_SCALE } from './constants.js';

const UTC_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizeDecimals(decimals, fallback) {
  return typeof decimals === 'number' &&
    Number.isInteger(decimals) &&
    decimals >= 0 &&
    decimals <= 100
    ? decimals
    : fallback;
}

function clampFinite(value, fallback = 0) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  if (Number.isFinite(value)) return value === 0 ? 0 : value;
  return value > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE;
}

export function deriveTierFromGpa(gpa) {
  if (typeof gpa !== 'number' || !Number.isFinite(gpa)) return 'tier-none';
  if (gpa >= 3.7) return 'tier-a';
  if (gpa >= 2.7) return 'tier-b';
  if (gpa >= 1.7) return 'tier-c';
  if (gpa >= 0.7) return 'tier-d';
  return 'tier-f';
}

/**
 * Half-up decimal rounding (half away from zero) with +1e-9 IEEE-754 compensation.
 * Ensures 85.30499999999999 -> 85.31 and 88.435 -> 88.44, without producing -0
 * or overflowing huge exact IEEE-754 integers (>= 2^53) to Infinity.
 */
export function roundHalfUp(value, decimals = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NaN;
  const d = normalizeDecimals(decimals, 2);
  if (Math.abs(value) >= 2 ** 53) {
    return value === 0 ? 0 : value;
  }
  const factor = 10 ** d;
  const sign = value < 0 ? -1 : 1;
  const rounded = sign * (Math.round((Math.abs(value) + 1e-9) * factor) / factor);
  if (!Number.isFinite(rounded)) {
    return value === 0 ? 0 : value;
  }
  return rounded === 0 ? 0 : rounded;
}

export function formatPercent(value, decimals = 2) {
  if (value === null || value === undefined || typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  const d = normalizeDecimals(decimals, 2);
  const rounded = roundHalfUp(value, d);
  if (!Number.isFinite(rounded)) {
    return '—';
  }
  return `${rounded.toFixed(d)}%`;
}

export function formatGpa(value, decimals = 1) {
  if (value === null || value === undefined || typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  const d = normalizeDecimals(decimals, 1);
  const rounded = roundHalfUp(value, d);
  if (!Number.isFinite(rounded)) {
    return '—';
  }
  return rounded.toFixed(d);
}

/**
 * Formats an ISO timestamp in the user's local timezone by default (#45),
 * accepting an optional IANA `timeZone` override for deterministic testing,
 * and preserving calendar day on plain `YYYY-MM-DD` strings.
 */
export function formatLastUpdated(isoString, timeZone) {
  if (!isoString || typeof isoString !== 'string') return '—';
  const trimmed = isoString.trim();
  if (!trimmed) return '—';

  const dateOnlyMatch = DATE_ONLY_RE.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (
      Number.isNaN(utcNoon.getTime()) ||
      utcNoon.getUTCFullYear() !== year ||
      utcNoon.getUTCMonth() !== month - 1 ||
      utcNoon.getUTCDate() !== day
    ) {
      return '—';
    }
    return UTC_DATE_FORMATTER.format(utcNoon);
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return '—';

  try {
    const options = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      ...(typeof timeZone === 'string' && timeZone.trim() !== ''
        ? { timeZone: timeZone.trim() }
        : {}),
    };
    return new Intl.DateTimeFormat('en-US', options).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }
}

/**
 * Returns the minimum passing percentage for Pass/Fail (`P` vs `NP`) derived from
 * the active `gradeScale` (lowest `min` among bands with `gpa > 0`, fallback `50`) (#39).
 */
export function getPassingThreshold(gradeScale = DEFAULT_GRADE_SCALE) {
  const activeScale =
    Array.isArray(gradeScale) && gradeScale.length > 0
      ? gradeScale
      : DEFAULT_GRADE_SCALE;

  let lowestPassingMin = Infinity;
  for (const band of activeScale) {
    if (
      band &&
      typeof band.gpa === 'number' &&
      Number.isFinite(band.gpa) &&
      band.gpa > 0 &&
      typeof band.min === 'number' &&
      Number.isFinite(band.min) &&
      band.min < lowestPassingMin
    ) {
      lowestPassingMin = band.min;
    }
  }
  return Number.isFinite(lowestPassingMin) ? lowestPassingMin : 50;
}

/**
 * Builds Target `<select>` options dynamically from the active `gradeScale` and
 * appends a `Custom (<pct>%)` option whenever `currentTargetPct` is not already listed (#40).
 */
export function buildTargetOptions(
  gradeScale = DEFAULT_GRADE_SCALE,
  currentTargetPct = null,
) {
  const activeScale =
    Array.isArray(gradeScale) && gradeScale.length > 0
      ? [...gradeScale].sort((a, b) => (b?.min ?? 0) - (a?.min ?? 0))
      : DEFAULT_GRADE_SCALE;
  const passThreshold = getPassingThreshold(activeScale);

  const options = [];
  const seenPcts = new Set();

  for (const band of activeScale) {
    if (
      !band ||
      typeof band.min !== 'number' ||
      !Number.isFinite(band.min) ||
      band.min <= 0 ||
      band.min > 100 ||
      typeof band.gpa !== 'number' ||
      !Number.isFinite(band.gpa) ||
      band.gpa <= 0
    ) {
      continue;
    }
    const pct = band.min === 0 ? 0 : band.min;
    if (seenPcts.has(pct)) continue;
    seenPcts.add(pct);

    const rawLetter = typeof band.letter === 'string' ? band.letter.trim() : '';
    const isPassBand = pct === passThreshold;
    const isAlreadyPassWord = /^(?:p|pass)$/i.test(rawLetter);
    const label = isPassBand
      ? isAlreadyPassWord || !rawLetter
        ? `Pass (${pct}%)`
        : `${rawLetter} / Pass (${pct}%)`
      : `${rawLetter || `${pct}%`} (${pct}%)`;

    options.push({ label, pct });
  }

  if (!seenPcts.has(passThreshold) && passThreshold > 0 && passThreshold <= 100) {
    seenPcts.add(passThreshold);
    options.push({ label: `Pass (${passThreshold}%)`, pct: passThreshold });
  }

  if (options.length === 0) {
    seenPcts.add(50);
    options.push({ label: 'Pass (50%)', pct: 50 });
  }

  if (
    typeof currentTargetPct === 'number' &&
    Number.isFinite(currentTargetPct)
  ) {
    const customPct = currentTargetPct === 0 ? 0 : currentTargetPct;
    if (!seenPcts.has(customPct)) {
      options.push({
        label: `Custom (${customPct}%)`,
        pct: customPct,
      });
    }
  }

  return options;
}

/**
 * Look up Letter Grade & Grade Point from a course percentage using a configurable grading scale.
 * Uses half-up integer rounding (`roundHalfUp(clamped, 0)`) on integer scales (89.5% -> 90% A+),
 * direct `+1e-9` comparison when custom scales specify decimal `min` bounds, and returns
 * `{ letter: 'F', gpa: 0, tier: 'tier-f', roundedPct: rounded }` below every band's `min` (#38).
 */
export function lookupGrade(percentage, gradeScale = DEFAULT_GRADE_SCALE) {
  if (percentage === null || percentage === undefined || typeof percentage !== 'number' || !Number.isFinite(percentage)) {
    return { letter: '—', gpa: null, tier: 'tier-none', roundedPct: null };
  }
  const activeScale = Array.isArray(gradeScale) && gradeScale.length > 0
    ? [...gradeScale].sort((a, b) => (b?.min ?? 0) - (a?.min ?? 0))
    : DEFAULT_GRADE_SCALE;

  const clamped = Math.max(0, Math.min(100, percentage));
  const rounded = Math.min(100, Math.max(0, roundHalfUp(clamped, 0)));
  const hasDecimalMins = activeScale.some(
    (r) => typeof r?.min === 'number' && Number.isFinite(r.min) && !Number.isInteger(r.min),
  );
  const compareScore = hasDecimalMins ? clamped + 1e-9 : rounded;

  for (const row of activeScale) {
    if (compareScore >= row.min) {
      return {
        letter: row.letter,
        gpa: row.gpa,
        tier: row.tier || deriveTierFromGpa(row.gpa),
        roundedPct: rounded,
      };
    }
  }
  return {
    letter: 'F',
    gpa: 0,
    tier: 'tier-f',
    roundedPct: rounded,
  };
}

/**
 * Note (#51): All standard Grade Tracker inputs (`0..1000` weights/grades, `0.25..100` units)
 * take the direct `O(n)` IEEE-754 fast paths below with zero extra allocation or log math;
 * `logSumExp2` and `computeScaledWeightedMean` are retained as cold-path fallbacks so direct
 * programmatic callers passing extreme subnormal/near-MAX_VALUE doubles remain NaN/Infinity-free.
 */
function logSumExp2(logs) {
  if (logs.length === 0) return -Infinity;
  let maxLog = -Infinity;
  for (const x of logs) {
    if (x > maxLog) maxLog = x;
  }
  let sum = 0;
  for (const x of logs) {
    sum += 2 ** (x - maxLog);
  }
  return maxLog + Math.log2(sum);
}

/**
 * Scale-invariant weighted mean sum(w_i * v_i) / sum(w_i) for items with w_i > 0 and finite v_i.
 * Preserves exact IEEE-754 division when scales fit within normal double range, and falls back
 * to log2 magnitude scaling only when cross-item products span >300 orders of magnitude.
 */
function computeScaledWeightedMean(items, maxW, maxAbsV) {
  if (items.length === 0 || maxW <= 0) return null;
  if (maxAbsV === 0) return 0;

  let normWSum = 0;
  let normWVSum = 0;
  let hadTermUnderflow = false;

  for (const { w, v } of items) {
    const nw = w / maxW;
    normWSum += nw;
    if (v !== 0) {
      const term = nw * (v / maxAbsV);
      if (term === 0) {
        hadTermUnderflow = true;
      }
      normWVSum += term;
    }
  }

  if (normWSum <= 0) return null;

  if (!hadTermUnderflow || Math.abs(normWVSum) >= 1e-290) {
    const scaled = (normWVSum / normWSum) * maxAbsV;
    if (Number.isFinite(scaled) && (scaled !== 0 || normWVSum === 0)) {
      return scaled === 0 ? 0 : scaled;
    }
  }

  const logDenom = Math.log2(maxW) + Math.log2(normWSum);
  let maxTermLog = -Infinity;
  for (const { w, v } of items) {
    if (v !== 0) {
      const lt = Math.log2(w) + Math.log2(Math.abs(v));
      if (lt > maxTermLog) maxTermLog = lt;
    }
  }
  if (maxTermLog === -Infinity) return 0;

  let scaledNumer = 0;
  for (const { w, v } of items) {
    if (v !== 0) {
      const lt = Math.log2(w) + Math.log2(Math.abs(v));
      const mag = 2 ** (lt - maxTermLog);
      scaledNumer += v < 0 ? -mag : mag;
    }
  }

  if (scaledNumer === 0) return 0;
  const sign = scaledNumer < 0 ? -1 : 1;
  const logResult = Math.log2(Math.abs(scaledNumer)) + maxTermLog - logDenom;
  return clampFinite(sign * (2 ** logResult), 0);
}

function computeCategoryTotals(course, simGrades = null) {
  let rawTotalWeight = 0;
  let rawGradedWeight = 0;
  let rawUngradedWeight = 0;
  let rawWeightedPoints = 0;
  let hasSimulated = false;

  let maxGradedWeight = 0;
  let minGradedWeight = Infinity;
  let maxAbsGrade = 0;
  let minNonZeroAbsGrade = Infinity;
  let hadTinyGradedTerm = false;

  let maxUngradedWeight = 0;

  const categories = Array.isArray(course?.categories) ? course.categories : [];
  const gradedItems = [];
  const ungradedWeights = [];

  const categoryBreakdowns = categories.map((cat) => {
    const w = typeof cat?.weight === 'number' && Number.isFinite(cat.weight) && cat.weight > 0
      ? cat.weight
      : 0;
    rawTotalWeight += w;

    const hasRealGrade = typeof cat?.grade === 'number' && Number.isFinite(cat.grade);
    const hasSimOverride = Boolean(
      simGrades && cat && Object.prototype.hasOwnProperty.call(simGrades, cat.id),
    );
    const simVal = hasSimOverride ? simGrades[cat.id] : undefined;
    const simCleared = hasSimOverride && simVal === null;
    const hasValidSimNum = hasSimOverride && typeof simVal === 'number' && Number.isFinite(simVal);
    const hasSimGrade = hasValidSimNum || (simCleared && hasRealGrade);

    const rawEffective = hasValidSimNum
      ? simVal
      : (simCleared ? null : (hasRealGrade ? cat.grade : null));
    const effectiveGrade = rawEffective === 0 ? 0 : rawEffective;
    let contribution = null;

    if (w > 0) {
      if (effectiveGrade !== null) {
        rawGradedWeight += w;
        if (w > maxGradedWeight) maxGradedWeight = w;
        if (w < minGradedWeight) minGradedWeight = w;

        const absG = Math.abs(effectiveGrade);
        if (absG > maxAbsGrade) maxAbsGrade = absG;
        if (absG > 0 && absG < minNonZeroAbsGrade) minNonZeroAbsGrade = absG;

        const prod = w * effectiveGrade;
        const rawContribution = (w >= 1e-290 || !Number.isFinite(prod))
          ? (w / 100) * effectiveGrade
          : prod / 100;
        if (absG > 0 && (w < 1e-290 || Math.abs(rawContribution) < 1e-290)) {
          hadTinyGradedTerm = true;
        }
        contribution = clampFinite(rawContribution, 0);
        rawWeightedPoints += rawContribution;
        if (hasSimGrade) hasSimulated = true;
        gradedItems.push({ w, v: effectiveGrade });
      } else {
        rawUngradedWeight += w;
        if (w > maxUngradedWeight) maxUngradedWeight = w;
        ungradedWeights.push(w);
      }
    }

    return {
      ...cat,
      effectiveGrade,
      isSimulated: hasSimGrade,
      contribution,
    };
  });

  const hasGradedWeight = gradedItems.length > 0;
  const hasUngradedWeight = ungradedWeights.length > 0;

  let normGradedSum = 0;
  if (hasGradedWeight) {
    for (const item of gradedItems) {
      normGradedSum += item.w / maxGradedWeight;
    }
  }

  let normUngradedSum = 0;
  if (hasUngradedWeight) {
    for (const uw of ungradedWeights) {
      normUngradedSum += uw / maxUngradedWeight;
    }
  }

  const fastOverall = hasGradedWeight && rawGradedWeight > 0
    ? (rawWeightedPoints / rawGradedWeight) * 100
    : null;

  const needsGradedScaledFallback =
    hasGradedWeight && (
      hadTinyGradedTerm ||
      rawGradedWeight < 1e-200 ||
      minGradedWeight < 1e-290 ||
      (maxAbsGrade > 0 && minNonZeroAbsGrade < 1e-290) ||
      !Number.isFinite(rawGradedWeight) ||
      !Number.isFinite(rawWeightedPoints) ||
      !Number.isFinite(fastOverall)
    );

  let overallGrade = null;
  if (hasGradedWeight) {
    if (!needsGradedScaledFallback) {
      overallGrade = fastOverall === 0 ? 0 : fastOverall;
    } else {
      overallGrade = computeScaledWeightedMean(gradedItems, maxGradedWeight, maxAbsGrade);
    }
  }

  if (overallGrade !== null && !Number.isFinite(overallGrade)) {
    overallGrade = null;
  }

  let weightedPoints;
  if (Number.isFinite(rawWeightedPoints)) {
    weightedPoints = rawWeightedPoints === 0 ? 0 : rawWeightedPoints;
  } else if (hasGradedWeight && overallGrade !== null) {
    if (overallGrade === 0) {
      weightedPoints = 0;
    } else {
      const sign = overallGrade < 0 ? -1 : 1;
      const logWP =
        Math.log2(maxGradedWeight) +
        Math.log2(normGradedSum) +
        Math.log2(Math.abs(overallGrade)) -
        Math.log2(100);
      weightedPoints = clampFinite(sign * (2 ** logWP), 0);
    }
  } else {
    weightedPoints = 0;
  }

  const gradedWeight = hasGradedWeight ? clampFinite(rawGradedWeight, 0) : 0;
  const remainingWeight = hasUngradedWeight ? clampFinite(rawUngradedWeight, 0) : 0;
  const totalWeight = clampFinite(rawTotalWeight, 0);
  const isWeightValid = Number.isFinite(rawTotalWeight) && Math.abs(rawTotalWeight - 100) < 0.01;

  return {
    totalWeight,
    isWeightValid,
    gradedWeight,
    remainingWeight,
    weightedPoints,
    overallGrade,
    hasSimulated,
    categoryBreakdowns,
    hasGradedWeight,
    hasUngradedWeight,
    rawTotalWeight,
    rawGradedWeight,
    rawUngradedWeight,
    maxGradedWeight,
    normGradedSum,
    maxUngradedWeight,
    normUngradedSum,
    needsGradedScaledFallback,
  };
}

function classifyTargetStatus(requiredOnRemaining) {
  if (requiredOnRemaining <= 1e-9) return 'secured';
  if (requiredOnRemaining > 100 + 1e-9) return 'unreachable';
  return 'achievable';
}

function computeTargetFromTotals(totals, targetPct) {
  const {
    weightedPoints,
    overallGrade,
    hasGradedWeight,
    hasUngradedWeight,
    rawTotalWeight,
    rawGradedWeight,
    rawUngradedWeight,
    maxGradedWeight,
    normGradedSum,
    maxUngradedWeight,
    normUngradedSum,
    needsGradedScaledFallback,
  } = totals;

  const effectiveTarget = typeof targetPct === 'number' && Number.isFinite(targetPct) ? targetPct : 85;

  // Single source of truth: course is complete iff there are zero ungraded positive-weight rows.
  if (!hasUngradedWeight) {
    return {
      requiredOnRemaining: null,
      status: 'complete',
      maxPossible: overallGrade,
      minPossible: overallGrade,
    };
  }

  // 100% of positive syllabus weight is ungraded.
  if (!hasGradedWeight) {
    const requiredOnRemaining = Math.abs(effectiveTarget) < 1e-12 ? 0 : effectiveTarget;
    return {
      requiredOnRemaining,
      status: classifyTargetStatus(requiredOnRemaining),
      maxPossible: 100,
      minPossible: 0,
    };
  }

  // Well-conditioned normal fast path (no subnormals, overflow, or G+R cancellation).
  const weightRatioFast = rawGradedWeight / rawUngradedWeight;
  if (
    !needsGradedScaledFallback &&
    Number.isFinite(rawTotalWeight) &&
    rawGradedWeight >= 1e-100 &&
    rawUngradedWeight >= 1e-100 &&
    weightRatioFast >= 1e-6 &&
    weightRatioFast <= 1e6
  ) {
    const fastMax = ((weightedPoints + rawUngradedWeight) / rawTotalWeight) * 100;
    const fastMin = (weightedPoints / rawTotalWeight) * 100;
    const targetPointsNeeded = (effectiveTarget * rawTotalWeight) / 100;

    if (
      Number.isFinite(fastMax) &&
      Number.isFinite(fastMin) &&
      Number.isFinite(targetPointsNeeded)
    ) {
      const rawRequired = ((targetPointsNeeded - weightedPoints) / rawUngradedWeight) * 100;
      if (Number.isFinite(rawRequired)) {
        const requiredOnRemaining = Math.abs(rawRequired) < 1e-12 ? 0 : rawRequired;
        return {
          requiredOnRemaining,
          status: classifyTargetStatus(requiredOnRemaining),
          maxPossible: fastMax,
          minPossible: fastMin,
        };
      }
    }
  }

  // Cancellation-free ratio path across all IEEE-754 scales:
  // T = (G * avgG + R * req) / (G + R) <=> req = T + (G / R) * (T - avgG).
  const avgG = overallGrade ?? 0;
  let ratio;
  if (
    Number.isFinite(rawGradedWeight) &&
    Number.isFinite(rawUngradedWeight) &&
    rawGradedWeight >= 1e-290 &&
    rawUngradedWeight >= 1e-290
  ) {
    const directRatio = rawGradedWeight / rawUngradedWeight;
    if (Number.isFinite(directRatio) && directRatio > 0) {
      ratio = directRatio;
    } else {
      const logRatio =
        (Math.log2(maxGradedWeight) + Math.log2(normGradedSum)) -
        (Math.log2(maxUngradedWeight) + Math.log2(normUngradedSum));
      ratio = 2 ** logRatio;
    }
  } else {
    const logRatio =
      (Math.log2(maxGradedWeight) + Math.log2(normGradedSum)) -
      (Math.log2(maxUngradedWeight) + Math.log2(normUngradedSum));
    ratio = 2 ** logRatio;
  }

  const fGraded = !Number.isFinite(ratio) ? 1 : ratio / (1 + ratio);
  const fRem = !Number.isFinite(ratio) ? 0 : 1 / (1 + ratio);
  const minPossible = clampFinite(fGraded * avgG, 0);
  const maxPossible = clampFinite(minPossible + fRem * 100, minPossible);

  let rawRequired;
  if (effectiveTarget === avgG) {
    rawRequired = effectiveTarget;
  } else if (!Number.isFinite(ratio)) {
    rawRequired = effectiveTarget > avgG ? Number.MAX_VALUE : -Number.MAX_VALUE;
  } else {
    const diff = effectiveTarget - avgG;
    rawRequired = Number.isFinite(diff)
      ? effectiveTarget + ratio * diff
      : effectiveTarget + ratio * effectiveTarget - ratio * avgG;
  }

  const finiteRequired = clampFinite(rawRequired, effectiveTarget);
  const requiredOnRemaining = Math.abs(finiteRequired) < 1e-12 ? 0 : finiteRequired;

  return {
    requiredOnRemaining,
    status: classifyTargetStatus(requiredOnRemaining),
    maxPossible,
    minPossible,
  };
}

export function calculateTargetRequirement(course, targetPct, simGrades = null) {
  const totals = computeCategoryTotals(course, simGrades);
  const resolvedTarget = typeof targetPct === 'number' && Number.isFinite(targetPct)
    ? targetPct
    : (typeof course?.targetPct === 'number' && Number.isFinite(course.targetPct) ? course.targetPct : 85);
  return computeTargetFromTotals(totals, resolvedTarget);
}

function computeCourseInternal(course, simGrades = null, gradeScale = DEFAULT_GRADE_SCALE) {
  const totals = computeCategoryTotals(course, simGrades);
  const {
    totalWeight,
    isWeightValid,
    gradedWeight,
    remainingWeight,
    weightedPoints,
    overallGrade,
    hasSimulated,
    categoryBreakdowns,
  } = totals;

  const gradeInfo = lookupGrade(overallGrade, gradeScale);
  const targetPct = typeof course?.targetPct === 'number' && Number.isFinite(course.targetPct) ? course.targetPct : 85;
  const target = computeTargetFromTotals(totals, targetPct);
  const isPassFail = Boolean(course?.passFail ?? course?.creditNoCredit);

  const passThreshold = getPassingThreshold(gradeScale);
  const pfCompareScore =
    overallGrade === null || !Number.isFinite(overallGrade)
      ? null
      : Number.isInteger(passThreshold)
        ? gradeInfo.roundedPct
        : Math.min(100, Math.max(0, overallGrade)) + 1e-9;
  const letter = isPassFail
    ? pfCompareScore === null
      ? 'P/F'
      : pfCompareScore >= passThreshold
        ? 'P'
        : 'NP'
    : gradeInfo.letter;

  return {
    stats: {
      totalWeight,
      isWeightValid,
      gradedWeight,
      remainingWeight,
      weightedPoints,
      overallGrade,
      letter,
      gpa: isPassFail ? null : gradeInfo.gpa,
      tier: isPassFail ? 'tier-cr' : gradeInfo.tier,
      roundedPct: gradeInfo.roundedPct,
      hasSimulated,
      targetPct,
      requiredOnRemaining: target.requiredOnRemaining,
      targetStatus: target.status,
      maxPossible: target.maxPossible,
      minPossible: target.minPossible,
      categoryBreakdowns,
    },
    totals,
  };
}

/**
 * Compute running course grade, graded weight, total weight, Pass/Fail status,
 * What-If simulator overlay, and target requirements.
 */
export function calculateCourseStats(course, simGrades = null, gradeScale = DEFAULT_GRADE_SCALE) {
  return computeCourseInternal(course, simGrades, gradeScale).stats;
}

/**
 * Compute unit-weighted GPA, weighted average %, and syllabus completion % across courses.
 */
export function calculateAggregateStats(courses, simGrades = null, gradeScale = DEFAULT_GRADE_SCALE) {
  let gpaUnits = 0;
  let gpaWeightedSum = 0;
  let maxGpaUnit = 0;
  let maxAbsGpa = 0;
  let hadTinyGpaTerm = false;

  let pctUnits = 0;
  let pctWeightedSum = 0;
  let maxPctUnit = 0;
  let maxAbsPct = 0;
  let hadTinyPctTerm = false;

  let totalUnitsEnrolled = 0;
  let totalWeightAcrossCourses = 0;
  let gradedWeightAcrossCourses = 0;
  let hasCourseWeightOverflow = false;
  let hadTinyWeightProduct = false;

  const gpaItems = [];
  const pctItems = [];
  const validCourseRecords = [];

  for (const course of (Array.isArray(courses) ? courses : [])) {
    const units = typeof course?.units === 'number' && Number.isFinite(course.units) && course.units > 0
      ? course.units
      : 0;
    totalUnitsEnrolled += units;

    const { stats, totals } = computeCourseInternal(course, simGrades, gradeScale);
    const hasWeight = totals.hasGradedWeight || totals.hasUngradedWeight;
    const isPassFail = Boolean(course?.passFail ?? course?.creditNoCredit);

    if (
      totals.needsGradedScaledFallback ||
      !Number.isFinite(totals.rawTotalWeight) ||
      !Number.isFinite(totals.rawGradedWeight) ||
      !Number.isFinite(totals.rawUngradedWeight)
    ) {
      hasCourseWeightOverflow = true;
    }

    if (hasWeight && units > 0) {
      const courseTotalProduct = totals.rawTotalWeight * units;
      const courseGradedProduct = totals.rawGradedWeight * units;
      totalWeightAcrossCourses += courseTotalProduct;
      gradedWeightAcrossCourses += courseGradedProduct;

      if (
        units < 1e-290 ||
        courseTotalProduct < 1e-290 ||
        (totals.hasGradedWeight && courseGradedProduct < 1e-290) ||
        (totals.hasUngradedWeight && totals.rawUngradedWeight * units < 1e-290)
      ) {
        hadTinyWeightProduct = true;
      }
    }

    const hasFiniteOverall = stats.overallGrade !== null && Number.isFinite(stats.overallGrade);
    const hasFiniteGpa = !isPassFail && stats.gpa !== null && Number.isFinite(stats.gpa);

    if (hasFiniteOverall && units > 0) {
      pctUnits += units;
      const pctProd = stats.overallGrade * units;
      pctWeightedSum += pctProd;
      if (units > maxPctUnit) maxPctUnit = units;
      const absOverall = Math.abs(stats.overallGrade);
      if (absOverall > maxAbsPct) maxAbsPct = absOverall;
      if (absOverall > 0 && (units < 1e-290 || Math.abs(pctProd) < 1e-290)) {
        hadTinyPctTerm = true;
      }
      pctItems.push({ w: units, v: stats.overallGrade });

      if (hasFiniteGpa) {
        gpaUnits += units;
        const gpaProd = stats.gpa * units;
        gpaWeightedSum += gpaProd;
        if (units > maxGpaUnit) maxGpaUnit = units;
        const absGpa = Math.abs(stats.gpa);
        if (absGpa > maxAbsGpa) maxAbsGpa = absGpa;
        if (absGpa > 0 && (units < 1e-290 || Math.abs(gpaProd) < 1e-290)) {
          hadTinyGpaTerm = true;
        }
        gpaItems.push({ w: units, v: stats.gpa });
      }
    }

    if (units > 0) {
      validCourseRecords.push({
        units,
        hasWeight,
        hasGradedWeight: totals.hasGradedWeight,
        hasUngradedWeight: totals.hasUngradedWeight,
        maxGradedWeight: totals.maxGradedWeight,
        normGradedSum: totals.normGradedSum,
        maxUngradedWeight: totals.maxUngradedWeight,
        normUngradedSum: totals.normUngradedSum,
      });
    }
  }

  let cumulativeGpa = gpaItems.length > 0 && gpaUnits > 0 ? gpaWeightedSum / gpaUnits : null;
  if (
    gpaItems.length > 0 &&
    (hadTinyGpaTerm ||
      gpaUnits < 1e-200 ||
      !Number.isFinite(gpaUnits) ||
      !Number.isFinite(gpaWeightedSum) ||
      !Number.isFinite(cumulativeGpa))
  ) {
    cumulativeGpa = computeScaledWeightedMean(gpaItems, maxGpaUnit, maxAbsGpa);
  }

  let weightedAverage = pctItems.length > 0 && pctUnits > 0 ? pctWeightedSum / pctUnits : null;
  if (
    pctItems.length > 0 &&
    (hadTinyPctTerm ||
      pctUnits < 1e-200 ||
      !Number.isFinite(pctUnits) ||
      !Number.isFinite(pctWeightedSum) ||
      !Number.isFinite(weightedAverage))
  ) {
    weightedAverage = computeScaledWeightedMean(pctItems, maxPctUnit, maxAbsPct);
  }

  const hasWeightedCourse = validCourseRecords.some((r) => r.hasWeight && r.units > 0);
  let completionPct = totalWeightAcrossCourses > 0
    ? (gradedWeightAcrossCourses / totalWeightAcrossCourses) * 100
    : 0;

  if (
    hasWeightedCourse &&
    (hasCourseWeightOverflow ||
      hadTinyWeightProduct ||
      totalWeightAcrossCourses < 1e-200 ||
      !Number.isFinite(totalWeightAcrossCourses) ||
      !Number.isFinite(gradedWeightAcrossCourses) ||
      !Number.isFinite(completionPct))
  ) {
    const gradedLogs = [];
    const ungradedLogs = [];

    for (const r of validCourseRecords) {
      if (!r.hasWeight) continue;
      const logU = Math.log2(r.units);
      if (r.hasGradedWeight) {
        gradedLogs.push(logU + Math.log2(r.maxGradedWeight) + Math.log2(r.normGradedSum));
      }
      if (r.hasUngradedWeight) {
        ungradedLogs.push(logU + Math.log2(r.maxUngradedWeight) + Math.log2(r.normUngradedSum));
      }
    }

    if (gradedLogs.length === 0) {
      completionPct = 0;
    } else if (ungradedLogs.length === 0) {
      completionPct = 100;
    } else {
      const logN = logSumExp2(gradedLogs);
      const logM = logSumExp2(ungradedLogs);
      const d = logM - logN;
      completionPct = d > 100 ? 100 * (2 ** -d) : 100 / (1 + 2 ** d);
    }
  }

  return {
    cumulativeGpa: cumulativeGpa === null ? null : clampFinite(cumulativeGpa, 0),
    weightedAverage: weightedAverage === null ? null : clampFinite(weightedAverage, 0),
    totalUnitsEnrolled: clampFinite(totalUnitsEnrolled, 0),
    gpaUnits: clampFinite(gpaUnits, 0),
    completionPct: clampFinite(completionPct, 0),
  };
}

const CANONICAL_SCALE_TIERS = new Set([
  'tier-a',
  'tier-b',
  'tier-c',
  'tier-d',
  'tier-f',
]);

/**
 * Compute term-by-term GPA progression (both Term GPA and running Cumulative GPA)
 * and graded course tier distribution across the active grading scale (#102).
 */
export function calculateGpaVisuals(state, simGrades = null) {
  const gradeScale = Array.isArray(state?.gradeScale) && state.gradeScale.length > 0
    ? state.gradeScale
    : DEFAULT_GRADE_SCALE;
  const terms = Array.isArray(state?.terms) ? state.terms : [];

  let scaleMaxGpa = 0;
  const tierGroups = new Map();

  for (const band of gradeScale) {
    const bandGpa = typeof band?.gpa === 'number' && Number.isFinite(band.gpa) ? band.gpa : 0;
    if (bandGpa > scaleMaxGpa) {
      scaleMaxGpa = bandGpa;
    }
    const rawTier = typeof band?.tier === 'string' ? band.tier.trim() : '';
    const tierKey = CANONICAL_SCALE_TIERS.has(rawTier) ? rawTier : deriveTierFromGpa(bandGpa);
    if (!tierGroups.has(tierKey)) {
      tierGroups.set(tierKey, {
        key: tierKey,
        tier: tierKey,
        letters: [],
        count: 0,
        units: 0,
        letterCounts: {},
      });
    }
    const letter = typeof band?.letter === 'string' && band.letter.trim() !== ''
      ? band.letter.trim()
      : '—';
    const group = tierGroups.get(tierKey);
    if (!group.letters.includes(letter)) {
      group.letters.push(letter);
    }
  }

  if (scaleMaxGpa <= 0) {
    scaleMaxGpa = 4.0;
  }

  const termSeries = [];
  const runningCourses = [];
  let prevGradedTermGpa = null;
  let gradedTermCount = 0;

  for (let idx = 0; idx < terms.length; idx += 1) {
    const term = terms[idx];
    const courses = Array.isArray(term?.courses) ? term.courses : [];
    runningCourses.push(...courses);

    const termAgg = calculateAggregateStats(courses, simGrades, gradeScale);
    const runningAgg = calculateAggregateStats(runningCourses, simGrades, gradeScale);
    const termGpa = termAgg.cumulativeGpa;
    const deltaFromPrev = prevGradedTermGpa !== null && termGpa !== null
      ? termGpa - prevGradedTermGpa
      : null;

    if (termGpa !== null) {
      prevGradedTermGpa = termGpa;
      gradedTermCount += 1;
    }

    termSeries.push({
      termId: typeof term?.id === 'string' && term.id !== '' ? term.id : `term-${idx + 1}`,
      termName: typeof term?.name === 'string' && term.name.trim() !== ''
        ? term.name.trim()
        : `Term ${idx + 1}`,
      termGpa,
      runningCumulativeGpa: runningAgg.cumulativeGpa,
      weightedAverage: termAgg.weightedAverage,
      enrolledUnits: termAgg.totalUnitsEnrolled,
      gpaUnits: termAgg.gpaUnits,
      deltaFromPrev,
    });
  }

  const passBucket = {
    key: 'pass',
    tier: 'tier-cr',
    letters: ['P'],
    count: 0,
    units: 0,
    letterCounts: {},
  };
  const noPassBucket = {
    key: 'no-pass',
    tier: 'tier-f',
    letters: ['NP'],
    count: 0,
    units: 0,
    letterCounts: {},
  };

  let gradedCourseCount = 0;
  let ungradedCourseCount = 0;
  let gradedUnits = 0;

  for (const course of runningCourses) {
    const units = typeof course?.units === 'number' && Number.isFinite(course.units) && course.units > 0
      ? course.units
      : 0;
    const cStats = calculateCourseStats(course, simGrades, gradeScale);
    if (cStats.overallGrade === null || !Number.isFinite(cStats.overallGrade)) {
      ungradedCourseCount += 1;
      continue;
    }

    gradedCourseCount += 1;
    gradedUnits += units;

    const isPassFail = Boolean(course?.passFail ?? course?.creditNoCredit);
    if (isPassFail) {
      const targetBucket = cStats.letter === 'P' ? passBucket : noPassBucket;
      targetBucket.count += 1;
      targetBucket.units += units;
      targetBucket.letterCounts[cStats.letter] = (targetBucket.letterCounts[cStats.letter] || 0) + 1;
      continue;
    }

    const bucketKey = tierGroups.has(cStats.tier) ? cStats.tier : 'tier-f';
    if (!tierGroups.has(bucketKey)) {
      tierGroups.set(bucketKey, {
        key: bucketKey,
        tier: bucketKey,
        letters: [cStats.letter || 'F'],
        count: 0,
        units: 0,
        letterCounts: {},
      });
    }
    const bucket = tierGroups.get(bucketKey);
    bucket.count += 1;
    bucket.units += units;
    const ltr = cStats.letter || '—';
    bucket.letterCounts[ltr] = (bucket.letterCounts[ltr] || 0) + 1;
  }

  const rawBuckets = [...tierGroups.values()];
  if (passBucket.count > 0) rawBuckets.push(passBucket);
  if (noPassBucket.count > 0) rawBuckets.push(noPassBucket);

  const distribution = rawBuckets.map((b) => {
    let label;
    if (b.key === 'pass') {
      label = 'P (Pass)';
    } else if (b.key === 'no-pass') {
      label = 'NP (No Pass)';
    } else if (b.letters.length <= 3) {
      label = b.letters.join(' / ');
    } else {
      label = `${b.letters[0]}–${b.letters[b.letters.length - 1]}`;
    }

    const sharePct = gradedCourseCount > 0 ? (b.count / gradedCourseCount) * 100 : 0;
    const roundedPct = gradedCourseCount > 0 ? roundHalfUp(sharePct, 0) : 0;
    const detailLabel = Object.entries(b.letterCounts)
      .map(([ltr, n]) => `${n} ${ltr}`)
      .join(', ');

    return {
      key: b.key,
      tier: b.tier,
      label,
      count: b.count,
      units: clampFinite(b.units, 0),
      sharePct: clampFinite(sharePct, 0),
      roundedPct,
      detailLabel,
    };
  });

  return {
    scaleMaxGpa,
    termSeries,
    gradedTermCount,
    gradedCourseCount,
    ungradedCourseCount,
    gradedUnits: clampFinite(gradedUnits, 0),
    distribution,
  };
}

/**
 * Compute overall cumulative stats, active term stats, and GPA visuals across the entire tracker state.
 */
export function calculateAllStats(state, simGrades = null) {
  const gradeScale = Array.isArray(state?.gradeScale) && state.gradeScale.length > 0
    ? state.gradeScale
    : DEFAULT_GRADE_SCALE;
  const terms = Array.isArray(state?.terms) ? state.terms : [];
  const allCourses = terms.flatMap((t) => (Array.isArray(t?.courses) ? t.courses : []));
  const overall = calculateAggregateStats(allCourses, simGrades, gradeScale);

  const activeTerm = terms.find((t) => t?.id === state?.activeTermId) || terms[0];
  const termStats = activeTerm
    ? calculateAggregateStats(activeTerm.courses || [], simGrades, gradeScale)
    : calculateAggregateStats([], simGrades, gradeScale);

  const visuals = calculateGpaVisuals(state, simGrades);

  return {
    overall,
    termStats,
    visuals,
  };
}
