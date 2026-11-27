import { useState, useRef } from 'react';

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
  const tabRefs = useRef(new Map());

  const activeTerm = terms.find((t) => t.id === activeTermId) || terms[0];

  function startEditing(term) {
    if (readOnly || !term) return;
    setEditingTermId(term.id);
    setDraftName(term.name);
  }

  function commitRename(termId) {
    const trimmed = draftName.trim();
    const existing = terms.find((t) => t.id === termId);
    if (trimmed && (!existing || existing.name !== trimmed)) {
      onRenameTerm(termId, trimmed);
    }
    setEditingTermId(null);
  }

  function handleTabKeyDown(e, index, term) {
    if (e.key === 'F2' && !readOnly) {
      e.preventDefault();
      startEditing(term);
      return;
    }
    if (terms.length <= 1) return;

    let nextIdx = null;
    if (e.key === 'ArrowRight') {
      nextIdx = (index + 1) % terms.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = (index - 1 + terms.length) % terms.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = terms.length - 1;
    }

    if (nextIdx !== null) {
      e.preventDefault();
      const targetTerm = terms[nextIdx];
      onSelectTerm(targetTerm.id);
      const btn = tabRefs.current.get(targetTerm.id);
      if (btn) btn.focus();
    }
  }

  return (
    <div className="terms-bar">
      <div className="term-tabs">
        <div className="term-tablist" role="tablist" aria-label="Academic Terms">
          {terms.map((term, index) => {
            const isActive = term.id === activeTerm?.id;
            return (
              <button
                key={term.id}
                ref={(el) => {
                  if (el) {
                    tabRefs.current.set(term.id, el);
                  } else {
                    tabRefs.current.delete(term.id);
                  }
                }}
                id={`term-tab-${term.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="active-term-tabpanel"
                tabIndex={isActive ? 0 : -1}
                className={`term-tab-btn ${isActive ? 'is-active' : ''}`}
                onClick={() => onSelectTerm(term.id)}
                onDoubleClick={() => startEditing(term)}
                onKeyDown={(e) => handleTabKeyDown(e, index, term)}
                title={
                  readOnly
                    ? term.name
                    : 'Click to switch, Arrow keys to navigate, double-click or F2 to rename'
                }
              >
                {term.name}
              </button>
            );
          })}
        </div>

        {!readOnly && activeTerm && editingTermId === activeTerm.id && (
          <input
            type="text"
            className="term-inline-input"
            value={draftName}
            autoFocus
            aria-label="Term name"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => commitRename(activeTerm.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(activeTerm.id);
              if (e.key === 'Escape') setEditingTermId(null);
            }}
          />
        )}

        {!readOnly && activeTerm && editingTermId !== activeTerm.id && (
          <div className="term-active-actions" role="group" aria-label="Active term actions">
            <button
              type="button"
              className="term-mini-btn"
              onClick={() => startEditing(activeTerm)}
              title="Rename active term (F2)"
              aria-label={`Rename ${activeTerm.name}`}
            >
              ✎
            </button>
            {terms.length > 1 && (
              <button
                type="button"
                className="term-mini-btn"
                onClick={() => onDeleteTerm(activeTerm.id)}
                title="Delete active term"
                aria-label={`Delete ${activeTerm.name}`}
              >
                ×
              </button>
            )}
          </div>
        )}

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
