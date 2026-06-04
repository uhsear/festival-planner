import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@festie/shared/tokens';

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
 * Poster-intent note on colors: the hex literals below (#080810, #ff3366,
 * #eaeaf2, #9999bb, #00e8d0) are deliberately static to lock the captured PNG to
 * the brand palette regardless of any runtime/device theme — this surface is
 * never themed. Only the white-overlay chrome (row dividers, stat-cell fill and
 * border) is routed through the shared `colors.overlay` scale so those alpha
 * values stay in one place.
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
    backgroundColor: '#080810',
    padding: 80,
    flexDirection: 'column',
  },
  header: { alignItems: 'center' },
  wordmark: { fontSize: 96, fontWeight: '900', letterSpacing: 8, color: '#ff3366', lineHeight: 104 },
  kicker: { fontSize: 32, color: '#eaeaf2', opacity: 0.7, marginTop: 16, letterSpacing: 3 },
  crew: { fontSize: 56, fontWeight: '700', color: '#eaeaf2', marginTop: 18, textAlign: 'center' },
  festival: { fontSize: 30, color: '#eaeaf2', opacity: 0.6, marginTop: 8, textAlign: 'center' },
  body: { marginTop: 60, flex: 1 },
  superlative: { marginBottom: 36 },
  superLabel: { fontSize: 26, letterSpacing: 4, color: '#9999bb', marginBottom: 10 },
  superValue: { fontSize: 44, fontWeight: '800', color: '#eaeaf2' },
  superSub: { fontSize: 26, color: '#eaeaf2', opacity: 0.6, marginTop: 4 },
  seenWrap: { marginTop: 8 },
  seenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.overlay[4],
  },
  seenArtist: { flex: 1, fontSize: 38, fontWeight: '700', color: '#eaeaf2' },
  seenCount: { fontSize: 28, fontWeight: '800', color: '#00e8d0' },
  empty: { fontSize: 30, color: '#eaeaf2', opacity: 0.55, marginTop: 8 },
  statsGrid: { marginTop: 40, flexDirection: 'row', gap: 18 },
  statCell: {
    flex: 1,
    backgroundColor: colors.overlay[1],
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.overlay[4],
    paddingVertical: 28,
    alignItems: 'center',
  },
  statValue: { fontSize: 48, fontWeight: '800', color: '#ff3366', lineHeight: 52 },
  statLabel: { fontSize: 20, color: '#eaeaf2', opacity: 0.65, marginTop: 8, letterSpacing: 2, textAlign: 'center' },
  footer: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 28,
    color: '#eaeaf2',
    opacity: 0.45,
    letterSpacing: 6,
  },
});
