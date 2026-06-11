import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Avatar from './Avatar';

describe('Avatar', () => {
  describe('fallback (no image)', () => {
    it('renders initials from name', () => {
      render(<Avatar name="Jane Doe" />);
      expect(screen.getByText('JD')).toBeInTheDocument();
    });

    it('defaults to "User" when no name is provided', () => {
      render(<Avatar />);
      expect(screen.getByText('U')).toBeInTheDocument();
    });

    it('handles empty string name', () => {
      render(<Avatar name="" />);
      expect(screen.getByText('U')).toBeInTheDocument();
    });

    it('handles undefined name', () => {
      render(<Avatar name={undefined} />);
      expect(screen.getByText('U')).toBeInTheDocument();
    });

    it('applies a deterministic background color', () => {
      const { container } = render(<Avatar name="Alice" />);
      const initialsDiv = container.querySelector('div[style]');
      expect(initialsDiv).toBeInTheDocument();
      expect(initialsDiv?.getAttribute('style')).toContain('background-color');
    });

    it('renders single-word name initial', () => {
      render(<Avatar name="Madonna" />);
      expect(screen.getByText('M')).toBeInTheDocument();
    });
  });

  describe('image mode', () => {
    it('renders img when image prop is provided', () => {
      render(<Avatar name="Jane Doe" image="/avatar.jpg" />);
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', '/avatar.jpg');
      expect(img).toHaveAttribute('alt', 'Jane Doe');
    });

    it('sets width and height attributes for CLS prevention', () => {
      render(<Avatar name="Jane Doe" image="/avatar.jpg" size="md" />);
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('width', '40');
      expect(img).toHaveAttribute('height', '40');
    });

    it('applies lazy loading', () => {
      render(<Avatar name="Jane Doe" image="/avatar.jpg" />);
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('loading', 'lazy');
    });

    it('applies correct dimensions per size', () => {
      const { rerender } = render(<Avatar name="J" image="/a.jpg" size="xs" />);
      expect(screen.getByRole('img')).toHaveAttribute('width', '24');

      rerender(<Avatar name="J" image="/a.jpg" size="sm" />);
      expect(screen.getByRole('img')).toHaveAttribute('width', '32');

      rerender(<Avatar name="J" image="/a.jpg" size="lg" />);
      expect(screen.getByRole('img')).toHaveAttribute('width', '56');
    });
  });

  describe('online indicator', () => {
    it('does not show online dot by default', () => {
      const { container } = render(<Avatar name="Jane" />);
      const dots = container.querySelectorAll('.rounded-full.border-2');
      expect(dots.length).toBe(0);
    });

    it('shows online dot when showOnline is true and isOnline is true', () => {
      const { container } = render(<Avatar name="Jane" showOnline isOnline />);
      // R6: online dot is aqua, not green — accent rule: aqua = primary/positive.
      const dot = container.querySelector('.bg-accent-aqua');
      expect(dot).toBeInTheDocument();
    });

    it('shows offline dot when showOnline is true and isOnline is false', () => {
      const { container } = render(<Avatar name="Jane" showOnline isOnline={false} />);
      const dot = container.querySelector('.bg-text-muted');
      expect(dot).toBeInTheDocument();
    });
  });

  describe('sizes', () => {
    it('applies xs size class', () => {
      const { container } = render(<Avatar name="A" size="xs" />);
      const el = container.querySelector('.w-6');
      expect(el).toBeInTheDocument();
    });

    it('applies lg size class', () => {
      const { container } = render(<Avatar name="A" size="lg" />);
      const el = container.querySelector('.w-14');
      expect(el).toBeInTheDocument();
    });
  });

  it('applies custom className to wrapper', () => {
    const { container } = render(<Avatar name="A" className="my-class" />);
    expect(container.firstElementChild?.className).toContain('my-class');
  });
});
