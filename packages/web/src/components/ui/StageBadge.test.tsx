import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StageBadge, { getStageBadgeStyle } from './StageBadge';

describe('StageBadge', () => {
  it('renders the stage name', () => {
    render(<StageBadge stageName="Main Stage" stageColor="#ff3366" />);
    expect(screen.getByText('Main Stage')).toBeInTheDocument();
  });

  it('renders a span with the stage name as text', () => {
    render(<StageBadge stageName="Sahara" stageColor="#00aaff" />);
    const badge = screen.getByText('Sahara');
    expect(badge.tagName).toBe('SPAN');
  });

  it('applies default variant class', () => {
    render(<StageBadge stageName="Main" stageColor="#ff0000" />);
    const badge = screen.getByText('Main');
    expect(badge.className).toContain('rounded-full');
    expect(badge.className).toContain('uppercase');
  });

  it('applies chip variant class', () => {
    render(<StageBadge stageName="Main" stageColor="#ff0000" variant="chip" />);
    const badge = screen.getByText('Main');
    expect(badge.className).toContain('rounded-full');
    expect(badge.className).toContain('cursor-pointer');
  });

  it('applies pick variant class', () => {
    render(<StageBadge stageName="Main" stageColor="#ff0000" variant="pick" />);
    const badge = screen.getByText('Main');
    expect(badge.className).toContain('rounded-full');
    expect(badge.className).toContain('font-bold');
  });

  it('adds active styling for active chip variant', () => {
    render(
      <StageBadge stageName="Main" stageColor="#ff0000" variant="chip" active />,
    );
    const badge = screen.getByText('Main');
    expect(badge.className).toContain('border-current');
  });

  it('does not add active styling for inactive chip', () => {
    render(
      <StageBadge
        stageName="Main"
        stageColor="#ff0000"
        variant="chip"
        active={false}
      />,
    );
    const badge = screen.getByText('Main');
    expect(badge.className).not.toContain('border-current');
  });

  it('applies custom className', () => {
    render(
      <StageBadge stageName="Test" stageColor="#000" className="my-custom" />,
    );
    const badge = screen.getByText('Test');
    expect(badge.className).toContain('my-custom');
  });

  it('applies custom style', () => {
    render(
      <StageBadge
        stageName="Test"
        stageColor="#000"
        style={{ marginLeft: '4px' }}
      />,
    );
    const badge = screen.getByText('Test');
    expect(badge).toHaveStyle({ marginLeft: '4px' });
  });

  it('renders as a span element', () => {
    render(<StageBadge stageName="Test" stageColor="#000" />);
    expect(screen.getByText('Test').tagName).toBe('SPAN');
  });
});

describe('getStageBadgeStyle', () => {
  it('returns white text for default variant', () => {
    const style = getStageBadgeStyle('#ff3366');
    expect(style.color).toBe('#fff');
    expect(style.fontWeight).toBe(700);
  });

  it('returns faded style for inactive chip', () => {
    const style = getStageBadgeStyle('#ff3366', 'chip', false);
    expect(style.color).toBe('#ff3366');
    expect(style.borderColor).toBe('transparent');
    expect(style.background).toContain('#ff3366');
    expect(style.background).toContain('20'); // alpha hex suffix
  });

  it('returns solid style for active chip', () => {
    const style = getStageBadgeStyle('#ff3366', 'chip', true);
    expect(style.color).toBe('#fff');
    expect(style.fontWeight).toBe(700);
  });

  it('darkens light colors to maintain white contrast', () => {
    // Pure white would need significant darkening
    const style = getStageBadgeStyle('#ffffff');
    expect(style.background).not.toBe('#ffffff');
    expect(style.color).toBe('#fff');
  });

  it('preserves already-dark colors', () => {
    const style = getStageBadgeStyle('#000000');
    expect(style.background).toBe('#000000');
    expect(style.color).toBe('#fff');
  });

  it('handles 3-digit hex', () => {
    const style = getStageBadgeStyle('#f36');
    expect(style.color).toBe('#fff');
    expect(style.background).toBeTruthy();
  });

  it('handles invalid hex gracefully', () => {
    const style = getStageBadgeStyle('not-a-color');
    expect(style.background).toBe('not-a-color');
    expect(style.color).toBe('#fff');
  });

  it('returns text-shadow for accessibility', () => {
    const style = getStageBadgeStyle('#ff3366');
    expect(style.textShadow).toContain('rgba(0, 0, 0');
  });
});
