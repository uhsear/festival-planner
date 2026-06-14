import { useEffect, type RefObject } from 'react';

/**
 * Adds WAI-ARIA roving-tabindex keyboard support to a `role="tablist"` container.
 *
 * - Arrow keys (Left/Right, or Up/Down when `vertical`) plus Home/End move focus
 *   between the `role="tab"` children.
 * - Selection follows focus (the newly focused tab is `.click()`ed), matching the
 *   common auto-activation tab pattern; each tab's own onClick performs the
 *   selection, so this hook stays decoupled from component state.
 * - Manages `tabIndex` so only the selected tab (`aria-selected="true"`) is in the
 *   Tab order; the rest are reachable via the arrow keys. Re-syncs when selection
 *   changes.
 *
 * Non-invasive: a consumer only needs to attach the ref to the tablist element —
 * no per-tab wiring. Reads the `aria-selected` the consumer already sets.
 */
export function useRovingTabs(containerRef: RefObject<HTMLElement | null>, vertical = false) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const tabs = () => Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]'));

    const syncTabIndex = () => {
      for (const t of tabs()) {
        t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
      }
    };
    syncTabIndex();

    const observer = new MutationObserver(syncTabIndex);
    observer.observe(el, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] });

    const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
    const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';

    const onKeyDown = (e: KeyboardEvent) => {
      const list = tabs();
      const current = list.indexOf(document.activeElement as HTMLElement);
      if (current === -1) return;
      let next = -1;
      if (e.key === nextKey) next = (current + 1) % list.length;
      else if (e.key === prevKey) next = (current - 1 + list.length) % list.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = list.length - 1;
      if (next === -1) return;
      e.preventDefault();
      const target = list[next];
      target?.focus();
      target?.click();
    };

    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('keydown', onKeyDown);
      observer.disconnect();
    };
  }, [containerRef, vertical]);
}
