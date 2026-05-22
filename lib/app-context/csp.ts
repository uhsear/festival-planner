/**
 * CSP module — centralises `buildContentSecurityPolicy` and
 * `collectInlineHashes`. Both are re-exported from `lib/helpers.js`; we
 * keep them together here because the (optional) inline-hash map and
 * its readers share module-level state. Moving either without the other
 * would fracture that state.
 *
 * This module is intentionally a thin wrapper: the authoritative
 * implementations still live in `lib/helpers.js` so all existing call
 * sites (tests, helpers consumers) keep working byte-identically.
 */
import {
  collectInlineHashes,
  buildContentSecurityPolicy,
} from '../helpers';

/**
 * Build the two CSP policies used by the app (main + export renderer).
 * Both use the same inline-hash set collected from PUBLIC_DIR.
 */
function buildCspPolicies(config: any) {
  const inlineHashes = collectInlineHashes(config.PUBLIC_DIR);
  const contentSecurityPolicy = buildContentSecurityPolicy(config, inlineHashes, { allowStyleAttributes: true });
  const exportContentSecurityPolicy = buildContentSecurityPolicy(config, inlineHashes, { allowStyleAttributes: true });
  return { inlineHashes, contentSecurityPolicy, exportContentSecurityPolicy };
}

export {
  buildCspPolicies,
  buildContentSecurityPolicy,
  collectInlineHashes,
};
