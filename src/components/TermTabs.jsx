import { useState } from 'react';

export default function TermTabs({
  terms,
  activeTermId,
  readOnly,
  allCollapsed,
  hasCourses,
  onSelectTerm,
  onAddTerm,
  onRenameTerm,
  onDeleteTerm,
  onToggleCollapseAll,
}) {
  const [editingTermId, setEditingTermId] = useState(null);
  const [draftName, setDraftName] = useState('');

  function startEditing(term) {
    if (readOnly) return;
    setEditingTermId(term.id);
    setDraftName(term.name);
  }

  function commitRename(termId) {
    const trimmed = draftName.trim();
    if (trimmed) {
      onRenameTerm(termId, trimmed);
    }
    setEditingTermId(null);
  }

  return (
    <div className="terms-bar">
      <div className="term-tabs" role="tablist" aria-label="Academic Terms">
        {terms.map((term) => {
          const isActive = term.id === activeTermId;
          const isEditing = editingTermId === term.id;

          return (
            <div
              key={term.id}
              className={`term-tab-wrap ${isActive ? 'active' : ''}`}
            >
              {isEditing ? (
                <input
                  type="text"
                  className="term-inline-input"
                  value={draftName}
                  autoFocus
                  aria-label="Term name"
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => commitRename(term.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(term.id);
                    if (e.key === 'Escape') setEditingTermId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className="term-tab-btn"
                  onClick={() => onSelectTerm(term.id)}
                  onDoubleClick={() => startEditing(term)}
                  title={readOnly ? term.name : 'Click to switch, double-click to rename'}
                >
                  {term.name}
                </button>
              )}

              {!readOnly && isActive && !isEditing && (
                <>
                  <button
                    type="button"
                    className="term-mini-btn"
                    onClick={() => startEditing(term)}
                    title="Rename term"
                    aria-label={`Rename ${term.name}`}
                  >
                    ✎
                  </button>
                  {terms.length > 1 && (
                    <button
                      type="button"
                      className="term-mini-btn"
                      onClick={() => onDeleteTerm(term.id)}
                      title="Delete term"
                      aria-label={`Delete ${term.name}`}
                    >
                      ×
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}

        {!readOnly && (
          <button
            id="add-term-btn"
            type="button"
            className="btn btn-sm"
            onClick={onAddTerm}
          >
            + Add Term
          </button>
        )}
      </div>

      {hasCourses && (
        <div className="term-right-controls">
          <button
            id="toggle-collapse-all-btn"
            type="button"
            className="btn btn-sm"
            onClick={onToggleCollapseAll}
          >
            {allCollapsed ? 'Expand All Courses' : 'Collapse All Courses'}
          </button>
        </div>
      )}
    </div>
  );
}
