import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LiveBadge from './LiveBadge';

describe('LiveBadge', () => {
  it('renders LIVE status with coralStrong styling', () => {
    render(<LiveBadge status="live" label="LIVE" />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    const wrapper = screen.getByLabelText('Live');
    // R6: live uses coralStrong (#c01d3a) fill, not plain coral
    expect(wrapper.className).toContain('bg-[#c01d3a]');
  });

  it('renders soon status with aqua fill (R6 NOW PLAYING)', () => {
    render(<LiveBadge status="soon" label="In 15m" />);
    expect(screen.getByText('In 15m')).toBeInTheDocument();
    const wrapper = screen.getByLabelText('Starting soon');
    // R6: NOW PLAYING uses aqua fill + dark ink
    expect(wrapper.className).toContain('bg-accent-aqua');
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
    // R6: coralStrong fill uses dark-ink dot (#080810) for AA contrast.
    expect(dot!.className).toContain('bg-[#080810]');
  });

  it('has a dot for soon status (R6 NOW PLAYING)', () => {
    const { container } = render(<LiveBadge status="soon" label="In 5m" />);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();
    // R6: aqua fill uses dark-ink dot (#0a0a0a) for AA contrast.
    expect(dot!.className).toContain('bg-[#0a0a0a]');
  });

  it('does not render a dot for upcoming status', () => {
    const { container } = render(<LiveBadge status="upcoming" label="In 1h" />);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeNull();
  });
});
