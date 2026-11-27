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

let openModalCount = 0;
let savedInertSnapshot = null;
let originTriggerElement = null;

/**
 * Accessible modal focus management (#41, #74, #75):
 * 1. Saves origin trigger element (`document.activeElement`) on first modal open and preserves it across modal-to-modal hand-offs.
 * 2. Marks background `.app-root` siblings (excluding `.modal-backdrop` and `.toast-live-region`) `inert` via a reference-counted snapshot so same-commit modal hand-offs never snapshot or restore stale `inert = true`.
 * 3. Moves initial focus inside `panelRef` (or `initialFocusSelector`, e.g. Cancel on destructive dialogs).
 * 4. Traps `Tab` and `Shift+Tab` cyclically inside `panelRef`.
 * 5. Restores focus to the non-inert origin trigger element once the last modal closes.
 */
export function useDialogFocus(panelRef, { initialFocusSelector = null } = {}) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof document === 'undefined') return undefined;

    if (openModalCount === 0) {
      if (!originTriggerElement) {
        const active = document.activeElement;
        originTriggerElement =
          active instanceof HTMLElement &&
          active !== document.body &&
          !active.closest('.modal-panel')
            ? active
            : null;
      }

      const backgroundSiblings = Array.from(
        document.querySelectorAll(
          '.app-root > :not(.modal-backdrop):not(.toast-live-region)',
        ),
      );
      savedInertSnapshot = backgroundSiblings.map((el) => ({
        el,
        inert: Boolean(el.inert),
      }));
      for (const { el } of savedInertSnapshot) {
        el.inert = true;
      }
    }
    openModalCount += 1;

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

      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0 && savedInertSnapshot) {
        for (const { el, inert } of savedInertSnapshot) {
          el.inert = inert;
        }
        savedInertSnapshot = null;
      }

      const hasMountedModal =
        document.querySelectorAll('.modal-backdrop').length > 0;
      if (!hasMountedModal && openModalCount === 0) {
        const targetToFocus = originTriggerElement;
        originTriggerElement = null;
        if (
          targetToFocus &&
          targetToFocus.isConnected &&
          !targetToFocus.inert &&
          !targetToFocus.closest('[inert]') &&
          !document.activeElement?.closest?.('.modal-panel')
        ) {
          targetToFocus.focus();
        }
      }
    };
  }, [panelRef, initialFocusSelector]);
}
