// Server shape from GET /ratings/crew-wrap/:crewId/:festivalId (the `wrap` field).
export interface CrewWrapOverlapPair {
  aUserId: string;
  aName: string;
  bUserId: string;
  bName: string;
  shared: number;
  sharedSets: string[];
}
export interface CrewWrapSeenTogether {
  setId: string;
  artist: string | null;
  count: number;
}
export interface CrewWrapMemberSummary {
  userId: string;
  name: string;
  topSets: { setId: string; artist: string | null; rating: number }[];
}
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
              color: '#9999bb',
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
                <div style={{ fontSize: 28, fontWeight: 800, color: '#00e8d0', flexShrink: 0 }}>{s.count} loved it</div>
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
            <div style={{ fontSize: 48, fontWeight: 800, color: '#ff3366', lineHeight: 1 }}>{t.value}</div>
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
          color: '#9999bb',
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
