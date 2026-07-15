import type { TestRunnerConfig } from '@storybook/test-runner';
import { getStoryContext } from '@storybook/test-runner';
import { injectAxe, configureAxe, getViolations } from 'axe-playwright';

/**
 * CI a11y enforcement for Storybook stories.
 *
 * The `@storybook/addon-a11y` addon already runs axe inside the Storybook UI so
 * authors *see* violations while developing. This test-runner hook is what makes
 * a PR actually FAIL on them: axe is injected on every story and the run throws
 * on `serious` + `critical` WCAG violations. `minor`/`moderate` are logged for
 * triage but do not fail yet — tighten `GATE` once the tail is clean.
 *
 * Each story's own `parameters.a11y` (disable + rule overrides) is honoured, so
 * a story can opt out or relax a specific rule the same way it does in the UI.
 */
const GATE = new Set(['serious', 'critical']);

const config: TestRunnerConfig = {
  async preVisit(page) {
    await injectAxe(page);
  },
  async postVisit(page, context) {
    const storyContext = await getStoryContext(page, context);
    const a11y = storyContext.parameters?.a11y as
      | { disable?: boolean; config?: { rules?: unknown }; options?: unknown }
      | undefined;
    if (a11y?.disable) return;

    await configureAxe(page, { rules: a11y?.config?.rules as never });
    const violations = await getViolations(page, '#storybook-root', a11y?.options as never);

    if (violations.length) {
      const summary = violations.map((v) => `${v.id}(${v.impact}, ${v.nodes.length})`).join(', ');
      // eslint-disable-next-line no-console
      console.log(`[a11y] ${context.id}: ${summary}`);
    }

    const gating = violations.filter((v) => GATE.has(v.impact ?? ''));
    if (gating.length) {
      throw new Error(
        `[a11y] ${context.id}: ${gating.length} serious/critical violation(s) — ${gating
          .map((v) => v.id)
          .join(', ')}`,
      );
    }
  },
};

export default config;
