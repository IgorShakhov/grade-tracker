import { formatGpa, formatLastUpdated } from '../domain/calculations.js';

export default function GradeScaleCard({
  gradeScale,
  lastUpdated,
  readOnly,
  onOpenScaleEditor,
}) {
  return (
    <aside className="scale-sidebar" aria-label="Grading Scale Reference">
      <div className="scale-card">
        <div className="scale-card-header">
          <h2 className="scale-card-title">Grading Scale</h2>
          {!readOnly && (
            <button
              id="customize-scale-btn"
              type="button"
              className="scale-edit-btn"
              onClick={onOpenScaleEditor}
            >
              Customize
            </button>
          )}
        </div>

        <table className="scale-table">
          <thead>
            <tr>
              <th scope="col">Grade Range</th>
              <th scope="col">Letter</th>
              <th scope="col">Grade Point</th>
            </tr>
          </thead>
          <tbody>
            {gradeScale.map((row, idx) => (
              <tr key={`${row.letter}-${row.min}-${idx}`}>
                <td className="tabular">
                  {row.rangeLabel || `${row.min}–${row.max}%`}
                </td>
                <td className="tabular">{row.letter}</td>
                <td className="tabular">{formatGpa(row.gpa, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="scale-updated-footer">
          Last Update: {formatLastUpdated(lastUpdated)}
        </div>
      </div>

      <div className="quick-tips-card">
        <h3>How Running Grades Work</h3>
        <p>
          Blank assessment rows don&apos;t lower your running course grade yet — only
          graded weights count until remaining marks come in. Turn on{' '}
          <strong>What-If Simulator</strong> to test hypothetical exam scores safely.
        </p>
      </div>
    </aside>
  );
}
