import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@festie/shared/tokens';

/**
 * Poster palette — sourced from @festie/shared/tokens (pure data, zero runtime
 * deps) so web and poster stay in sync if the palette evolves. Both sibling
 * posters (CrewWrapPoster + WrapPoster) now follow DC10 Option B: palette from
 * tokens, white-overlay chrome via colors.overlay. The old "deliberately static
 * hex literals" note has been removed — token values only change with explicit
 * brand decisions, so the posters track those changes intentionally.
 */
const POSTER = {
  bg: colors.bg.primary, // #080810
  wordmark: colors.accent.coral, // #ff3366
  text: colors.text.primary, // #eaeaf2
  textMuted: colors.text.secondary, // #9999bb
  rank: colors.accent.aqua, // #00e8d0
} as const;

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
 * Fixed 1080×1920 (9:16) crew-recap poster, rendered off-screen and captured to
 * a PNG via react-native-view-shot for sharing to stories. A native mirror of
 * the web CrewWrapPoster: literal pixel dimensions so the capture is identical
 * regardless of device. RN can't gradient-clip text or do CSS radial gradients,
 * so the FESTIE wordmark is solid coral and the background is flat #080810 (the
 * web poster is the high-fidelity version). Degrades gracefully on empty crews.
 *
 * Palette is sourced from the POSTER constant above (DC10 Option B): both sibling
 * posters (WrapPoster + CrewWrapPoster) read from token values so a brand change
 * updates both consistently. Overlay chrome via colors.overlay.
 */
export default function CrewWrapPoster({ crewName, festivalName, wrap }: Props) {
  const topOverlap = wrap.topOverlap;
  const seenTogether = wrap.setsSeenTogether.slice(0, 5);
  const statCells = [
    { label: 'CREW', value: String(wrap.memberCount) },
    { label: 'SEEN TOGETHER', value: String(wrap.setsSeenTogether.length) },
    { label: 'SPLIT', value: money(wrap.totalSplit) },
  ];

  return (
    <View style={s.poster}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.wordmark}>FESTIE</Text>
        <Text style={s.kicker}>CREW WRAP</Text>
        <Text style={s.crew} numberOfLines={2}>
          {crewName}
        </Text>
        <Text style={s.festival} numberOfLines={1}>
          {festivalName}
        </Text>
      </View>

      {/* Superlatives */}
      <View style={s.body}>
        <View style={s.superlative}>
          <Text style={s.superLabel}>MOST-OVERLAPPING TASTE</Text>
          <Text style={s.superValue} numberOfLines={1}>
            {topOverlap ? `${topOverlap.aName} + ${topOverlap.bName}` : 'Rate more sets together'}
          </Text>
          {topOverlap ? (
            <Text style={s.superSub} numberOfLines={1}>
              {topOverlap.shared} shared favourite{topOverlap.shared === 1 ? '' : 's'}
            </Text>
          ) : null}
        </View>

        <View style={s.superlative}>
          <Text style={s.superLabel}>BIGGEST SPENDER</Text>
          <Text style={s.superValue} numberOfLines={1}>
            {wrap.biggestSpender ? wrap.biggestSpender.name : 'No expenses yet'}
          </Text>
          {wrap.biggestSpender ? <Text style={s.superSub}>fronted {money(wrap.biggestSpender.amount)}</Text> : null}
        </View>

        <View style={s.seenWrap}>
          <Text style={s.superLabel}>SETS YOU SAW TOGETHER</Text>
          {seenTogether.length > 0 ? (
            seenTogether.map((set) => (
              <View key={set.setId} style={s.seenRow}>
                <Text style={s.seenArtist} numberOfLines={1}>
                  {set.artist || set.setId}
                </Text>
                <Text style={s.seenCount}>{set.count} loved it</Text>
              </View>
            ))
          ) : (
            <Text style={s.empty}>No 4★+ sets two of you both rated — yet.</Text>
          )}
        </View>
      </View>

      {/* Stats grid */}
      <View style={s.statsGrid}>
        {statCells.map((cell) => (
          <View key={cell.label} style={s.statCell}>
            <Text style={s.statValue}>{cell.value}</Text>
            <Text style={s.statLabel}>{cell.label}</Text>
          </View>
        ))}
      </View>

      <Text style={s.footer}>FESTIE.US</Text>
    </View>
  );
}

