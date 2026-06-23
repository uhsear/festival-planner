import { useEffect, useCallback, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

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

      const focusable =
        containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
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
      const first =
        containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      first?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      previouslyFocused?.focus();
    };
  }, [isActive, containerRef]);
}
