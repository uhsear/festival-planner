import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OfflineReadinessCard from './OfflineReadinessCard';
import { useOfflineReadinessStore } from '@festie/shared/stores/offlineReadinessStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';

const { downloadForOffline } = vi.hoisted(() => ({ downloadForOffline: vi.fn() }));

type ReadinessState = {
  byFestival: Record<string, unknown>;
  downloadingFestivalId: string | null;
  downloadForOffline: typeof downloadForOffline;
};

vi.mock('@festie/shared/stores/offlineReadinessStore', () => {
  const state: ReadinessState = { byFestival: {}, downloadingFestivalId: null, downloadForOffline };
  return { useOfflineReadinessStore: vi.fn((sel: (s: ReadinessState) => unknown) => sel(state)) };
});
vi.mock('@festie/shared/stores/crewStore', () => {
  const state = { activeCrew: { id: 'crew-1' } as { id: string } | null };
  return { useCrewStore: vi.fn((sel: (s: typeof state) => unknown) => sel(state)) };
});

function setReadiness(state: Partial<ReadinessState>) {
  const full: ReadinessState = { byFestival: {}, downloadingFestivalId: null, downloadForOffline, ...state };
  vi.mocked(useOfflineReadinessStore).mockImplementation((sel: (s: ReadinessState) => unknown) => sel(full) as never);
}
function setCrew(activeCrew: { id: string } | null) {
  const full = { activeCrew };
  vi.mocked(useCrewStore).mockImplementation((sel: (s: typeof full) => unknown) => sel(full) as never);
}

describe('OfflineReadinessCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setReadiness({});
    setCrew({ id: 'crew-1' });
  });

  it('shows "Not downloaded" for every section before any download', () => {
    render(<OfflineReadinessCard festivalId="fest-1" />);
    expect(screen.getAllByText('Not downloaded')).toHaveLength(5);
    expect(screen.getByText('Download')).toBeInTheDocument();
  });

  it('renders "Ready · synced …" for a section that is ready', () => {
    setReadiness({
      byFestival: {
        'fest-1': {
          schedule: { status: 'ready', syncedAt: Date.now() },
          picks: { status: 'idle', syncedAt: null },
          crew: { status: 'idle', syncedAt: null },
          weather: { status: 'idle', syncedAt: null },
          art: { status: 'idle', syncedAt: null },
        },
      },
    });
    render(<OfflineReadinessCard festivalId="fest-1" />);
    expect(screen.getByText(/Ready · synced/)).toBeInTheDocument();
    // Once any section is ready, the button becomes "Update".
    expect(screen.getByText('Update')).toBeInTheDocument();
  });

  it('calls downloadForOffline with the festival id and the active crew id on click', () => {
    render(<OfflineReadinessCard festivalId="fest-1" />);
    fireEvent.click(screen.getByText('Download'));
    expect(downloadForOffline).toHaveBeenCalledWith('fest-1', 'crew-1');
  });

  it('passes undefined crew id when there is no active crew', () => {
    setCrew(null);
    render(<OfflineReadinessCard festivalId="fest-1" />);
    fireEvent.click(screen.getByText('Download'));
    expect(downloadForOffline).toHaveBeenCalledWith('fest-1', undefined);
  });

  it('disables the button and shows "Downloading…" while this festival is downloading', () => {
    setReadiness({ downloadingFestivalId: 'fest-1' });
    render(<OfflineReadinessCard festivalId="fest-1" />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(screen.getAllByText('Downloading…').length).toBeGreaterThan(0);
  });

  it('shows an error label for a failed section', () => {
    setReadiness({
      byFestival: {
        'fest-1': {
          schedule: { status: 'ready', syncedAt: Date.now() },
          picks: { status: 'ready', syncedAt: Date.now() },
          crew: { status: 'ready', syncedAt: Date.now() },
          weather: { status: 'error', syncedAt: null },
          art: { status: 'ready', syncedAt: Date.now() },
        },
      },
    });
    render(<OfflineReadinessCard festivalId="fest-1" />);
    expect(screen.getByText("Couldn't download")).toBeInTheDocument();
  });
});
