import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import LastSyncedBadge from './LastSyncedBadge';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useFestivalDataStore } from '@festie/shared/stores/festivalDataStore';

vi.mock('@festie/shared/stores/uiStore', () => {
  const state = { offlineMode: false };
  return { useUIStore: vi.fn((sel: (s: typeof state) => unknown) => sel(state)) };
});
vi.mock('@festie/shared/stores/crewStore', () => {
  const state = { _cachedAt: null as number | null };
  return { useCrewStore: vi.fn((sel: (s: typeof state) => unknown) => sel(state)) };
});
vi.mock('@festie/shared/stores/festivalDataStore', () => {
  const state = { _festivalCachedAt: null as number | null };
  return { useFestivalDataStore: vi.fn((sel: (s: typeof state) => unknown) => sel(state)) };
});
vi.mock('lucide-react', () => ({
  Check: () => <span data-testid="check-icon" />,
  WifiOff: () => <span data-testid="wifioff-icon" />,
}));

function setUI(offlineMode: boolean) {
  vi.mocked(useUIStore).mockImplementation(
    (sel: (s: { offlineMode: boolean }) => unknown) => sel({ offlineMode }) as never,
  );
}
function setCrewCachedAt(_cachedAt: number | null) {
  vi.mocked(useCrewStore).mockImplementation(
    (sel: (s: { _cachedAt: number | null }) => unknown) => sel({ _cachedAt }) as never,
  );
}
function setFestivalCachedAt(_festivalCachedAt: number | null) {
  vi.mocked(useFestivalDataStore).mockImplementation(
    (sel: (s: { _festivalCachedAt: number | null }) => unknown) => sel({ _festivalCachedAt }) as never,
  );
}

describe('LastSyncedBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUI(false);
    setCrewCachedAt(null);
    setFestivalCachedAt(null);
  });

  it('renders nothing until the surface has been cached (no timestamp, no claim)', () => {
    setCrewCachedAt(null);
    const { container } = render(<LastSyncedBadge surface="crew" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Updated just now" for a fresh crew cache', () => {
    setCrewCachedAt(Date.now());
    render(<LastSyncedBadge surface="crew" />);
    expect(screen.getByTestId('last-synced-badge')).toHaveTextContent('Updated just now');
  });

  it('renders "Updated Nm ago" for a stale schedule cache', () => {
    setFestivalCachedAt(Date.now() - 4 * 60_000);
    render(<LastSyncedBadge surface="schedule" />);
    expect(screen.getByTestId('last-synced-badge')).toHaveTextContent('Updated 4m ago');
  });

  it('appends "Offline-ready" when offline and cached', () => {
    setUI(true);
    setCrewCachedAt(Date.now());
    render(<LastSyncedBadge surface="crew" />);
    const badge = screen.getByTestId('last-synced-badge');
    expect(badge).toHaveTextContent('Updated just now · Offline-ready');
    expect(screen.getByTestId('wifioff-icon')).toBeInTheDocument();
  });

  it('does not show "Offline-ready" while online', () => {
    setUI(false);
    setCrewCachedAt(Date.now());
    render(<LastSyncedBadge surface="crew" />);
    expect(screen.getByTestId('last-synced-badge')).not.toHaveTextContent('Offline-ready');
    expect(screen.getByTestId('check-icon')).toBeInTheDocument();
  });

  it('reads the schedule timestamp for surface="schedule" (ignores crew cache)', () => {
    setCrewCachedAt(Date.now());
    setFestivalCachedAt(null);
    const { container } = render(<LastSyncedBadge surface="schedule" />);
    expect(container.firstChild).toBeNull();
  });
});
