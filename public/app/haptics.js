/**
 * Haptic feedback helpers.
 * iOS Safari does not support the Vibration API; calls become no-ops there.
 * Respects prefers-reduced-motion.
 */
const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

function vib(pattern) {
  if (prefersReducedMotion.matches) return;
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch { /* ignore */ }
}

export const haptics = {
  /** light tap — confirm a tap landed */
  tap:     () => vib(8),
  /** selection change — e.g. pick level toggle */
  select:  () => vib(12),
  /** success — pick committed, crew joined, reminder set */
  success: () => vib([6, 30, 12]),
  /** warning — rate-limited, soft error */
  warn:    () => vib([20, 20, 20]),
  /** error — destructive or failed operation */
  error:   () => vib([40, 20, 40]),
};

// Also expose on window for non-module call sites
if (typeof window !== 'undefined') {
  window.__haptics = haptics;
}

export default haptics;
