import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock all external dependencies to keep this a unit test on AppShell's
// rendering logic. The AppShell is a thin orchestrator — we verify basic
// structural rendering and conditional UI elements.

const mockNavigate = vi.fn();
let mockPathname = '/cards';
vi.mock('@tanstack/react-router', () => ({
  useLocation: vi.fn(() => ({ pathname: mockPathname })),
  useNavigate: vi.fn(() => mockNavigate),
  Outlet: () => <div data-testid="outlet">Route content</div>,
}));

let mockUser: { id: string; username: string } | null = null;
vi.mock('@festie/shared', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ user: mockUser, checkSession: vi.fn(async () => {}) }),
}));

vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      detailSet: null,
      setDetailSet: vi.fn(),
      detailAutoSpotify: false,
      setDetailAutoSpotify: vi.fn(),
    }),
}));

vi.mock('@festie/shared/hooks', () => ({
  useOffline: vi.fn(),
}));

vi.mock('./Header', () => ({ default: () => <div data-testid="header">Header</div> }));
vi.mock('./BottomNav', () => ({ default: () => <div data-testid="bottom-nav">BottomNav</div> }));
vi.mock('./SubHeader', () => ({ default: () => <div data-testid="sub-header">SubHeader</div> }));
vi.mock('./PageTransition', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../features/DetailPanel', () => ({ default: () => <div data-testid="detail-panel" /> }));
vi.mock('../features/OfflineBanner', () => ({ default: () => null }));
vi.mock('../features/UpdatePrompt', () => ({ default: () => null }));
vi.mock('../features/IOSInstallSheet', () => ({ default: () => null }));
vi.mock('../features/FestivalDayBanner', () => ({ default: () => null }));
vi.mock('../../hooks/useRealtimeSync', () => ({ useRealtimeSync: vi.fn() }));
vi.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: vi.fn() }));
vi.mock('../../hooks/useScrollReset', () => ({ useScrollReset: vi.fn() }));
vi.mock('../../hooks/useOfflineQueueBridge', () => ({ useOfflineQueueBridge: vi.fn() }));
vi.mock('../../hooks/useFestivalLoader', () => ({ useFestivalLoader: vi.fn() }));
vi.mock('../../hooks/useFestivalMode', () => ({ useFestivalMode: vi.fn(() => ({ showDayBanner: false })) }));
vi.mock('../../router', () => ({ prefetchMainRoutes: vi.fn() }));

import AppShell from './AppShell';

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
    mockPathname = '/cards';
  });

  it('renders the app shell structure with header, main content, and bottom nav', () => {
    render(<AppShell />);
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('renders the skip-to-content link for accessibility', () => {
    render(<AppShell />);
    const skipLink = screen.getByText('Skip to main content');
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute('href', '#main-content');
  });

  it('renders the main content area with correct id', () => {
    render(<AppShell />);
    expect(document.getElementById('main-content')).toBeInTheDocument();
  });

  it('shows guest banner when user is not logged in', () => {
    mockUser = null;
    render(<AppShell />);
    expect(screen.getByText('Browsing as guest.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in / Sign up' })).toBeInTheDocument();
  });

  it('hides guest banner when user is logged in', () => {
    mockUser = { id: '1', username: 'test' };
    render(<AppShell />);
    expect(screen.queryByText('Browsing as guest.')).not.toBeInTheDocument();
  });

  it('renders auth screen layout for /login route', () => {
    mockPathname = '/login';
    render(<AppShell />);
    // On auth routes, the app shell chrome (header, bottom nav) should not render
    expect(screen.queryByTestId('header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bottom-nav')).not.toBeInTheDocument();
  });

  it('renders auth screen layout for /register route', () => {
    mockPathname = '/register';
    render(<AppShell />);
    expect(screen.queryByTestId('header')).not.toBeInTheDocument();
  });
});
