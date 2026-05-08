import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

vi.mock('../../utils/festivalTime', () => ({
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

  it('marks the active tab with aria-selected=true', () => {
    render(<BottomNav />);
    const scheduleTab = screen.getByLabelText('View Schedule');
    expect(scheduleTab).toHaveAttribute('aria-selected', 'true');
  });

  it('marks inactive tabs with aria-selected=false', () => {
    render(<BottomNav />);
    const timelineTab = screen.getByLabelText('View Timeline');
    expect(timelineTab).toHaveAttribute('aria-selected', 'false');
  });

  it('treats "/" as equivalent to "/cards" for active state', () => {
    mockLocation.pathname = '/';
    render(<BottomNav />);
    const scheduleTab = screen.getByLabelText('View Schedule');
    expect(scheduleTab).toHaveAttribute('aria-selected', 'true');
  });

  it('navigates when a tab is clicked', async () => {
    const user = userEvent.setup();
    render(<BottomNav />);
    await user.click(screen.getByLabelText('View Timeline'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/timeline' });
  });

  it('renders a tablist role', () => {
    render(<BottomNav />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders tab roles for each nav item', () => {
    render(<BottomNav />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(3); // Guest: Schedule, Timeline, Grid
  });

  it('renders 6 tabs for logged-in user', () => {
    mockUser = { id: 'u1', username: 'alice' };
    render(<BottomNav />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(6);
  });

  it('sets tabIndex=0 for active tab and -1 for others', () => {
    render(<BottomNav />);
    const activeTab = screen.getByLabelText('View Schedule');
    const inactiveTab = screen.getByLabelText('View Timeline');
    expect(activeTab).toHaveAttribute('tabindex', '0');
    expect(inactiveTab).toHaveAttribute('tabindex', '-1');
  });

  it('renders label text for each tab', () => {
    render(<BottomNav />);
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Grid')).toBeInTheDocument();
  });
});
