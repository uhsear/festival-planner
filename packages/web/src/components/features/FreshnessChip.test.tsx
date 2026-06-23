import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import FreshnessChip from './FreshnessChip';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useFestivalDataStore } from '@festie/shared/stores/festivalDataStore';

vi.mock('@festie/shared/stores/uiStore', () => {
  const state = { offlineMode: false, pendingSync: 0 };
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

function setUI(state: { offlineMode?: boolean; pendingSync?: number }) {
  const full = { offlineMode: false, pendingSync: 0, ...state };
  vi.mocked(useUIStore).mockImplementation((sel: (s: typeof full) => unknown) => sel(full) as never);
}
function setCrewCachedAt(_cachedAt: number | null) {
  const full = { _cachedAt };
  vi.mocked(useCrewStore).mockImplementation((sel: (s: typeof full) => unknown) => sel(full) as never);
}
function setFestivalCachedAt(_festivalCachedAt: number | null) {
  const full = { _festivalCachedAt };
  vi.mocked(useFestivalDataStore).mockImplementation((sel: (s: typeof full) => unknown) => sel(full) as never);
}

describe('FreshnessChip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUI({});
    setCrewCachedAt(null);
    setFestivalCachedAt(null);
  });

  it('renders nothing when the surface has never been cached', () => {
    setCrewCachedAt(null);
    const { container } = render(<FreshnessChip surface="crew" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Synced N ago" when online with a crew cache timestamp', () => {
    setCrewCachedAt(Date.now() - 5 * 60_000); // 5 minutes ago
    render(<FreshnessChip surface="crew" />);
    expect(screen.getByText(/Synced 5m ago/)).toBeInTheDocument();
    expect(screen.queryByText(/offline data/)).not.toBeInTheDocument();
  });

  it('renders the offline-data label when offlineMode is set', () => {
    setUI({ offlineMode: true });
    setCrewCachedAt(Date.now() - 2 * 60_000);
    render(<FreshnessChip surface="crew" />);
    expect(screen.getByText(/Showing offline data · synced 2m ago/)).toBeInTheDocument();
  });

  it('shows a "N queued" badge driven by pendingSync', () => {
    setUI({ pendingSync: 3 });
    setCrewCachedAt(Date.now());
    render(<FreshnessChip surface="crew" />);
    expect(screen.getByText('3 queued')).toBeInTheDocument();
  });

  it('hides the queued badge when nothing is pending', () => {
    setUI({ pendingSync: 0 });
    setCrewCachedAt(Date.now());
    render(<FreshnessChip surface="crew" />);
    expect(screen.queryByText(/queued/)).not.toBeInTheDocument();
  });

  it('reads festivalDataStore._festivalCachedAt for the schedule surface', () => {
    setCrewCachedAt(null);
    setFestivalCachedAt(Date.now() - 60 * 60_000); // 1 hour ago
    render(<FreshnessChip surface="schedule" />);
    expect(screen.getByText(/Synced 1h ago/)).toBeInTheDocument();
  });
});
