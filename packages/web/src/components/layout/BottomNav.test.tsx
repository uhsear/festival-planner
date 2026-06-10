import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BottomNav from './BottomNav';

const mockNavigate = vi.fn();
const mockLocation = { pathname: '/cards' };

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));

let mockUser: { id: string; username: string } | null = null;
vi.mock('@festie/shared', () => ({
  useAuthStore: (selector: (s: { user: typeof mockUser }) => unknown) => selector({ user: mockUser }),
}));

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: { currentFestival: null; days: never[] }) => unknown) =>
    selector({ currentFestival: null, days: [] }),
}));

vi.mock('@festie/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared/utils')>()),
  isFestivalOver: () => false,
}));

describe('BottomNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
    mockLocation.pathname = '/cards';
  });

  it('renders a single consolidated Schedule tab for guest users', () => {
    render(<BottomNav />);
    expect(screen.getByLabelText('View Schedule')).toBeInTheDocument();
    // Timeline/Grid folded into the in-page ScheduleViewSwitcher — no longer tabs.
    expect(screen.queryByLabelText('View Timeline')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('View Grid')).not.toBeInTheDocument();
  });

  it('does not show auth tabs for guest users', () => {
    render(<BottomNav />);
    expect(screen.queryByLabelText('View Picks')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('View Crew')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('View Account')).not.toBeInTheDocument();
  });

  it('shows auth tabs for logged-in users', () => {
    mockUser = { id: 'u1', username: 'alice' };
    render(<BottomNav />);
    expect(screen.getByLabelText('View Picks')).toBeInTheDocument();
    expect(screen.getByLabelText('View Crew')).toBeInTheDocument();
    expect(screen.getByLabelText('View Account')).toBeInTheDocument();
  });

  it('marks the active item with aria-current=page', () => {
    render(<BottomNav />);
    const scheduleTab = screen.getByLabelText('View Schedule');
    expect(scheduleTab).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark inactive items as current', () => {
    mockUser = { id: 'u1', username: 'alice' };
    render(<BottomNav />);
    const crewTab = screen.getByLabelText('View Crew');
    expect(crewTab).not.toHaveAttribute('aria-current');
  });

  it('treats "/" as equivalent to "/cards" for active state', () => {
    mockLocation.pathname = '/';
    render(<BottomNav />);
    const scheduleTab = screen.getByLabelText('View Schedule');
    expect(scheduleTab).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the Schedule tab active across the timeline and grid views', () => {
    mockLocation.pathname = '/timeline';
    const { unmount } = render(<BottomNav />);
    expect(screen.getByLabelText('View Schedule')).toHaveAttribute('aria-current', 'page');
    unmount();
    mockLocation.pathname = '/grid';
    render(<BottomNav />);
    expect(screen.getByLabelText('View Schedule')).toHaveAttribute('aria-current', 'page');
  });

  it('navigates when a tab is clicked', async () => {
    const user = userEvent.setup();
    render(<BottomNav />);
    await user.click(screen.getByLabelText('View Schedule'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/cards' });
  });

  it('renders a navigation landmark', () => {
    render(<BottomNav />);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('renders a single nav button for guests (Schedule)', () => {
    render(<BottomNav />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('button').length).toBe(1); // Guest: Schedule only
  });

  it('renders 4 nav buttons for logged-in user', () => {
    mockUser = { id: 'u1', username: 'alice' };
    render(<BottomNav />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    // Schedule + My Picks + Crew + Me
    expect(within(nav).getAllByRole('button').length).toBe(4);
  });

  it('keeps every nav item keyboard-reachable (no roving tabindex)', () => {
    mockUser = { id: 'u1', username: 'alice' };
    render(<BottomNav />);
    // Regression guard for the old keyboard trap: inactive items must not be
    // removed from the tab order via tabIndex=-1.
    expect(screen.getByLabelText('View Schedule')).not.toHaveAttribute('tabindex', '-1');
    expect(screen.getByLabelText('View Crew')).not.toHaveAttribute('tabindex', '-1');
  });

  it('renders label text for the Schedule tab', () => {
    render(<BottomNav />);
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.queryByText('Timeline')).not.toBeInTheDocument();
    expect(screen.queryByText('Grid')).not.toBeInTheDocument();
  });
});
