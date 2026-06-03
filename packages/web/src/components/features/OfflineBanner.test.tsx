import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OfflineBanner from './OfflineBanner';
import { useUIStore } from '@festie/shared/stores/uiStore';
import type { FailedSyncItem } from '@festie/shared/stores/uiStore';

interface MockState {
  offlineMode: boolean;
  pendingSync: number;
  failedSync: FailedSyncItem[];
  dismissFailedSync: (clientId: string) => void;
  clearFailedSync: () => void;
}

const dismissFailedSync = vi.fn();
const clearFailedSync = vi.fn();

vi.mock('@festie/shared/stores/uiStore', () => {
  const storeState = {
    offlineMode: false,
    pendingSync: 0,
    failedSync: [] as FailedSyncItem[],
  };
  const mockStore = vi.fn((selector: (s: typeof storeState) => unknown) => selector(storeState));
  // getState() backs the imperative addFailedSync/dismiss calls in the sheet.
  (mockStore as unknown as { getState: () => unknown }).getState = () => storeState;
  return { useUIStore: mockStore };
});

function setStoreState(state: Partial<MockState>) {
  const full: MockState = {
    offlineMode: false,
    pendingSync: 0,
    failedSync: [],
    dismissFailedSync,
    clearFailedSync,
    ...state,
  };
  vi.mocked(useUIStore).mockImplementation((selector: (s: typeof full) => unknown) => selector(full) as never);
  (useUIStore as unknown as { getState: () => unknown }).getState = () => full;
}

function failedItem(overrides: Partial<FailedSyncItem> = {}): FailedSyncItem {
  return {
    clientId: 'c1',
    label: 'Add poll',
    method: 'POST',
    url: '/crews/x/polls',
    body: { question: 'pizza?' },
    error: 'Conflict',
    at: Date.now(),
    ...overrides,
  };
}

describe('OfflineBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    (window as Record<string, unknown>).__festieQueue = undefined;
  });

  it('renders nothing when online with no pending sync and no failures', () => {
    setStoreState({ offlineMode: false, pendingSync: 0 });
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders offline banner when offlineMode is true', () => {
    setStoreState({ offlineMode: true });
    render(<OfflineBanner />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });

  it('shows pending count when offline with pending mutations', () => {
    setStoreState({ offlineMode: true, pendingSync: 3 });
    render(<OfflineBanner />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows syncing state when online with pending mutations', () => {
    setStoreState({ offlineMode: false, pendingSync: 2 });
    render(<OfflineBanner />);
    expect(screen.getByText(/Syncing 2 pending changes/)).toBeInTheDocument();
  });

  it('shows singular "change" for 1 pending mutation', () => {
    setStoreState({ offlineMode: false, pendingSync: 1 });
    render(<OfflineBanner />);
    expect(screen.getByText(/Syncing 1 pending change…/)).toBeInTheDocument();
  });

  it('shows dismiss button when offline', () => {
    setStoreState({ offlineMode: true });
    render(<OfflineBanner />);
    expect(screen.getByLabelText('Dismiss offline notice')).toBeInTheDocument();
  });

  it('hides banner after dismiss is clicked', async () => {
    const user = userEvent.setup();
    setStoreState({ offlineMode: true });
    render(<OfflineBanner />);
    await user.click(screen.getByLabelText('Dismiss offline notice'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows Flush Now button during syncing state', () => {
    setStoreState({ offlineMode: false, pendingSync: 5 });
    render(<OfflineBanner />);
    expect(screen.getByText('Flush now')).toBeInTheDocument();
  });

  it('does not show dismiss button during syncing state', () => {
    setStoreState({ offlineMode: false, pendingSync: 5 });
    render(<OfflineBanner />);
    expect(screen.queryByLabelText('Dismiss offline notice')).not.toBeInTheDocument();
  });

  it('has role=alert and aria-live=polite', () => {
    setStoreState({ offlineMode: true });
    render(<OfflineBanner />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'polite');
  });

  // ── FAILED state ────────────────────────────────────────────────
  it('shows the failed state when failedSync has items (taking priority over offline)', () => {
    setStoreState({ offlineMode: true, failedSync: [failedItem()] });
    render(<OfflineBanner />);
    expect(screen.getByText(/couldn't sync/)).toBeInTheDocument();
    // Offline copy is suppressed while a failure is showing.
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
  });

  it('pluralizes the failed count', () => {
    setStoreState({ failedSync: [failedItem({ clientId: 'a' }), failedItem({ clientId: 'b' })] });
    render(<OfflineBanner />);
    expect(screen.getByText("2 changes couldn't sync")).toBeInTheDocument();
  });

  it('opens the PendingSyncSheet when Review is clicked', async () => {
    const user = userEvent.setup();
    setStoreState({ failedSync: [failedItem({ label: 'Add meeting point' })] });
    render(<OfflineBanner />);
    await user.click(screen.getByText('Review'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Add meeting point')).toBeInTheDocument();
  });
});
