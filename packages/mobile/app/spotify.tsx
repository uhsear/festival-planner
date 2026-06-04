import { View, Text, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFestivalDataStore } from '@festie/shared/stores';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import EmptyState from '../components/EmptyState';
import SpotifyConnect from '../components/SpotifyConnect';

/**
 * Spotify (M4, MOBILE) — connect your Spotify, auto-suggest picks from your top
 * & followed artists on this festival's lineup, and build a playlist from your
 * picks. A mobile mirror of the web SpotifyConnect surface.
 *
 * This is a BEFORE-festival, online-only feature: it talks to Spotify's API
 * through the backend, so it needs a live connection. The connect/suggest/
 * playlist actions are not offline-honest features — accepted suggestions,
 * however, flow through the offline-native pick path (savePick) once chosen.
 */
export default function SpotifyScreen() {
  const t = useTokens();
  const styles = useStyles();

  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const currentFestivalId = useFestivalDataStore((s) => s.currentFestivalId);
  const festivalId = currentFestivalId ?? currentFestival?.id ?? null;

  if (!festivalId) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Spotify', headerShown: true }} />
        <EmptyState
          icon="musical-notes-outline"
          title="No festival selected"
          message="Open a festival first, then connect Spotify to get pick suggestions from your top artists."
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Spotify', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text style={styles.introTitle}>{currentFestival?.name ?? 'This festival'}</Text>
          <Text style={styles.introSub}>
            Connect Spotify to suggest picks from your top &amp; followed artists on this lineup, then build a playlist
            from what you pick.
          </Text>
        </View>

        <SpotifyConnect festivalId={festivalId} />

        <View style={styles.note}>
          <Ionicons name="cloud-outline" size={14} color={t.colors.text.muted} />
          <Text style={styles.noteText}>
            Needs an internet connection — Spotify suggestions and playlists run online.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  content: {
    padding: t.spacing[4],
    gap: t.spacing[4],
  },
  intro: {
    gap: t.spacing[2],
  },
  introTitle: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  introSub: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  noteText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
}));
