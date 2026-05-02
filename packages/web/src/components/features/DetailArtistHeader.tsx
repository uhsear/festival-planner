import React from 'react';
import { Artist } from '@festie/shared/types';

const PLATFORM_LABELS: Record<string, string> = {
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  instagram: 'Instagram',
  twitter: 'X',
  tiktok: 'TikTok',
  website: 'Website',
};

interface Props {
  artistName: string;
  subtitle: string | null;
  primaryArtist: Artist | undefined;
  stageColor: string;
  artistLinks: Array<{ name: string; links: Record<string, string> }>;
  isB2B: boolean;
  genres: string[];
  /** Original set.artist for alt text fallback */
  setArtist: string | undefined;
}

export default function DetailArtistHeader({
  artistName,
  subtitle,
  primaryArtist,
  stageColor,
  artistLinks,
  isB2B,
  genres,
  setArtist,
}: Props) {
  return (
    <>
      {/* Artist photo */}
      {primaryArtist && primaryArtist.photo && (
        <div
          className="detail-artist-photo-wrap"
          style={{
            aspectRatio: '1 / 1',
            background: stageColor + '18',
          }}
        >
          <img
            src={primaryArtist.photo}
            alt={primaryArtist.name || setArtist || ''}
            className="detail-artist-photo"
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              const wrap = (e.target as HTMLElement).parentElement;
              if (wrap) wrap.remove();
            }}
          />
        </div>
      )}

      {/* Artist name */}
      <div className="detail-artist" id="detail-panel-title">
        {artistName}
      </div>

      {/* Subtitle (B2B) */}
      {subtitle && <div className="detail-artist-sub">{subtitle}</div>}

      {/* Genre chips */}
      {genres.length > 0 && (
        <div className="detail-genre-chips">
          {genres.map((g) => (
            <span key={g} className="detail-genre-chip">
              {g}
            </span>
          ))}
        </div>
      )}

      {/* Artist links */}
      {artistLinks.length > 0 && (
        <div className="detail-links">
          {artistLinks.map((a, i) => (
            <React.Fragment key={a.name + i}>
              {isB2B && (
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    marginTop: '6px',
                  }}
                >
                  {a.name}
                </div>
              )}
              <div
                className="detail-link"
                style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}
              >
                {Object.entries(a.links || {}).map(([platform, url]) => (
                  <a
                    key={platform}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--accent-aqua)',
                      fontSize: '13px',
                      textDecoration: 'none',
                    }}
                  >
                    {(PLATFORM_LABELS[platform] || platform) + ' ↗'}
                  </a>
                ))}
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </>
  );
}
