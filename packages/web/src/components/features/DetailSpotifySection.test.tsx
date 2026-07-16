import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DetailSpotifySection from './DetailSpotifySection';

describe('DetailSpotifySection', () => {
  it.each([
    [{ label: 'Legacy label' }, 'Spotify: Legacy label'],
    [{ trackName: 'Midnight City', artistName: 'M83' }, 'Spotify: Midnight City'],
    [{ artistName: 'M83' }, 'Spotify: M83'],
    [{}, 'Spotify: player'],
  ])('uses the best available iframe title', (metadata, title) => {
    render(
      <DetailSpotifySection
        preview={{ embedUrl: 'https://open.spotify.com/embed/track/123', embedType: 'track', ...metadata }}
        visible
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByTitle(title)).toBeInTheDocument();
  });

  it('toggles the player from the disclosure button', () => {
    const onToggle = vi.fn();
    render(
      <DetailSpotifySection
        preview={{ embedUrl: 'https://open.spotify.com/embed/artist/123', embedType: 'artist' }}
        visible={false}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /listen on spotify/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
