import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSpotifyStore } from '@festie/shared/stores/spotifyStore';
import Button from '../components/ui/Button';
import { Music, Check, AlertTriangle } from 'lucide-react';

/**
 * OAuth callback landing (M4, WEB). The backend's /spotify/auth/callback
 * exchanges the code, stores the encrypted refresh token, then redirects the
 * browser HERE: /spotify/connected?status=<connected|denied|expired|error|…>.
 *
 * This page reads the status, revalidates the connection via loadStatus(), shows
 * a success/failure message, then routes the user back to /picks where the
 * SpotifyConnect surface now reflects the connected state. No token ever touches
 * the client — this is purely a UX landing after the server-side exchange.
 */

// Human copy per status the server can hand back (see routes/spotify-auth.ts).
const STATUS_COPY: Record<string, { ok: boolean; title: string; detail: string }> = {
  connected: { ok: true, title: 'Spotify connected', detail: 'We can now suggest picks from your top artists.' },
  denied: {
    ok: false,
    title: 'Connection cancelled',
    detail: 'You declined the Spotify permission. No changes were made.',
  },
  expired: {
    ok: false,
    title: 'Connection expired',
    detail: 'The connect link timed out. Please try connecting again.',
  },
  invalid: { ok: false, title: "Couldn't connect", detail: 'The Spotify response was invalid. Please try again.' },
  no_refresh: {
    ok: false,
    title: "Couldn't connect",
    detail: 'Spotify did not return the needed access. Please try again.',
  },
  not_configured: { ok: false, title: 'Spotify unavailable', detail: 'Spotify connect is not available right now.' },
  error: { ok: false, title: "Couldn't connect", detail: 'Something went wrong connecting Spotify. Please try again.' },
};

function readStatusParam(): string {
  if (typeof window === 'undefined') return 'error';
  const params = new URLSearchParams(window.location.search);
  return params.get('status') || 'error';
}

export default function SpotifyCallback() {
  const navigate = useNavigate();
  const loadStatus = useSpotifyStore((s) => s.loadStatus);
  const [statusKey] = useState(readStatusParam);

  const copy = useMemo(() => STATUS_COPY[statusKey] ?? STATUS_COPY.error!, [statusKey]);

  // On a successful exchange, revalidate the connection state so the rest of the
  // app (SpotifyConnect on /picks) immediately reflects "connected".
  useEffect(() => {
    if (copy.ok) void loadStatus();
  }, [copy.ok, loadStatus]);

  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center" role="status" aria-live="polite">
      <div
        className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full ${
          copy.ok ? 'bg-[#1DB954]/15 text-[#1DB954]' : 'bg-accent-coral/15 text-accent-coral'
        }`}
      >
        {copy.ok ? (
          <Check className="h-7 w-7" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-7 w-7" aria-hidden="true" />
        )}
      </div>
      <h1 className="mb-1 flex items-center gap-2 text-lg font-bold text-text-primary">
        <Music className="h-5 w-5 text-[#1DB954]" aria-hidden="true" />
        {copy.title}
      </h1>
      <p className="mb-6 max-w-sm text-sm text-text-secondary">{copy.detail}</p>
      <Button
        variant="primary"
        size="sm"
        type="button"
        onClick={() => navigate({ to: '/picks' }).catch(() => {})}
        aria-label="Back to my picks"
      >
        Back to my picks
      </Button>
    </div>
  );
}
