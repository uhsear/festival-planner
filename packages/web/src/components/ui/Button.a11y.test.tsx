import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Button from './Button';

// Structural accessibility (sa11y/axe on jsdom) for the shared Button. Proves the
// matcher is wired and guards the primitive most other UI composes from. jsdom
// omits contrast/layout rules — those are covered by the Storybook + e2e axe gates.
describe('Button — accessibility', () => {
  it('has no structural a11y violations across variants', async () => {
    const { container } = render(
      <div>
        <Button>Save</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="ghost">Cancel</Button>
        <Button disabled>Disabled</Button>
      </div>,
    );
    await expect(container).toBeAccessible();
  });

  it('an icon-only button exposes an accessible name', async () => {
    const { container } = render(
      <Button aria-label="Close" icon={<span aria-hidden="true">×</span>} />,
    );
    await expect(container).toBeAccessible();
  });
});
