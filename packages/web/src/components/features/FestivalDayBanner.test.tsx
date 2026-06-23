import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FestivalDayBanner from './FestivalDayBanner';

// Mock the dependencies
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

const mockSetFestivalMode = vi.fn();
vi.mock('@festie/shared/stores/festivalModeStore', () => ({
  useFestivalModeStore: (selector: (s: { setFestivalMode: typeof mockSetFestivalMode }) => unknown) =>
    selector({ setFestivalMode: mockSetFestivalMode }),
}));

vi.mock('../../hooks/useHaptics', () => ({
  useHaptics: () => ({
    tap: vi.fn(),
    select: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    isSupported: true,
  }),
}));

describe('FestivalDayBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('renders the banner with festival day text', () => {
    render(<FestivalDayBanner />);
    expect(screen.getByTestId('festival-day-banner')).toBeInTheDocument();
    expect(screen.getByText(/festival day/i)).toBeInTheDocument();
  });

  it('has an Enter Festival Mode button', () => {
    render(<FestivalDayBanner />);
    expect(screen.getByTestId('festival-day-banner-enter')).toBeInTheDocument();
    expect(screen.getByText('Enter Festival Mode')).toBeInTheDocument();
  });

  it('has a dismiss button', () => {
    render(<FestivalDayBanner />);
    expect(screen.getByTestId('festival-day-banner-close')).toBeInTheDocument();
  });

  it('dismisses the banner when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<FestivalDayBanner />);
    await user.click(screen.getByTestId('festival-day-banner-close'));
    expect(screen.queryByTestId('festival-day-banner')).not.toBeInTheDocument();
  });

  it('sets sessionStorage on dismiss', async () => {
    const user = userEvent.setup();
    render(<FestivalDayBanner />);
    await user.click(screen.getByTestId('festival-day-banner-close'));
    expect(sessionStorage.getItem('festie-fm-day-banner-dismissed')).toBe('true');
  });

  it('does not render if already dismissed in session', () => {
    sessionStorage.setItem('festie-fm-day-banner-dismissed', 'true');
    const { container } = render(<FestivalDayBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('activates festival mode and navigates on enter click', async () => {
    const user = userEvent.setup();
    render(<FestivalDayBanner />);
    await user.click(screen.getByText('Enter Festival Mode'));
    expect(mockSetFestivalMode).toHaveBeenCalledWith(true);
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/festival-mode' });
  });

  it('dismisses the banner after entering festival mode', async () => {
    const user = userEvent.setup();
    render(<FestivalDayBanner />);
    await user.click(screen.getByText('Enter Festival Mode'));
    expect(screen.queryByTestId('festival-day-banner')).not.toBeInTheDocument();
  });

  it('has role=status for accessibility', () => {
    render(<FestivalDayBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has accessible dismiss label', () => {
    render(<FestivalDayBanner />);
    expect(screen.getByLabelText('Dismiss festival day reminder')).toBeInTheDocument();
  });
});
