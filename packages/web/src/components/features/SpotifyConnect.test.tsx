import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SpotifyConnect from './SpotifyConnect';
import { useSpotifyStore } from '@festie/shared/stores/spotifyStore';

// ── Mock the spotify store: a selector-callable fn over a mutable state object,
// plus a getState() the sheet's type ref uses. ────────────────────────────────
const connect = vi.fn();
const loadStatus = vi.fn();
const loadSuggestions = vi.fn();
const confirmPicks = vi.fn();
const createPlaylist = vi.fn();
const clearPlaylist = vi.fn();
const disconnect = vi.fn();

interface SpotifyMockState {
  connectionStatus: null | {
    configured: boolean;
    connected: boolean;
    spotifyUserId: string | null;
    connectedAt: string | null;
  };
  suggestions: null | { suggestions: unknown[]; unmatchedFallback: boolean; total: number };
  playlist: null | { playlistId: string; playlistUrl: string | null; trackCount: number; artistCount: number };
  statusLoading: boolean;
  suggestionsLoading: boolean;
  playlistBuilding: boolean;
  confirming: boolean;
  connect: typeof connect;
  loadStatus: typeof loadStatus;
  loadSuggestions: typeof loadSuggestions;
  confirmPicks: typeof confirmPicks;
  createPlaylist: typeof createPlaylist;
  clearPlaylist: typeof clearPlaylist;
  disconnect: typeof disconnect;
}

const baseState: SpotifyMockState = {
  connectionStatus: null,
  suggestions: null,
  playlist: null,
  statusLoading: false,
  suggestionsLoading: false,
  playlistBuilding: false,
  confirming: false,
  connect,
  loadStatus,
  loadSuggestions,
  confirmPicks,
  createPlaylist,
  clearPlaylist,
  disconnect,
};

vi.mock('@festie/shared/stores/spotifyStore', () => {
  const store = vi.fn((sel: (s: SpotifyMockState) => unknown) => sel(baseState));
  (store as unknown as { getState: () => SpotifyMockState }).getState = () => baseState;
  return {
    useSpotifyStore: store,
    suggestedToDomainPriority: (p: string) => (p === 'want' ? 'want-to-see' : p),
  };
});

// useFestivalStore (merged store) is consumed only by the suggestions sheet.
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: { sets: unknown[]; currentFestival: unknown }) => unknown) =>
    sel({ sets: [], currentFestival: { b2bSeparator: ' b2b ' } }),
  ),
}));

vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function setState(patch: Partial<SpotifyMockState>) {
  const full = { ...baseState, ...patch };
  vi.mocked(useSpotifyStore).mockImplementation((sel: (s: SpotifyMockState) => unknown) => sel(full) as never);
  (useSpotifyStore as unknown as { getState: () => SpotifyMockState }).getState = () => full;
}

describe('SpotifyConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setState({});
  });

  it('shows "Spotify not configured" when the backend reports dormant', () => {
    setState({ connectionStatus: { configured: false, connected: false, spotifyUserId: null, connectedAt: null } });
    render(<SpotifyConnect festivalId="fest-1" />);
    expect(screen.getByText('Spotify not configured')).toBeInTheDocument();
    expect(screen.queryByLabelText('Connect Spotify')).not.toBeInTheDocument();
  });

  it('shows a Connect button when configured but not connected', () => {
    setState({ connectionStatus: { configured: true, connected: false, spotifyUserId: null, connectedAt: null } });
    render(<SpotifyConnect festivalId="fest-1" />);
    expect(screen.getByLabelText('Connect Spotify')).toBeInTheDocument();
  });

  it('calls loadStatus on mount', () => {
    render(<SpotifyConnect festivalId="fest-1" />);
    expect(loadStatus).toHaveBeenCalled();
  });

  it('kicks off connect() when the Connect button is clicked', async () => {
    const user = userEvent.setup();
    connect.mockResolvedValue('https://accounts.spotify.com/authorize');
    setState({ connectionStatus: { configured: true, connected: false, spotifyUserId: null, connectedAt: null } });
    render(<SpotifyConnect festivalId="fest-1" />);
    await user.click(screen.getByLabelText('Connect Spotify'));
    expect(connect).toHaveBeenCalled();
  });

  it('shows the connected state with Suggest + Build playlist actions', () => {
    setState({ connectionStatus: { configured: true, connected: true, spotifyUserId: 'sp_u', connectedAt: null } });
    render(<SpotifyConnect festivalId="fest-1" />);
    expect(screen.getByText('Spotify connected')).toBeInTheDocument();
    expect(screen.getByLabelText('Review Spotify pick suggestions')).toBeInTheDocument();
    expect(screen.getByLabelText('Build a playlist from my picks')).toBeInTheDocument();
  });

  it('builds a playlist when the Build playlist button is clicked', async () => {
    const user = userEvent.setup();
    createPlaylist.mockResolvedValue({ playlistId: 'p', playlistUrl: 'u', trackCount: 10, artistCount: 3 });
    setState({ connectionStatus: { configured: true, connected: true, spotifyUserId: 'sp_u', connectedAt: null } });
    render(<SpotifyConnect festivalId="fest-1" />);
    await user.click(screen.getByLabelText('Build a playlist from my picks'));
    expect(createPlaylist).toHaveBeenCalledWith('fest-1');
  });

  it('opens the suggestions sheet and loads suggestions on "Suggest picks"', async () => {
    const user = userEvent.setup();
    loadSuggestions.mockResolvedValue(undefined);
    setState({ connectionStatus: { configured: true, connected: true, spotifyUserId: 'sp_u', connectedAt: null } });
    render(<SpotifyConnect festivalId="fest-1" />);
    await user.click(screen.getByLabelText('Review Spotify pick suggestions'));
    expect(loadSuggestions).toHaveBeenCalledWith('fest-1');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders a playlist success link when a playlist build result is present', () => {
    setState({
      connectionStatus: { configured: true, connected: true, spotifyUserId: 'sp_u', connectedAt: null },
      playlist: { playlistId: 'p', playlistUrl: 'https://open.spotify.com/playlist/p', trackCount: 22, artistCount: 5 },
    });
    render(<SpotifyConnect festivalId="fest-1" />);
    expect(screen.getByText(/22 tracks from 5 artists/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open/ })).toHaveAttribute('href', 'https://open.spotify.com/playlist/p');
  });
});
