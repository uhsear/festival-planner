import type { CrewWrapOverlapPair, CrewWrapSeenTogether, CrewWrapMemberSummary } from '@festie/shared/types';

export type { CrewWrapOverlapPair, CrewWrapSeenTogether, CrewWrapMemberSummary };

export interface CrewWrapData {
  crewId: string;
  festivalId: string;
  memberCount: number;
  members: { userId: string; name: string }[];
  topOverlap: CrewWrapOverlapPair | null;
  overlapMatrix: CrewWrapOverlapPair[];
  setsSeenTogether: CrewWrapSeenTogether[];
  totalSplit: number;
  biggestSpender: { userId: string; name: string; amount: number } | null;
  perMember: CrewWrapMemberSummary[];
}

interface Props {
  crewName: string;
  festivalName: string;
  wrap: CrewWrapData;
}

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });

/**
 * Poster palette — mirrors the theme tokens in styles/theme.css. Kept in sync
 * with WrapPoster. These posters are rendered off-screen and captured to a PNG
 * via html-to-image, where CSS custom properties don't resolve reliably, so we
 * keep literal hex values here rather than var() refs. Centralising them in one
 * object (instead of scattering the magic hex inline) gives a single place to
 * re-sync if the theme shifts.
 *   bg        ← --color-bg-primary       (#080810)
 *   coral     ← --color-accent-coral     (#ff3366)
 *   aqua      ← --color-accent-aqua      (#00e8d0)
 *   text      ← --color-text-primary     (#eaeaf2)
 *   textMuted ← --color-text-secondary   (#9999bb)
 * glowAlpha: ambient corner glows. Bumped 0.22 → 0.30 so the coral/aqua wash
 * reads in bright sunlight / on phone screens; this is an off-screen render, so
 * it is unaffected by system accessibility/contrast settings.
 */
const POSTER_COLORS = {
  bg: '#080810',
  coral: '#ff3366',
  aqua: '#00e8d0',
  text: '#eaeaf2',
  textMuted: '#9999bb',
} as const;
const GLOW_ALPHA = 0.3;
const POSTER_BG_IMAGE =
  `radial-gradient(60% 45% at 50% 0%, rgba(255, 51, 102, ${GLOW_ALPHA}), transparent 60%), ` +
  `radial-gradient(60% 45% at 50% 100%, rgba(0, 232, 208, ${GLOW_ALPHA}), transparent 60%)`;

/**
 * Fixed-dimension 1080×1920 crew recap poster (9:16 — IG story / TikTok),
 * rendered off-screen and captured via html-to-image for sharing. A crew-scoped
 * sibling of WrapPoster: same gradient, fonts and inline-pixel layout so it
 * renders identically across devices (no media queries / CSS cascade). Every
 * field degrades gracefully — an empty or single-member crew shows fallbacks
 * rather than blanks or NaN.
 */
export default function CrewWrapPoster({ crewName, festivalName, wrap }: Props) {
  const topOverlap = wrap.topOverlap;
  const seenTogether = wrap.setsSeenTogether.slice(0, 5);

  const stats: { label: string; value: string }[] = [
    { label: 'Crew', value: String(wrap.memberCount) },
    { label: 'Seen together', value: String(wrap.setsSeenTogether.length) },
    { label: 'Split', value: money(wrap.totalSplit) },
  ];

  return (
    <div
      style={{
        width: 1080,
        height: 1920,
        background: POSTER_COLORS.bg,
        backgroundImage: POSTER_BG_IMAGE,
        color: POSTER_COLORS.text,
        fontFamily: 'Space Grotesk, system-ui, -apple-system, sans-serif',
        padding: 80,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <header style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: "'Clash Display', system-ui, sans-serif",
            fontSize: 96,
            fontWeight: 900,
            letterSpacing: 8,
            color: POSTER_COLORS.aqua,
            lineHeight: 1,
          }}
        >
          FESTIE
        </div>
        <div style={{ fontSize: 32, opacity: 0.7, marginTop: 16, letterSpacing: 3, textTransform: 'uppercase' }}>
          Crew wrap
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, marginTop: 18 }}>{crewName}</div>
        <div style={{ fontSize: 30, opacity: 0.6, marginTop: 8 }}>{festivalName}</div>
      </header>

      {/* Superlatives */}
      <section style={{ marginTop: 70, flex: 1, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Most-overlapping taste */}
        <Superlative
          label="Most-overlapping taste"
          value={topOverlap ? `${topOverlap.aName} + ${topOverlap.bName}` : 'Rate more sets together'}
          sub={
            topOverlap
              ? `${topOverlap.shared} shared favourite${topOverlap.shared === 1 ? '' : 's'}` +
                (topOverlap.sharedSets.length ? ` · ${topOverlap.sharedSets.slice(0, 3).join(', ')}` : '')
              : undefined
          }
        />

        {/* Biggest spender */}
        <Superlative
          label="Biggest spender"
          value={wrap.biggestSpender ? wrap.biggestSpender.name : 'No expenses yet'}
          sub={wrap.biggestSpender ? `fronted ${money(wrap.biggestSpender.amount)}` : undefined}
        />

        {/* Sets the crew saw together */}
        <div>
          <div
            style={{
              fontSize: 26,
              letterSpacing: 4,
              textTransform: 'uppercase',
              color: POSTER_COLORS.textMuted,
              marginBottom: 16,
            }}
          >
            Sets you saw together
          </div>
          {seenTogether.length > 0 ? (
            seenTogether.map((s) => (
              <div
                key={s.setId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 20,
                  padding: '18px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 38,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.artist || s.setId}
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: POSTER_COLORS.aqua, flexShrink: 0 }}>
                  {s.count} loved it
                </div>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 30, opacity: 0.55 }}>No 4★+ sets two of you both rated — yet.</div>
          )}
        </div>
      </section>

      {/* Stats grid */}
      <section
        style={{
          marginTop: 50,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 18,
        }}
      >
        {stats.map((t) => (
          <div
            key={t.label}
            style={{
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 24,
              border: '1px solid rgba(255,255,255,0.08)',
              padding: 28,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 48, fontWeight: 800, color: POSTER_COLORS.coral, lineHeight: 1 }}>{t.value}</div>
            <div
              style={{
                fontSize: 20,
                opacity: 0.65,
                marginTop: 8,
                letterSpacing: 2,
                textTransform: 'uppercase',
              }}
            >
              {t.label}
            </div>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer style={{ textAlign: 'center', marginTop: 50, fontSize: 28, opacity: 0.45, letterSpacing: 6 }}>
        FESTIE.US
      </footer>
    </div>
  );
}

function Superlative({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 26,
          letterSpacing: 4,
          textTransform: 'uppercase',
          color: POSTER_COLORS.textMuted,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 44, fontWeight: 800 }}>{value}</div>
      {sub && <div style={{ fontSize: 26, opacity: 0.6, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
