import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// CrewView reads tab badge counts via react-query, so renders need a client.
function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// Mock dependencies
const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// Shared mutable state object used by all store selectors
const storeState: Record<string, unknown> = {};

vi.mock('@festie/shared/stores', () => ({
  useCrewStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
  useAuthStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
  useFestivalDataStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
}));

vi.mock('../components/features/CrewSelector', () => ({
  default: () => <div data-testid="crew-selector" />,
}));

vi.mock('../components/ui/EmptyState', () => ({
  default: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </div>
  ),
}));

vi.mock('../components/ui/Button', () => ({
  default: ({
    children,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    [k: string]: unknown;
  }) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock('../components/crew/HomeBaseCard', () => ({
  default: () => <div data-testid="home-base-card" />,
}));

vi.mock('../components/crew/CrewTotemCard', () => ({
  default: ({ totemName }: { totemName: string | null }) => <div data-testid="crew-totem-card">{totemName}</div>,
}));

vi.mock('../components/features/FreshnessChip', () => ({
  default: () => <div data-testid="freshness-chip" />,
}));

vi.mock('../components/features/LastSyncedBadge', () => ({
  default: () => <div data-testid="last-synced-badge" />,
}));

vi.mock('../components/crew/CrewInviteBar', () => ({
  default: ({ inviteCode }: { inviteCode: string }) => <div data-testid="crew-invite-bar">{inviteCode}</div>,
}));

vi.mock('../components/crew/CrewTabBar', () => ({
  default: () => <div data-testid="crew-tab-bar" />,
}));

vi.mock('../components/crew/CrewTabContent', () => ({
  default: () => <div data-testid="crew-tab-content" />,
}));

vi.mock('../components/crew/ReformCrewButton', () => ({
  default: () => <div data-testid="reform-crew-button" />,
}));

vi.mock('../components/crew/useCrewAdmin', () => ({
  useCrewAdmin: vi.fn(() => ({
    isAdmin: false,
    adminOpen: false,
    setAdminOpen: vi.fn(),
    adminAddBusy: false,
    submitForceAdd: vi.fn(),
    handleForceAdd: vi.fn(),
  })),
}));

vi.mock('../lib/toastContext', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock('../components/ui/PromptDialog', () => ({
  default: () => null,
}));

vi.mock('../components/ui/ConfirmDialog', () => ({
  default: () => null,
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('lucide-react', () => ({
  Users: () => <span data-testid="users-icon" />,
  Columns3: () => <span data-testid="columns-icon" />,
  CalendarClock: () => <span data-testid="calendar-clock-icon" />,
  ChevronRight: () => <span data-testid="chevron-right-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  LogOut: () => <span data-testid="logout-icon" />,
  // CrewPhotosCard (M6 crew photo wall) icons.
  Images: () => <span data-testid="images-icon" />,
  X: () => <span data-testid="x-icon" />,
  ExternalLink: () => <span data-testid="external-link-icon" />,
}));

import CrewView from './crew';

function setStoreState(overrides: Record<string, unknown> = {}) {
  Object.keys(storeState).forEach((k) => delete storeState[k]);
  Object.assign(storeState, {
    user: { id: 'u1', username: 'testuser' },
    crews: [],
    activeCrew: null,
    selectCrew: vi.fn().mockResolvedValue(undefined),
    createCrew: vi.fn().mockResolvedValue(undefined),
    joinByCode: vi.fn().mockResolvedValue(undefined),
    reformCrew: vi.fn().mockResolvedValue(undefined),
    currentFestival: { id: 'f1', name: 'Bonnaroo' },
    // useFestivalDataStore selectors (ReformCrewButton)
    festivals: [],
    loadFestivals: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

describe('CrewView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState();
  });

  it('renders nothing when no user', () => {
    setStoreState({ user: null });
    const { container } = render(<CrewView />);
    // Component returns null for unauthenticated users (redirect via useEffect)
    expect(container.firstChild).toBeNull();
  });

  it('renders empty state when no crews and no active crew', () => {
    setStoreState({ crews: [], activeCrew: null });
    render(<CrewView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No crew yet')).toBeInTheDocument();
    expect(screen.getByText(/Create a crew or join an existing one/)).toBeInTheDocument();
  });

  it('shows Create Crew and Join by Code buttons when no crews', () => {
    setStoreState({ crews: [], activeCrew: null });
    render(<CrewView />);
    expect(screen.getByText('Create Crew')).toBeInTheDocument();
    expect(screen.getByText('Join by Code')).toBeInTheDocument();
  });

  it('renders crew content when active crew is set', () => {
    setStoreState({
      crews: [{ id: 'c1', name: 'Squad', owner: 'u1' }],
      activeCrew: {
        id: 'c1',
        name: 'Squad',
        inviteCode: 'ABC123',
        owner: 'u1',
        members: [{ userId: 'u1', role: 'owner', username: 'testuser' }],
      },
    });
    render(<CrewView />);
    expect(screen.getByTestId('home-base-card')).toBeInTheDocument();
    expect(screen.getByTestId('crew-invite-bar')).toBeInTheDocument();
    expect(screen.getByTestId('crew-tab-bar')).toBeInTheDocument();
    expect(screen.getByTestId('crew-tab-content')).toBeInTheDocument();
  });

  it('renders crew selector when crews exist', () => {
    setStoreState({
      crews: [{ id: 'c1', name: 'Squad', owner: 'u1' }],
      activeCrew: {
        id: 'c1',
        name: 'Squad',
        owner: 'u1',
        members: [{ userId: 'u1', role: 'owner', username: 'testuser' }],
      },
    });
    render(<CrewView />);
    expect(screen.getByTestId('crew-selector')).toBeInTheDocument();
  });

  it('renders Compare schedules link when active crew', () => {
    setStoreState({
      crews: [{ id: 'c1', name: 'Squad', owner: 'u1' }],
      activeCrew: {
        id: 'c1',
        name: 'Squad',
        owner: 'u1',
        members: [],
      },
    });
    render(<CrewView />);
    expect(screen.getByText('Compare schedules')).toBeInTheDocument();
  });
});
