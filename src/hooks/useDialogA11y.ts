import { useEffect, useRef } from 'react';

/**
 * Focusable elements inside a dialog (the same selector set browsers use
 * for sequential keyboard navigation, minus disabled/hidden controls).
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), ' +
  'select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog accessibility behaviour (see UI_Design_Notes.md §1 and §7).
 *
 * Every modal dialog should:
 *   1. close on `Escape` (handled here so no dialog needs its own listener),
 *   2. trap the Tab key inside its panel while it is open,
 *   3. hand focus back to whatever element opened it.
 *
 * Initial focus is intentionally *not* owned here: each dialog already
 * moves focus to its most useful control (title input / search field /
 * quick-add input) on mount.
 *
 * @param onClose closes the dialog (stable reference preferred; a fresh
 *   closure each render works — the listener always re-attaches to it).
 * @returns a ref to attach to the dialog panel (the `.dialog` element).
 */
export function useDialogA11y<T extends HTMLElement>(onClose: () => void) {
  const panelRef = useRef<T | null>(null);

  useEffect(() => {
    const panel = panelRef.current;
    // Remember who opened us so focus can be handed back on unmount.
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        // Nothing to move to — keep focus on the panel itself.
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // If focus is still inside the (now unmounted) dialog, it would drop
      // to <body> — hand it back to the opener instead.
      if (previousFocus && (!document.activeElement || document.activeElement === document.body)) {
        previousFocus.focus();
      }
    };
  }, [onClose]);

  return panelRef;
}
