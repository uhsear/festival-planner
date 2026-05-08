import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import IconButton from './IconButton';

describe('IconButton', () => {
  const icon = <svg data-testid="test-icon" />;

  it('renders with aria-label', () => {
    render(<IconButton icon={icon} label="Close" />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('renders the icon inside the button', () => {
    render(<IconButton icon={icon} label="Close" />);
    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('sets title to label for tooltip', () => {
    render(<IconButton icon={icon} label="Close dialog" />);
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Close dialog');
  });

  it('defaults to type=button', () => {
    render(<IconButton icon={icon} label="Close" />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('respects explicit type prop', () => {
    render(<IconButton icon={icon} label="Submit" type="submit" />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('fires onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton icon={icon} label="Edit" onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  describe('variants', () => {
    it('applies default variant classes', () => {
      render(<IconButton icon={icon} label="Edit" />);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('text-text-muted');
      expect(btn.className).toContain('hover:text-text-primary');
    });

    it('applies danger variant classes', () => {
      render(<IconButton icon={icon} label="Delete" variant="danger" />);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('hover:text-accent-coral');
    });
  });

  describe('sizes', () => {
    it('applies md size (44x44) by default', () => {
      render(<IconButton icon={icon} label="Action" />);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('min-h-11');
      expect(btn.className).toContain('min-w-11');
    });

    it('applies sm size (WCAG AA minimum 44x44)', () => {
      render(<IconButton icon={icon} label="Action" size="sm" />);
      const btn = screen.getByRole('button');
      // Both sm and md use min-h-11 min-w-11 (44px) per WCAG 2.5.5
      expect(btn.className).toContain('min-h-11');
      expect(btn.className).toContain('min-w-11');
    });
  });

  it('applies custom className', () => {
    render(<IconButton icon={icon} label="Action" className="ml-2" />);
    expect(screen.getByRole('button').className).toContain('ml-2');
  });

  it('can be disabled', () => {
    render(<IconButton icon={icon} label="Action" disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<IconButton ref={ref} icon={icon} label="Ref" />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('has focus-visible outline classes', () => {
    render(<IconButton icon={icon} label="Focus" />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('focus-visible:outline-2');
    expect(btn.className).toContain('focus-visible:outline-accent-aqua');
  });
});
