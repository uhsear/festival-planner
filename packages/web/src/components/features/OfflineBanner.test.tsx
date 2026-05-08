import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OfflineBanner from './OfflineBanner';
import { useUIStore } from '@festie/shared/stores/uiStore';

vi.mock('@festie/shared/stores/uiStore', () => {
  const storeState = {
    offlineMode: false,
    pendingSync: 0,
  };
  return {
    useUIStore: vi.fn((selector: (s: typeof storeState) => unknown) => selector(storeState)),
  };
});

function setStoreState(state: { offlineMode: boolean; pendingSync: number }) {
  vi.mocked(useUIStore).mockImplementation(
    (selector: (s: typeof state) => unknown) => selector(state) as never,
  );
}

describe('OfflineBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    (window as Record<string, unknown>).__festieQueue = undefined;
  });

  it('renders nothing when online with no pending sync', () => {
    setStoreState({ offlineMode: false, pendingSync: 0 });
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders offline banner when offlineMode is true', () => {
    setStoreState({ offlineMode: true, pendingSync: 0 });
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
    setStoreState({ offlineMode: true, pendingSync: 0 });
    render(<OfflineBanner />);
    expect(screen.getByLabelText('Dismiss offline notice')).toBeInTheDocument();
  });

  it('hides banner after dismiss is clicked', async () => {
    const user = userEvent.setup();
    setStoreState({ offlineMode: true, pendingSync: 0 });
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
    setStoreState({ offlineMode: true, pendingSync: 0 });
    render(<OfflineBanner />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'polite');
  });
});
