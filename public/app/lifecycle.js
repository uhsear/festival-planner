/**
 * View lifecycle helper — tracks listeners, timers, and cleanup hooks so a
 * view's teardown() removes everything it attached. Fixes the chronic
 * addEventListener/removeEventListener asymmetry across views.
 *
 * Usage:
 *   import { lifecycle } from './lifecycle.js';
 *   const lc = lifecycle();
 *   lc.bind(window, 'resize', onResize);
 *   lc.timeout(() => {...}, 500);
 *   lc.onTeardown(() => socket.off('update', handler));
 *   // later:
 *   lc.teardown();
 */
export function lifecycle() {
  const cleanups = [];
  let tornDown = false;

  return {
    /** Attach a listener that will be removed on teardown. */
    bind(target, event, handler, opts) {
      if (tornDown || !target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(event, handler, opts);
      cleanups.push(() => {
        try { target.removeEventListener(event, handler, opts); } catch { /* noop */ }
      });
    },
    /** setTimeout that auto-clears on teardown. */
    timeout(fn, ms) {
      if (tornDown) return 0;
      const id = setTimeout(fn, ms);
      cleanups.push(() => clearTimeout(id));
      return id;
    },
    /** setInterval that auto-clears on teardown. */
    interval(fn, ms) {
      if (tornDown) return 0;
      const id = setInterval(fn, ms);
      cleanups.push(() => clearInterval(id));
      return id;
    },
    /** requestAnimationFrame that auto-cancels on teardown. */
    raf(fn) {
      if (tornDown) return 0;
      const id = requestAnimationFrame(fn);
      cleanups.push(() => cancelAnimationFrame(id));
      return id;
    },
    /** Register an arbitrary cleanup callback. */
    onTeardown(fn) {
      if (tornDown) { try { fn(); } catch { /* noop */ } return; }
      if (typeof fn === 'function') cleanups.push(fn);
    },
    /** Run and clear all cleanups. Safe to call twice. */
    teardown() {
      if (tornDown) return;
      tornDown = true;
      while (cleanups.length) {
        const fn = cleanups.pop();
        try { fn(); } catch (err) {
          // Keep going even if one cleanup throws.
          // eslint-disable-next-line no-console
          console.error('[lifecycle] cleanup error', err);
        }
      }
    },
    get isActive() { return !tornDown; },
    get size() { return cleanups.length; },
  };
}

export default lifecycle;
