import { useId, useState } from 'react';
import { formatGpa, formatPercent, roundHalfUp } from '../domain/calculations.js';

function truncateAxisLabel(name, maxLen) {
  const clean = String(name || '').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

function formatUnitsCompact(units) {
  if (typeof units !== 'number' || !Number.isFinite(units)) return '0';
  const rounded = roundHalfUp(units, 2);
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

export default function GpaVisualsPanel({
  visuals,
  activeTermId,
  simMode = false,
  onSelectTerm,
}) {
  const rawGradientId = useId();
  const areaGradientId = `gt-gpa-area-${rawGradientId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [hoverState, setHoverState] = useState({
    forActiveTermId: null,
    termId: null,
  });

  const {
    scaleMaxGpa = 4.0,
    termSeries = [],
    gradedTermCount = 0,
    gradedCourseCount = 0,
    gradedUnits = 0,
    distribution = [],
  } = visuals || {};

  const effectiveHoveredTermId =
    hoverState.forActiveTermId === activeTermId ? hoverState.termId : null;

  const focusedTerm =
    (effectiveHoveredTermId &&
      termSeries.find((t) => t.termId === effectiveHoveredTermId)) ||
    (activeTermId && termSeries.find((t) => t.termId === activeTermId)) ||
    [...termSeries].reverse().find((t) => t.termGpa !== null) ||
    termSeries[termSeries.length - 1] ||
    null;

  function setHoveredTermId(nextTermId) {
    setHoverState({
      forActiveTermId: activeTermId ?? null,
      termId: nextTermId,
    });
  }

  const observedGpas = [];
  for (const item of termSeries) {
    if (item.termGpa !== null && Number.isFinite(item.termGpa)) {
      observedGpas.push(item.termGpa);
    }
    if (item.runningCumulativeGpa !== null && Number.isFinite(item.runningCumulativeGpa)) {
      observedGpas.push(item.runningCumulativeGpa);
    }
  }

  const yMax = Math.max(scaleMaxGpa, ...(observedGpas.length > 0 ? observedGpas : [4.0]));
  const minObserved = observedGpas.length > 0 ? Math.min(...observedGpas) : 0;
  const yMin = yMax <= 4.5 && observedGpas.length > 0 && minObserved >= 2.2 ? 2.0 : 0.0;
  const yMid = (yMin + yMax) / 2;
  const ySpan = Math.max(0.001, yMax - yMin);

  const xLeft = 36;
  const xRight = 306;
  const yTop = 14;
  const yBottom = 78;

  function gpaToY(gpaValue) {
    const clamped = Math.min(yMax, Math.max(yMin, gpaValue));
    return yBottom - ((clamped - yMin) / ySpan) * (yBottom - yTop);
  }

  const maxTickChars = termSeries.length >= 6 ? 6 : termSeries.length >= 4 ? 9 : 13;
  const labelStep = termSeries.length > 7 ? Math.ceil(termSeries.length / 5) : 1;

  const points = termSeries.map((item, idx) => {
    const x =
      termSeries.length === 1
        ? (xLeft + xRight) / 2
        : xLeft + 12 + (idx / (termSeries.length - 1)) * (xRight - xLeft - 24);
    const termY = item.termGpa !== null ? gpaToY(item.termGpa) : null;
    const cumY =
      item.runningCumulativeGpa !== null ? gpaToY(item.runningCumulativeGpa) : null;
    return {
      ...item,
      idx,
      x,
      termY,
      cumY,
      shortName: truncateAxisLabel(item.termName, maxTickChars),
    };
  });

  const gradedTermPoints = points.filter((p) => p.termY !== null);
  const gradedCumPoints = points.filter((p) => p.cumY !== null);
  const showCumulativeSeries =
    gradedTermPoints.length >= 2 && gradedCumPoints.length >= 2;

  const termPolyline = gradedTermPoints
    .map((p) => `${p.x.toFixed(1)},${p.termY.toFixed(1)}`)
    .join(' ');
  const cumPolyline = gradedCumPoints
    .map((p) => `${p.x.toFixed(1)},${p.cumY.toFixed(1)}`)
    .join(' ');

  const areaPath =
    gradedTermPoints.length >= 2
      ? `M ${gradedTermPoints[0].x.toFixed(1)},${yBottom} L ${gradedTermPoints
          .map((p) => `${p.x.toFixed(1)},${p.termY.toFixed(1)}`)
          .join(' L ')} L ${gradedTermPoints[
          gradedTermPoints.length - 1
        ].x.toFixed(1)},${yBottom} Z`
      : null;

  const chartSummaryText =
    gradedTermCount === 0
      ? 'No graded terms yet.'
      : `Term GPA progression across ${termSeries.length} ${
          termSeries.length === 1 ? 'term' : 'terms'
        }: ${termSeries
          .map(
            (t) =>
              `${t.termName} ${
                t.termGpa !== null ? formatGpa(t.termGpa, 2) : 'ungraded'
              }`,
          )
          .join(', ')}.`;

  const deltaValue = focusedTerm?.deltaFromPrev ?? null;
  const hasSignificantDelta = deltaValue !== null && Math.abs(deltaValue) >= 0.005;

  return (
    <section
      id="gpa-visuals-panel"
      className="gpa-visuals-panel"
      aria-label="GPA Trend and Grade Distribution Visuals"
    >
      <div className="gpa-visuals-grid">
        {/* Card 1: Term-by-Term GPA Trend */}
        <div className="gpa-visuals-card">
          <div className="gpa-visuals-card-head">
            <div className="gpa-visuals-title-group">
              <h2 className="gpa-visuals-title">Term GPA Trend</h2>
              {simMode && (
                <span className="gpa-visuals-sim-pill">What-If Live</span>
              )}
            </div>

            {focusedTerm && focusedTerm.termGpa !== null ? (
              <div className="gpa-trend-readout tabular">
                <span className="gpa-trend-term-name">{focusedTerm.termName}:</span>
                <strong>{formatGpa(focusedTerm.termGpa, 2)}</strong>
                {focusedTerm.weightedAverage !== null && (
                  <span className="gpa-trend-avg">
                    ({formatPercent(focusedTerm.weightedAverage, 1)})
                  </span>
                )}
                {hasSignificantDelta && (
                  <span
                    className={`gpa-trend-delta ${
                      deltaValue > 0 ? 'delta-up' : 'delta-down'
                    }`}
                  >
                    {deltaValue > 0 ? '+' : ''}
                    {deltaValue.toFixed(2)}
                  </span>
                )}
              </div>
            ) : (
              <span className="gpa-visuals-meta">
                {focusedTerm ? `${focusedTerm.termName}: ` : ''}No GPA points yet
              </span>
            )}
          </div>

          {gradedTermCount === 0 ? (
            <p className="gpa-visuals-empty">
              Enter grades in at least one credit-bearing non-Pass/Fail course to
              plot your term GPA progression.
            </p>
          ) : (
            <>
              <div
                className="gpa-svg-wrap"
                onMouseLeave={() => setHoveredTermId(null)}
              >
                <svg
                  viewBox="0 0 320 102"
                  className="gpa-trend-svg"
                  role="img"
                  aria-label={chartSummaryText}
                >
                  <defs>
                    <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(212, 68%, 24%)" stopOpacity="0.16" />
                      <stop offset="100%" stopColor="hsl(212, 68%, 24%)" stopOpacity="0.01" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal reference gridlines */}
                  {[
                    { val: yMax, y: yTop },
                    { val: yMid, y: (yTop + yBottom) / 2 },
                    { val: yMin, y: yBottom },
                  ].map((tick, idx) => (
                    <g key={idx}>
                      <line
                        x1={xLeft}
                        y1={tick.y}
                        x2={xRight}
                        y2={tick.y}
                        stroke={idx === 2 ? 'hsl(214, 18%, 78%)' : 'hsl(214, 20%, 88%)'}
                        strokeDasharray={idx === 2 ? undefined : '3,3'}
                        strokeWidth="1"
                      />
                      <text
                        x={xLeft - 6}
                        y={tick.y + 3}
                        textAnchor="end"
                        className="gpa-svg-axis-text"
                      >
                        {tick.val.toFixed(1)}
                      </text>
                    </g>
                  ))}

                  {/* Single-term reference guide */}
                  {gradedTermPoints.length === 1 && (
                    <line
                      x1={xLeft}
                      y1={gradedTermPoints[0].termY}
                      x2={xRight}
                      y2={gradedTermPoints[0].termY}
                      stroke="hsl(212, 54%, 34%)"
                      strokeDasharray="4,4"
                      strokeOpacity="0.45"
                      strokeWidth="1.25"
                    />
                  )}

                  {/* Area under Term GPA curve */}
                  {areaPath && <path d={areaPath} fill={`url(#${areaGradientId})`} />}

                  {/* Running Cumulative GPA dashed line (when 2+ graded terms) */}
                  {showCumulativeSeries && (
                    <polyline
                      fill="none"
                      stroke="hsl(168, 64%, 30%)"
                      strokeWidth="1.6"
                      strokeDasharray="4,3"
                      points={cumPolyline}
                    />
                  )}

                  {/* Term GPA primary solid line */}
                  {gradedTermPoints.length >= 2 && (
                    <polyline
                      fill="none"
                      stroke="hsl(212, 70%, 20%)"
                      strokeWidth="2.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={termPolyline}
                    />
                  )}

                  {/* Term data nodes + X-axis labels */}
                  {points.map((p) => {
                    const isFocused = focusedTerm?.termId === p.termId;
                    const cy = p.termY !== null ? p.termY : yBottom;
                    const showTickLabel =
                      points.length <= 7 ||
                      isFocused ||
                      p.idx === 0 ||
                      p.idx === points.length - 1 ||
                      p.idx % labelStep === 0;

                    return (
                      <g
                        key={p.termId}
                        className="gpa-svg-node"
                        onMouseEnter={() => setHoveredTermId(p.termId)}
                        onClick={() => {
                          setHoveredTermId(null);
                          onSelectTerm?.(p.termId);
                        }}
                      >
                        {p.termY !== null ? (
                          <circle
                            cx={p.x}
                            cy={cy}
                            r={isFocused ? 5.2 : 3.8}
                            fill={
                              isFocused
                                ? 'hsl(164, 72%, 27%)'
                                : 'hsl(212, 70%, 20%)'
                            }
                            stroke="#ffffff"
                            strokeWidth="1.75"
                          />
                        ) : (
                          <circle
                            cx={p.x}
                            cy={cy}
                            r={3.5}
                            fill="#ffffff"
                            stroke="hsl(215, 16%, 58%)"
                            strokeDasharray="2,2"
                            strokeWidth="1.4"
                          />
                        )}
                        {showTickLabel && (
                          <text
                            x={p.x}
                            y={95}
                            textAnchor="middle"
                            className={`gpa-svg-term-label ${
                              isFocused ? 'is-focused' : ''
                            }`}
                          >
                            {p.shortName}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="gpa-trend-footer">
                <div
                  className="gpa-trend-chips"
                  role="group"
                  aria-label="Inspect term GPA details"
                  onMouseLeave={() => setHoveredTermId(null)}
                >
                  {termSeries.map((t) => {
                    const isCurrent = focusedTerm?.termId === t.termId;
                    return (
                      <button
                        key={t.termId}
                        type="button"
                        className={`gpa-term-chip ${isCurrent ? 'active' : ''}`}
                        aria-pressed={isCurrent}
                        onMouseEnter={() => setHoveredTermId(t.termId)}
                        onFocus={() => setHoveredTermId(t.termId)}
                        onBlur={() => setHoveredTermId(null)}
                        onClick={() => {
                          setHoveredTermId(null);
                          onSelectTerm?.(t.termId);
                        }}
                      >
                        <span>{t.termName}</span>
                        <span className="tabular">
                          {t.termGpa !== null ? formatGpa(t.termGpa, 2) : '—'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {showCumulativeSeries ? (
                  <div className="gpa-chart-legend">
                    <span className="legend-item">
                      <span className="legend-swatch swatch-solid" aria-hidden="true" />
                      Term GPA
                    </span>
                    <span className="legend-item">
                      <span className="legend-swatch swatch-dashed" aria-hidden="true" />
                      Cumulative ({formatGpa(focusedTerm?.runningCumulativeGpa, 2)})
                    </span>
                  </div>
                ) : termSeries.length === 1 ? (
                  <span className="gpa-single-term-hint">
                    Add another term to compare term-over-term progression.
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* Card 2: Letter Grade Distribution */}
        <div className="gpa-visuals-card">
          <div className="gpa-visuals-card-head">
            <h2 className="gpa-visuals-title">Grade Distribution</h2>
            <span className="gpa-visuals-meta tabular">
              {gradedCourseCount} graded{' '}
              {gradedCourseCount === 1 ? 'course' : 'courses'}
              {gradedUnits > 0 ? ` · ${formatUnitsCompact(gradedUnits)} cr` : ''}
            </span>
          </div>

          {gradedCourseCount === 0 ? (
            <p className="gpa-visuals-empty">
              Enter at least one assessment score to see your course grade distribution.
            </p>
          ) : (
            <ul className="gpa-dist-list" aria-label="Course count by letter grade tier">
              {distribution.map((bucket) => (
                <li
                  key={bucket.key}
                  className={`gpa-dist-row ${bucket.count === 0 ? 'is-zero' : ''}`}
                  title={
                    bucket.count > 0
                      ? `${bucket.detailLabel} · ${formatUnitsCompact(
                          bucket.units,
                        )} credits`
                      : undefined
                  }
                >
                  <div className="gpa-dist-row-top">
                    <span className={`letter-badge ${bucket.tier} dist-tier-pill`}>
                      {bucket.label}
                    </span>
                    <span className="gpa-dist-stat tabular">
                      {bucket.count}{' '}
                      {bucket.count === 1 ? 'course' : 'courses'} ({bucket.roundedPct}
                      %)
                      {bucket.detailLabel ? (
                        <span className="sr-only"> — {bucket.detailLabel}</span>
                      ) : null}
                    </span>
                  </div>
                  <div className="gpa-dist-bar-track" aria-hidden="true">
                    <div
                      className={`gpa-dist-bar-fill ${bucket.tier}`}
                      style={{ width: `${Math.min(100, Math.max(0, bucket.sharePct))}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
