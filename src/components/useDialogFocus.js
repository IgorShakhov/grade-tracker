import { useEffect } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => el instanceof HTMLElement && !el.hasAttribute('disabled'),
  );
}

/**
 * Accessible modal focus management (#41):
 * 1. Saves trigger element (`document.activeElement`) on open.
 * 2. Marks background `.app-root` siblings `inert` while modal is open.
 * 3. Moves initial focus inside `panelRef` (or `initialFocusSelector`, e.g. Cancel on destructive dialogs).
 * 4. Traps `Tab` and `Shift+Tab` cyclically inside `panelRef`.
 * 5. Restores focus to the trigger element on close unless another modal took focus.
 */
export function useDialogFocus(panelRef, { initialFocusSelector = null } = {}) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof document === 'undefined') return undefined;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;

    const backgroundSiblings = Array.from(
      document.querySelectorAll('.app-root > :not(.modal-backdrop)'),
    );
    const prevInertStates = backgroundSiblings.map((el) => ({
      el,
      inert: Boolean(el.inert),
    }));
    for (const { el } of prevInertStates) {
      el.inert = true;
    }

    const preferredTarget = initialFocusSelector
      ? panel.querySelector(initialFocusSelector)
      : null;
    if (
      preferredTarget instanceof HTMLElement &&
      !preferredTarget.hasAttribute('disabled')
    ) {
      preferredTarget.focus();
    } else {
      const focusables = getFocusableElements(panel);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        panel.focus();
      }
    }

    function handleKeyDown(e) {
      if (e.key !== 'Tab') return;
      const currentPanel = panelRef.current;
      if (!currentPanel) return;

      const focusables = getFocusableElements(currentPanel);
      if (focusables.length === 0) {
        e.preventDefault();
        currentPanel.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (!currentPanel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);

      const stillHasOpenModal =
        document.querySelectorAll('.modal-backdrop').length > 0;
      if (!stillHasOpenModal) {
        for (const { el, inert } of prevInertStates) {
          el.inert = inert;
        }
      }

      if (
        previouslyFocused &&
        previouslyFocused.isConnected &&
        !document.activeElement?.closest?.('.modal-panel')
      ) {
        previouslyFocused.focus();
      }
    };
  }, [panelRef, initialFocusSelector]);
}
