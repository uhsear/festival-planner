import { useEffect } from 'react';
import { View, Text } from 'react-native';
import { useCrewStore } from '@festie/shared/stores';
import { timeAgoFromIso, getInitials } from '@festie/shared/utils';
import { CREW_ACTIVITY_LABELS } from '@festie/shared/constants';
import { makeStyles, typeStyle } from '../hooks/useTokens';

interface CrewActivityProps {
  crewId: string;
}

/**
 * Crew activity feed — chronological log of crew events. Polls every 30s so
 * new events appear without socket wiring (mirrors the web ActivityTab). Reads
 * from the shared crewStore; the initial load is kicked off here on mount.
 */
export default function CrewActivity({ crewId }: CrewActivityProps) {
  const styles = useStyles();
  const activity = useCrewStore((s) => s.activity);
  const loadActivity = useCrewStore((s) => s.loadActivity);

  useEffect(() => {
    if (!crewId) return;
    loadActivity(crewId).catch(() => {});
    const interval = setInterval(() => {
      loadActivity(crewId).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, [crewId, loadActivity]);

  // Deduplicate by id — the polling interval can produce duplicate entries if the
  // server returns overlapping pages or the store accumulates repeated loads.
  const dedupedActivity = Array.from(new Map(activity.map((a) => [a.id, a])).values());

  if (dedupedActivity.length === 0) {
    return <Text style={styles.empty}>No activity yet — crew events will appear here as they happen.</Text>;
  }

  return (
    <View style={styles.container}>
      {dedupedActivity.map((it) => {
        const verb = CREW_ACTIVITY_LABELS[it.type] ?? it.type.replace(/-/g, ' ');
        return (
          <View key={it.id} style={styles.row}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(it.username ?? '') || '?'}</Text>
            </View>
            <View style={styles.info}>
              <Text style={styles.line}>
                <Text style={styles.name}>{it.username || 'Someone'}</Text> <Text style={styles.verb}>{verb}</Text>
                {it.detail ? <Text style={styles.verb}>: {it.detail}</Text> : null}
              </Text>
              <Text style={styles.time}>{timeAgoFromIso(it.created_at)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    gap: t.spacing[2],
  },
  empty: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  avatar: {
    width: 32,
    height: 32,
    // Circular: half of width/height = 16. Nearest token is radii.lg (20),
    // but a true circle needs sz/2 — use radii.pill (999) so it stays circular
    // regardless of content (F48 — no off-scale raw radius literals).
    borderRadius: t.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.aquaAlpha[15],
  },
  avatarText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  info: {
    flex: 1,
    gap: t.spacing[1],
  },
  line: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
  },
  name: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  verb: {
    color: t.colors.text.secondary,
  },
  time: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
}));
