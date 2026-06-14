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
        <div className="text-center my-3 mb-1.5" style={{ background: stageColor + '18' }}>
          <img
            src={primaryArtist.photo}
            alt={primaryArtist.name || setArtist || ''}
            className="w-24 h-24 rounded-full object-cover border-2 border-white/15 inline-block"
            width={300}
            height={300}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              const wrap = (e.target as HTMLElement).parentElement;
              if (wrap) wrap.remove();
            }}
          />
        </div>
      )}

      {/* Artist name */}
      <div
        className="text-[26px] font-bold mb-1 tracking-[-0.5px] leading-[1.1] text-text-primary"
        id="detail-panel-title"
      >
        {artistName}
      </div>

      {/* Subtitle (B2B) */}
      {subtitle && (
        <div className="text-[13px] font-medium leading-[1.35] text-text-muted mt-1 overflow-hidden text-ellipsis [-webkit-line-clamp:4] [-webkit-box-orient:vertical] [display:-webkit-box] break-words">
          {subtitle}
        </div>
      )}

      {/* Genre chips */}
      {genres.length > 0 && (
        <div className="flex flex-wrap gap-1.5 my-1.5 mb-2.5">
          {genres.map((g) => (
            <span
              key={g}
              className="px-2.5 py-0.5 rounded-DEFAULT bg-[var(--color-overlay-2)] border border-border text-text-secondary text-[11px] font-semibold capitalize tracking-[0.02em]"
            >
              {g}
            </span>
          ))}
        </div>
      )}

      {/* Artist links */}
      {artistLinks.length > 0 && (
        <div>
          {artistLinks.map((a, i) => (
            <React.Fragment key={a.name + i}>
              {isB2B && <div className="mt-1.5 text-xs font-semibold text-text-secondary">{a.name}</div>}
              <div className="py-1 pb-2 text-[13px] flex flex-wrap gap-2.5">
                {Object.entries(a.links || {}).map(([platform, url]) => (
                  <a
                    key={platform}
                    // Defense-in-depth: React passes javascript:/data: URLs
                    // through to the DOM, so only emit an href for http(s).
                    href={/^https?:/i.test(url) ? url : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-accent-aqua no-underline hover:underline"
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
