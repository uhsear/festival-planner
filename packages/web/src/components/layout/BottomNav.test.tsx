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
  useAuthStore: (selector: (s: { user: typeof mockUser }) => unknown) =>
    selector({ user: mockUser }),
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

  it('renders base tabs for guest users', () => {
    render(<BottomNav />);
    expect(screen.getByLabelText('View Schedule')).toBeInTheDocument();
    expect(screen.getByLabelText('View Timeline')).toBeInTheDocument();
    expect(screen.getByLabelText('View Grid')).toBeInTheDocument();
  });

  it('does not show auth tabs for guest users', () => {
    render(<BottomNav />);
    expect(screen.queryByLabelText('View My Picks')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('View Crew')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('View Me')).not.toBeInTheDocument();
  });

  it('shows auth tabs for logged-in users', () => {
    mockUser = { id: 'u1', username: 'alice' };
    render(<BottomNav />);
    expect(screen.getByLabelText('View My Picks')).toBeInTheDocument();
    expect(screen.getByLabelText('View Crew')).toBeInTheDocument();
    expect(screen.getByLabelText('View Me')).toBeInTheDocument();
  });

  it('marks the active item with aria-current=page', () => {
    render(<BottomNav />);
    const scheduleTab = screen.getByLabelText('View Schedule');
    expect(scheduleTab).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark inactive items as current', () => {
    render(<BottomNav />);
    const timelineTab = screen.getByLabelText('View Timeline');
    expect(timelineTab).not.toHaveAttribute('aria-current');
  });

  it('treats "/" as equivalent to "/cards" for active state', () => {
    mockLocation.pathname = '/';
    render(<BottomNav />);
    const scheduleTab = screen.getByLabelText('View Schedule');
    expect(scheduleTab).toHaveAttribute('aria-current', 'page');
  });

  it('navigates when a tab is clicked', async () => {
    const user = userEvent.setup();
    render(<BottomNav />);
    await user.click(screen.getByLabelText('View Timeline'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/timeline' });
  });

  it('renders a navigation landmark', () => {
    render(<BottomNav />);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('renders a button for each nav item (3 for guests)', () => {
    render(<BottomNav />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('button').length).toBe(3); // Guest: Schedule, Timeline, Grid
  });

  it('renders 6 nav buttons for logged-in user', () => {
    mockUser = { id: 'u1', username: 'alice' };
    render(<BottomNav />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('button').length).toBe(6);
  });

  it('keeps every nav item keyboard-reachable (no roving tabindex)', () => {
    render(<BottomNav />);
    // Regression guard for the old keyboard trap: inactive items must not be
    // removed from the tab order via tabIndex=-1.
    expect(screen.getByLabelText('View Schedule')).not.toHaveAttribute('tabindex', '-1');
    expect(screen.getByLabelText('View Timeline')).not.toHaveAttribute('tabindex', '-1');
  });

  it('renders label text for each tab', () => {
    render(<BottomNav />);
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Grid')).toBeInTheDocument();
  });
});
