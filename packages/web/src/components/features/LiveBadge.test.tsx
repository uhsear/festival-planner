import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LiveBadge from './LiveBadge';

describe('LiveBadge', () => {
  it('renders LIVE status with coral styling', () => {
    render(<LiveBadge status="live" label="LIVE" />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    const wrapper = screen.getByLabelText('Live');
    expect(wrapper.className).toContain('bg-accent-coral');
  });

  it('renders soon status with amber styling', () => {
    render(<LiveBadge status="soon" label="In 15m" />);
    expect(screen.getByText('In 15m')).toBeInTheDocument();
    const wrapper = screen.getByLabelText('Starting soon');
    expect(wrapper.className).toContain('bg-accent-amber/20');
  });

  it('renders upcoming status with aqua styling', () => {
    render(<LiveBadge status="upcoming" label="In 1h" />);
    expect(screen.getByText('In 1h')).toBeInTheDocument();
  });

  it('renders past status with muted styling', () => {
    render(<LiveBadge status="past" label="Ended" />);
    expect(screen.getByText('Ended')).toBeInTheDocument();
  });

  it('renders tba status', () => {
    render(<LiveBadge status="tba" label="TBA" />);
    expect(screen.getByText('TBA')).toBeInTheDocument();
  });

  it('renders later status', () => {
    render(<LiveBadge status="later" label="2:00 PM" />);
    expect(screen.getByText('2:00 PM')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<LiveBadge status="live" label="LIVE" className="my-class" />);
    const wrapper = screen.getByLabelText('Live');
    expect(wrapper.className).toContain('my-class');
  });

  it('has a pulsing dot for live status', () => {
    const { container } = render(<LiveBadge status="live" label="LIVE" />);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();
    // Live badge now uses a solid coral fill, so the pulsing dot is white for
    // contrast against that fill.
    expect(dot!.className).toContain('bg-white');
  });

  it('has a dot for soon status', () => {
    const { container } = render(<LiveBadge status="soon" label="In 5m" />);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();
    expect(dot!.className).toContain('bg-accent-amber');
  });

  it('does not render a dot for upcoming status', () => {
    const { container } = render(<LiveBadge status="upcoming" label="In 1h" />);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeNull();
  });
});
