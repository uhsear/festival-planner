import { View, Text, StyleSheet } from 'react-native';

interface PosterSet {
  rating: number;
  artist: string;
  stageName?: string | null;
}
interface PosterStats {
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
 * Fixed 1080×1920 (9:16) festival-wrap poster, rendered off-screen and captured
 * to a PNG via react-native-view-shot for sharing to stories. A native mirror
 * of the web WrapPoster: all dimensions are literal pixels so the capture is
 * identical regardless of device. RN can't gradient-clip text or do CSS radial
 * gradients, so the FESTIE wordmark is solid coral and the background is flat
 * #080810 (close enough; the web poster is the high-fidelity version).
 */
export default function WrapPoster({ festivalName, topSets, stats }: Props) {
  const statCells = [
    { label: 'Sets', value: String(stats.totalRated) },
    { label: 'Stages', value: String(stats.stagesVisited) },
    { label: 'Days', value: String(stats.daysAttended) },
    { label: 'Hours', value: stats.totalHours.toFixed(1) },
  ];
  return (
    <View style={s.poster}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.wordmark}>FESTIE</Text>
        <Text style={s.kicker}>YOUR FESTIVAL WRAP</Text>
        <Text style={s.festival} numberOfLines={2}>{festivalName}</Text>
      </View>

      {/* Top sets */}
      <View style={s.topWrap}>
        <Text style={s.topHeading}>TOP SETS</Text>
        {topSets.slice(0, 5).map((set, i) => (
          <View key={set.artist || i} style={s.topRow}>
            <Text style={s.topEmoji}>{EMOJI[set.rating] || '⭐'}</Text>
            <View style={s.topInfo}>
              <Text style={s.topArtist} numberOfLines={1}>{set.artist}</Text>
              {set.stageName ? <Text style={s.topStage} numberOfLines={1}>{set.stageName}</Text> : null}
            </View>
            <Text style={s.topRank}>#{i + 1}</Text>
          </View>
        ))}
      </View>

      {/* Stats grid */}
      <View style={s.statsGrid}>
        {statCells.map((cell) => (
          <View key={cell.label} style={s.statCell}>
            <Text style={s.statValue}>{cell.value}</Text>
            <Text style={s.statLabel}>{cell.label.toUpperCase()}</Text>
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
  wordmark: {
    fontSize: 96,
    fontWeight: '900',
    letterSpacing: 8,
    color: '#ff3366',
    lineHeight: 104,
  },
  kicker: {
    fontSize: 32,
    color: '#eaeaf2',
    opacity: 0.7,
    marginTop: 16,
    letterSpacing: 3,
  },
  festival: {
    fontSize: 56,
    fontWeight: '700',
    color: '#eaeaf2',
    marginTop: 18,
    textAlign: 'center',
  },
  topWrap: { marginTop: 90, flex: 1 },
  topHeading: {
    fontSize: 28,
    letterSpacing: 4,
    color: '#9999bb',
    marginBottom: 24,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  topEmoji: { fontSize: 64, width: 96, textAlign: 'center' },
  topInfo: { flex: 1, paddingHorizontal: 24 },
  topArtist: { fontSize: 40, fontWeight: '700', color: '#eaeaf2' },
  topStage: { fontSize: 24, color: '#eaeaf2', opacity: 0.55, marginTop: 4 },
  topRank: { fontSize: 32, fontWeight: '800', color: '#00e8d0', width: 100, textAlign: 'right' },
  statsGrid: {
    marginTop: 60,
    flexDirection: 'row',
    gap: 18,
  },
  statCell: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 28,
    alignItems: 'center',
  },
  statValue: { fontSize: 56, fontWeight: '800', color: '#ff3366', lineHeight: 60 },
  statLabel: { fontSize: 20, color: '#eaeaf2', opacity: 0.65, marginTop: 8, letterSpacing: 3 },
  footer: {
    textAlign: 'center',
    marginTop: 60,
    fontSize: 28,
    color: '#eaeaf2',
    opacity: 0.45,
    letterSpacing: 6,
  },
});
