import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@festie/shared/services/api';

interface SpotifyPreviewProps {
  setId: string;
}

interface SpotifyPreviewData {
  embedType: 'track' | 'artist' | null;
  trackId?: string;
  artistId?: string;
  trackName?: string;
  artistName?: string;
  albumArt?: string;
}

const STALE_TIME = 1000 * 60 * 60 * 24; // 24 hours

export default function SpotifyPreview({ setId }: SpotifyPreviewProps) {
  const { data } = useQuery<SpotifyPreviewData>({
    queryKey: ['spotify-preview', setId],
    queryFn: () => api.get<SpotifyPreviewData>(`/spotify/preview/${setId}`),
    staleTime: STALE_TIME,
    enabled: !!setId,
  });

  if (!data || !data.embedType) {
    return null;
  }

  const embedUrl =
    data.embedType === 'track'
      ? `https://open.spotify.com/embed/track/${data.trackId}?theme=0`
      : `https://open.spotify.com/embed/artist/${data.artistId}?theme=0`;

  return (
    <iframe
      title={data.trackName || data.artistName || 'Spotify preview'}
      src={embedUrl}
      width="100%"
      height={80}
      allow="autoplay; encrypted-media"
      loading="lazy"
      className="rounded-lg border-0"
    />
  );
}
