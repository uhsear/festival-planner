import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Share,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@festie/shared/services';
import { useFestivalDataStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { isFestivalOver } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import EmptyState from '../components/EmptyState';

interface WrapStats {
  totalRated: number;
  stagesVisited: number;
  daysAttended: number;
  totalHours: number | null;
}
interface WrapSet {
  setId: string;
  rating: number;
  artist?: string;
  note?: string | null;
  stageId?: string | null;
  stageName?: string | null;
}
interface WrapResponse {
  stats: WrapStats;
  topSets: WrapSet[];
  allRatings: WrapSet[];
}

const EMOJI: Record<number, string> = { 5: '🔥', 4: '😊', 3: '👍', 2: '🤔', 1: '👎' };

/**
 * Festival Wrap — post-festival year-in-review stats + top-rated sets, a mobile
 * mirror of the web /wrap route. Gated on isFestivalOver. The web "share as
 * 1080×1920 PNG poster" is replaced here by a plain text share (RN Share), as
 * native image capture would need an extra dependency.
 */
export default function WrapScreen() {
  const t = useTokens();
  const styles = useStyles();

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const days = useFestivalDataStore((s) => s.days);
  const { getStageName } = useFestival();

  const over = isFestivalOver(currentFestival, days);

  const [data, setData] = useState<WrapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!currentFestival?.id || !over) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    api
      .get<WrapResponse>(`/ratings/wrap/${currentFestival.id}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentFestival?.id, over]);

  const allSorted = useMemo(
    () =>
      (data?.allRatings || [])
        .slice()
        .sort(
          (a, b) => b.rating - a.rating,
        ),
    [data?.allRatings],
  );

  const stageLabel = (s: WrapSet): string =>
    s.stageName || (s.stageId ? getStageName(s.stageId) || 'Stage' : 'Stage');

  const handleShare = async () => {
    if (!data || !currentFestival) return;
    const { stats, topSets } = data;
    const lines = [
      `My ${currentFestival.name} wrap 🎪`,
      `${stats.totalRated} sets rated · ${stats.stagesVisited} stages · ${(stats.totalHours ?? 0).toFixed(1)}h of music`,
      ...topSets.slice(0, 5).map((s, i) => `${i + 1}. ${EMOJI[s.rating] ?? ''} ${s.artist || s.setId}`),
      'festie.us',
    ];
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // User dismissed the share sheet.
    }
  };

  const body = () => {
    if (!currentFestival) {
      return (
        <EmptyState
          icon="sparkles-outline"
          title="Select a festival first"
          message="Your wrap appears here once a festival ends."
        />
      );
    }
    if (!over) {
      return (
        <EmptyState
          icon="sparkles-outline"
          title="Festival wrap coming soon"
          message="We'll put together your highlights the day after the festival ends."
        />
      );
    }
    if (loading) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={t.colors.accent.aqua} />
        </View>
      );
    }
    if (error) {
      return (
        <EmptyState
          icon="sparkles-outline"
          title="Couldn't load your wrap"
          message="Something went wrong loading your festival wrap."
        />
      );
    }

    const stats = data?.stats || {
      totalRated: 0,
      stagesVisited: 0,
      daysAttended: 0,
      totalHours: 0,
    };
    const topSets = data?.topSets || [];
    const totalHours = stats.totalHours ?? 0;

    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerBlock}>
          <View style={styles.kicker}>
            <Ionicons name="sparkles" size={14} color={t.colors.accent.aqua} />
            <Text style={styles.kickerText}>Your Festival Wrap</Text>
          </View>
          <Text style={styles.festivalName}>{currentFestival.name}</Text>
        </View>

        <View style={styles.statsGrid}>
          <Stat label="Sets rated" value={String(stats.totalRated)} />
          <Stat label="Stages visited" value={String(stats.stagesVisited)} />
          <Stat label="Days attended" value={String(stats.daysAttended)} />
          <Stat label="Hours of music" value={totalHours.toFixed(1)} />
        </View>

        {topSets.length > 0 ? (
          <View>
            <Text style={styles.sectionLabel}>Your top picks</Text>
            {topSets.map((s, i) => (
              <View key={s.setId} style={styles.topRow}>
                <Text style={styles.topEmoji}>{EMOJI[s.rating] ?? '⭐'}</Text>
                <View style={styles.topInfo}>
                  <Text style={styles.topMeta}>
                    #{i + 1} · {stageLabel(s)}
                  </Text>
                  <Text style={styles.topArtist} numberOfLines={1}>
                    {s.artist || s.setId}
                  </Text>
                  {s.note ? (
                    <Text style={styles.topNote} numberOfLines={1}>
                      "{s.note}"
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            icon="trophy-outline"
            title="No 4 or 5-star ratings yet"
            message="Rate sets from the set detail screen to build your wrap."
          />
        )}

        {allSorted.length > 0 ? (
          <View>
            <Text style={styles.sectionLabel}>Everything you rated</Text>
            {allSorted.map((s) => (
              <View key={s.setId} style={styles.allRow}>
                <Text style={styles.allEmoji}>{EMOJI[s.rating] ?? '⭐'}</Text>
                <Text style={styles.allArtist} numberOfLines={1}>
                  {s.artist || s.setId}
                </Text>
                <Text style={styles.allStage} numberOfLines={1}>
                  {stageLabel(s)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {stats.totalRated > 0 ? (
          <TouchableOpacity
            style={styles.shareButton}
            onPress={() => void handleShare()}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Share your wrap"
          >
            <Ionicons
              name="share-social-outline"
              size={16}
              color={t.colors.text.onAccent}
            />
            <Text style={styles.shareButtonText}>Share your wrap</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.footer}>festie.us</Text>
      </ScrollView>
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Festival Wrap', headerShown: true }} />
      {body()}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.statBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  loading: {
    paddingVertical: t.spacing[8],
    alignItems: 'center',
  },
  content: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[4],
    gap: t.spacing[4],
  },
  headerBlock: {
    alignItems: 'center',
    gap: t.spacing[1],
  },
  kicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  kickerText: {
    ...typeStyle('micro'),
    textTransform: 'uppercase',
    color: t.colors.accent.aqua,
  },
  festivalName: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  statBox: {
    flexGrow: 1,
    flexBasis: '47%',
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    gap: t.spacing[1],
  },
  statLabel: {
    ...typeStyle('micro'),
    textTransform: 'uppercase',
    color: t.colors.text.muted,
  },
  statValue: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  sectionLabel: {
    ...typeStyle('micro'),
    textTransform: 'uppercase',
    color: t.colors.text.secondary,
    marginBottom: t.spacing[2],
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    marginBottom: t.spacing[2],
  },
  topEmoji: {
    fontSize: 28,
  },
  topInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  topMeta: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  topArtist: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  topNote: {
    ...typeStyle('caption'),
    fontStyle: 'italic',
    color: t.colors.text.secondary,
  },
  allRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  allEmoji: {
    fontSize: 18,
  },
  allArtist: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    flex: 1,
  },
  allStage: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    backgroundColor: t.colors.accent.coral,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
  },
  shareButtonText: {
    ...typeStyle('label'),
    color: t.colors.text.onAccent,
  },
  footer: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
    textAlign: 'center',
    paddingTop: t.spacing[2],
  },
}));
