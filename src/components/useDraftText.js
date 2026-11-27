import { useState, useEffect, useRef } from 'react';

/**
 * Controlled draft state for normalized text inputs (`studentName`, `course.code`)
 * so users can type spaces naturally (e.g. "Jane Doe", "MATH 101") and clear an input
 * to "" mid-edit without snapping back or triggering validation throws (#33, #34).
 */
export function useDraftText(committedValue, { onCommit, fallbackOnEmpty }) {
  const [draft, setDraft] = useState(null);
  const lastCommittedByInputRef = useRef(committedValue);
  const focusInitialRef = useRef(null);

  useEffect(() => {
    if (committedValue !== lastCommittedByInputRef.current) {
      lastCommittedByInputRef.current = committedValue;
      setDraft(null);
    }
  }, [committedValue]);

  const value = draft !== null ? draft : committedValue;

  function onFocus() {
    focusInitialRef.current = committedValue;
    if (draft === null) {
      setDraft(committedValue);
    }
  }

  function onChange(e) {
    const raw = e.target.value;
    if (focusInitialRef.current === null) {
      focusInitialRef.current = committedValue;
    }
    setDraft(raw);
    const trimmed = raw.trim();
    if (trimmed !== '') {
      lastCommittedByInputRef.current = trimmed;
      if (trimmed !== committedValue) {
        onCommit(trimmed);
      }
    }
  }

  function onBlur() {
    const raw = draft !== null ? draft : committedValue;
    const trimmed = raw.trim();
    const fallback =
      typeof fallbackOnEmpty === 'function'
        ? fallbackOnEmpty(focusInitialRef.current, committedValue)
        : fallbackOnEmpty;
    const resolved = trimmed !== '' ? trimmed : fallback;
    focusInitialRef.current = null;
    setDraft(null);
    lastCommittedByInputRef.current = resolved;
    if (resolved !== committedValue) {
      onCommit(resolved);
    }
  }

  return { value, onFocus, onChange, onBlur };
}
