import { useEffect, useCallback, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Collect focusable, visible children in DOM order. `:not([disabled])` above
// drops disabled controls; the offsetParent/getClientRects filter drops
// display:none / hidden nodes so Tab wrap + initial focus never land on an
// invisible element. ponytail: jsdom has no layout (offsetParent always null),
// so fall back to the unfiltered list there — real browsers still filter.
function getFocusable(container: HTMLElement): HTMLElement[] {
  const all = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const visible = all.filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
  return visible.length > 0 ? visible : all;
}

/**
 * Traps keyboard focus inside a container while it is active.
 *
 * - Closes on Escape via the provided `onClose` callback.
 * - Wraps Tab / Shift+Tab so focus cycles within the container.
 * - Moves initial focus to the first focusable child on mount.
 * - Returns focus to the previously-focused element on unmount.
 */
export function useKeyboardTrap(
  containerRef: RefObject<HTMLElement | null>,
  isActive: boolean,
  onClose: () => void,
) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !containerRef.current) return;

      const focusable = getFocusable(containerRef.current);
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [containerRef, onClose],
  );

  // Attach / detach the keydown listener
  useEffect(() => {
    if (!isActive) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, handleKeyDown]);

  // Move focus into the container on activation, restore on deactivation
  useEffect(() => {
    if (!isActive) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Delay one frame so the container's children are rendered
    const raf = requestAnimationFrame(() => {
      if (containerRef.current) getFocusable(containerRef.current)[0]?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      previouslyFocused?.focus();
    };
  }, [isActive, containerRef]);
}
