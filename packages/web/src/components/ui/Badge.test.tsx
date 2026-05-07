import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge from './Badge';

describe('Badge', () => {
  it('renders children text', () => {
    render(<Badge>3 picks</Badge>);
    expect(screen.getByText('3 picks')).toBeInTheDocument();
  });

  it('renders as a span element', () => {
    render(<Badge>test</Badge>);
    expect(screen.getByText('test').tagName).toBe('SPAN');
  });

  it('defaults to count variant', () => {
    render(<Badge>5</Badge>);
    const el = screen.getByText('5');
    expect(el.className).toContain('bg-accent-coral/20');
  });

  it('applies must variant styling', () => {
    render(<Badge variant="must">Must</Badge>);
    const el = screen.getByText('Must');
    expect(el.className).toContain('badge-must');
  });

  it('applies want variant styling', () => {
    render(<Badge variant="want">Want</Badge>);
    const el = screen.getByText('Want');
    expect(el.className).toContain('badge-want');
  });

  it('applies maybe variant styling', () => {
    render(<Badge variant="maybe">Maybe</Badge>);
    const el = screen.getByText('Maybe');
    expect(el.className).toContain('badge-maybe');
  });

  it('applies online variant styling', () => {
    render(<Badge variant="online">Online</Badge>);
    const el = screen.getByText('Online');
    expect(el.className).toContain('bg-accent-green/20');
  });

  it('applies offline variant styling', () => {
    render(<Badge variant="offline">Offline</Badge>);
    const el = screen.getByText('Offline');
    expect(el.className).toContain('bg-text-muted/20');
  });

  it('applies outline variant styling', () => {
    render(<Badge variant="outline">Info</Badge>);
    const el = screen.getByText('Info');
    expect(el.className).toContain('bg-transparent');
  });

  it('applies custom className', () => {
    render(<Badge className="ml-2">badge</Badge>);
    const el = screen.getByText('badge');
    expect(el.className).toContain('ml-2');
  });

  it('applies custom style prop', () => {
    render(<Badge style={{ marginLeft: '8px' }}>styled</Badge>);
    const el = screen.getByText('styled');
    expect(el).toHaveStyle({ marginLeft: '8px' });
  });

  it('always has base layout classes', () => {
    render(<Badge>base</Badge>);
    const el = screen.getByText('base');
    expect(el.className).toContain('inline-flex');
    expect(el.className).toContain('items-center');
    expect(el.className).toContain('rounded-full');
    expect(el.className).toContain('text-xs');
    expect(el.className).toContain('font-medium');
  });

  it('renders React node children', () => {
    render(
      <Badge>
        <span data-testid="inner">icon</span> text
      </Badge>,
    );
    expect(screen.getByTestId('inner')).toBeInTheDocument();
  });
});
