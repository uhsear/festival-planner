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

  // R18: pending sections render as muted dots with no text label (idle state).
  // Verify the section names are present and the Download button is shown.
  it('renders all section labels and Download button before any download', () => {
    render(<OfflineReadinessCard festivalId="fest-1" />);
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('My picks')).toBeInTheDocument();
    expect(screen.getByText('Crew plan')).toBeInTheDocument();
    expect(screen.getByText('Weather')).toBeInTheDocument();
    expect(screen.getByText('Artist art')).toBeInTheDocument();
    expect(screen.getByText('Download')).toBeInTheDocument();
  });

  // R18: done sections show "synced N ago" or "ready" (no longer "Ready · synced").
  it('renders a "synced" label for a section that is ready', () => {
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
    expect(screen.getByText(/synced/)).toBeInTheDocument();
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
    const btn = screen.getByRole('button', { name: /download/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText('Downloading…')).toBeInTheDocument();
  });

  // R18: error sections show a Retry button (when onRetry is available).
  // The coral "failed" text is shown only when syncedAt has a timestamp;
  // with syncedAt: null and onRetry provided, just the Retry button appears.
  it('shows a Retry button for a failed section', () => {
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
    // Retry button is rendered for the failed weather section.
    expect(screen.getByRole('button', { name: /retry weather/i })).toBeInTheDocument();
    // The weather label text turns coral (rendered as label text).
    expect(screen.getByText('Weather')).toBeInTheDocument();
  });
});
