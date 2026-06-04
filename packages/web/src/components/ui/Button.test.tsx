import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from './Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('fires onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Press</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  describe('variants', () => {
    it('applies primary variant by default', () => {
      render(<Button>Primary</Button>);
      expect(screen.getByRole('button').className).toContain('bg-accent-aqua');
    });

    it('applies danger variant', () => {
      render(<Button variant="danger">Delete</Button>);
      expect(screen.getByRole('button').className).toContain('bg-accent-coral');
    });

    it('applies ghost variant', () => {
      render(<Button variant="ghost">Ghost</Button>);
      expect(screen.getByRole('button').className).toContain('bg-transparent');
    });

    it('applies secondary variant', () => {
      render(<Button variant="secondary">Secondary</Button>);
      expect(screen.getByRole('button').className).toContain('bg-bg-card');
    });

    it('applies outline variant', () => {
      render(<Button variant="outline">Outline</Button>);
      expect(screen.getByRole('button').className).toContain('bg-transparent');
      expect(screen.getByRole('button').className).toContain('border');
    });
  });

  describe('sizes', () => {
    it('applies sm size', () => {
      render(<Button size="sm">Small</Button>);
      expect(screen.getByRole('button').className).toContain('px-3');
      expect(screen.getByRole('button').className).toContain('text-sm');
    });

    it('applies md size by default', () => {
      render(<Button>Medium</Button>);
      expect(screen.getByRole('button').className).toContain('px-4');
      expect(screen.getByRole('button').className).toContain('text-base');
    });

    it('applies lg size', () => {
      render(<Button size="lg">Large</Button>);
      expect(screen.getByRole('button').className).toContain('px-5');
      expect(screen.getByRole('button').className).toContain('text-lg');
    });
  });

  describe('loading state', () => {
    it('disables button when loading', () => {
      render(<Button isLoading>Save</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('shows spinner icon when loading', () => {
      const { container } = render(<Button isLoading>Save</Button>);
      expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('still shows children text when loading', () => {
      render(<Button isLoading>Save</Button>);
      expect(screen.getByText('Save')).toBeInTheDocument();
    });
  });

  describe('disabled state', () => {
    it('disables button when disabled prop is true', () => {
      render(<Button disabled>Disabled</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('does not fire onClick when disabled', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        <Button disabled onClick={onClick}>
          Disabled
        </Button>,
      );
      await user.click(screen.getByRole('button'));
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  it('applies fullWidth class', () => {
    render(<Button fullWidth>Full</Button>);
    expect(screen.getByRole('button').className).toContain('w-full');
  });

  it('does not apply w-full by default', () => {
    render(<Button>Normal</Button>);
    expect(screen.getByRole('button').className).not.toContain('w-full');
  });

  it('applies custom className', () => {
    render(<Button className="extra">btn</Button>);
    expect(screen.getByRole('button').className).toContain('extra');
  });

  it('passes through HTML button attributes', () => {
    render(
      <Button type="submit" name="submit-btn">
        Submit
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('type', 'submit');
    expect(btn).toHaveAttribute('name', 'submit-btn');
  });
});