const s = StyleSheet.create({
  poster: {
    width: 1080,
    height: 1920,
    backgroundColor: POSTER.bg,
    padding: 80,
    flexDirection: 'column',
  },
  header: { alignItems: 'center' },
  wordmark: {
    // F25: Syncopate_700Bold for the FESTIE wordmark — matches web CrewWrapPoster.
    // '900' was inert on native (no loaded cut above 700Bold); drop it.
    fontFamily: 'Syncopate_700Bold',
    fontSize: 96,
    letterSpacing: 8,
    color: POSTER.wordmark,
    lineHeight: 104,
  },
  kicker: {
    fontFamily: 'SpaceGrotesk_400Regular',
    fontSize: 32,
    color: POSTER.text,
    opacity: 0.7,
    marginTop: 16,
    letterSpacing: 3,
  },
  crew: {
    // F25: SpaceGrotesk_700Bold for crew name heading.
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 56,
    color: POSTER.text,
    marginTop: 18,
    textAlign: 'center',
  },
  festival: {
    fontFamily: 'SpaceGrotesk_400Regular',
    fontSize: 30,
    color: POSTER.text,
    opacity: 0.6,
    marginTop: 8,
    textAlign: 'center',
  },
  body: { marginTop: 60, flex: 1 },
  superlative: { marginBottom: 36 },
  superLabel: {
    fontFamily: 'SpaceGrotesk_500Medium',
    fontSize: 26,
    letterSpacing: 4,
    color: POSTER.textMuted,
    marginBottom: 10,
  },
  superValue: {
    // F25: SpaceGrotesk_700Bold — '800' was inert, clamp to 700.
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 44,
    color: POSTER.text,
  },
  superSub: {
    fontFamily: 'SpaceGrotesk_400Regular',
    fontSize: 26,
    color: POSTER.text,
    opacity: 0.6,
    marginTop: 4,
  },
  seenWrap: { marginTop: 8 },
  seenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    borderBottomWidth: 1,
    // DC10: overlay[4] = rgba(255,255,255,0.08) — token-sourced divider.
    borderBottomColor: colors.overlay[4],
  },
  seenArtist: {
    // F25: SpaceGrotesk_700Bold for artist names.
    fontFamily: 'SpaceGrotesk_700Bold',
    flex: 1,
    fontSize: 38,
    color: POSTER.text,
  },
  seenCount: {
    // F25: SpaceGrotesk_700Bold — '800' was inert, clamp to 700.
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 28,
    color: POSTER.rank,
  },
  empty: {
    fontFamily: 'SpaceGrotesk_400Regular',
    fontSize: 30,
    color: POSTER.text,
    opacity: 0.55,
    marginTop: 8,
  },
  statsGrid: { marginTop: 40, flexDirection: 'row', gap: 18 },
  statCell: {
    flex: 1,
    // DC10: overlay[2] = rgba(255,255,255,0.04) — aligned with WrapPoster
    // stat-cell fill; both posters now share the same overlay value.
    backgroundColor: colors.overlay[2],
    // F48: 24 is off-scale; snap to 20 (radii.lg). StyleSheet.create can't
    // reference the token object, but the value mirrors it exactly.
    borderRadius: 20, // radii.lg
    borderWidth: 1,
    // DC10: overlay[4] = rgba(255,255,255,0.08).
    borderColor: colors.overlay[4],
    paddingVertical: 28,
    alignItems: 'center',
  },
  statValue: {
    // F25: SpaceGrotesk_700Bold — '800' was inert, clamp to 700.
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 48,
    color: POSTER.wordmark,
    lineHeight: 52,
  },
  statLabel: {
    fontFamily: 'SpaceGrotesk_400Regular',
    fontSize: 20,
    color: POSTER.text,
    opacity: 0.65,
    marginTop: 8,
    letterSpacing: 2,
    textAlign: 'center',
  },
  footer: {
    fontFamily: 'SpaceGrotesk_400Regular',
    textAlign: 'center',
    marginTop: 40,
    fontSize: 28,
    color: POSTER.text,
    opacity: 0.45,
    letterSpacing: 6,
  },
});
