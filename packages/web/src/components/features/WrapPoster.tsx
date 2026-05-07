export interface PosterSet {
  rating: number;
  artist: string;
  stageName?: string | null;
}
export interface PosterStats {
  totalRated: number;
  stagesVisited: number;
  daysAttended: number;
  totalHours: number;
}

interface Props {
  festivalName: string;
  topSets: PosterSet[];
  stats: PosterStats;
}

const EMOJI: Record<number, string> = { 5: '🔥', 4: '😊', 3: '👍', 2: '🤔', 1: '👎' };

/**
 * Fixed-dimension 1080×1920 poster (9:16 — Instagram story / TikTok) rendered
 * off-screen and captured via html-to-image for sharing. All styles are inline
 * + numeric pixel values so it looks identical whether the user is on an iPad
 * or iPhone SE: layout doesn't depend on media queries or CSS cascade.
 */
export default function WrapPoster({ festivalName, topSets, stats }: Props) {
  return (
    <div
      style={{
        width: 1080,
        height: 1920,
        background: '#080810',
        backgroundImage:
          'radial-gradient(60% 45% at 50% 0%, rgba(255, 51, 102, 0.22), transparent 60%), ' +
          'radial-gradient(60% 45% at 50% 100%, rgba(0, 232, 208, 0.22), transparent 60%)',
        color: '#eaeaf2',
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
            fontFamily: 'Syncopate, system-ui, sans-serif',
            fontSize: 96,
            fontWeight: 900,
            letterSpacing: 8,
            background: 'linear-gradient(90deg, #ff3366, #00e8d0)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            lineHeight: 1,
          }}
        >
          FESTIE
        </div>
        <div style={{ fontSize: 32, opacity: 0.7, marginTop: 16, letterSpacing: 3, textTransform: 'uppercase' }}>
          Your festival wrap
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, marginTop: 18 }}>{festivalName}</div>
      </header>

      {/* Top sets */}
      <section style={{ marginTop: 90, flex: 1 }}>
        <div
          style={{
            fontSize: 28,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: '#9999bb',
            marginBottom: 24,
          }}
        >
          Top sets
        </div>
        {topSets.slice(0, 5).map((s, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              padding: '24px 0',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div style={{ fontSize: 64, width: 80, flexShrink: 0, textAlign: 'center' }}>
              {EMOJI[s.rating] || '⭐'}
            </div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div
                style={{
                  fontSize: 40,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {s.artist}
              </div>
              {s.stageName && (
                <div style={{ fontSize: 24, opacity: 0.55, marginTop: 4 }}>{s.stageName}</div>
              )}
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 800,
                color: '#00e8d0',
                width: 100,
                textAlign: 'right',
                flexShrink: 0,
              }}
            >
              #{i + 1}
            </div>
          </div>
        ))}
      </section>

      {/* Stats grid */}
      <section
        style={{
          marginTop: 60,
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 18,
        }}
      >
        {[
          { label: 'Sets', value: String(stats.totalRated) },
          { label: 'Stages', value: String(stats.stagesVisited) },
          { label: 'Days', value: String(stats.daysAttended) },
          { label: 'Hours', value: stats.totalHours.toFixed(1) },
        ].map((t) => (
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
            <div style={{ fontSize: 56, fontWeight: 800, color: '#ff3366', lineHeight: 1 }}>{t.value}</div>
            <div
              style={{
                fontSize: 20,
                opacity: 0.65,
                marginTop: 8,
                letterSpacing: 3,
                textTransform: 'uppercase',
              }}
            >
              {t.label}
            </div>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer style={{ textAlign: 'center', marginTop: 60, fontSize: 28, opacity: 0.45, letterSpacing: 6 }}>
        FESTIE.US
      </footer>
    </div>
  );
}
