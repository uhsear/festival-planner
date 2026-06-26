import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api } from '@festie/shared/services';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

/**
 * GDPR data export for the Account screen — the mobile analog of the web
 * "Export my data" download. Fetches GET /account/export (the full data
 * bundle), writes it to a JSON file in the cache directory, then hands it to
 * the OS share sheet via expo-sharing so the user can save or send it.
 * The server rate-limits exports to 1 / 24h; a 429 surfaces as a friendly note.
 */
export default function AccountDataSection() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await api.get<Record<string, unknown>>('/account/export');
      const json = JSON.stringify(data, null, 2);

      // One fixed filename, overwritten each export. A timestamped name left a
      // fresh full-account JSON bundle in the cache on every tap, forever —
      // a privacy footgun. Overwriting keeps at most one copy on disk.
      const file = new File(Paths.cache, 'festie-data-export.json');
      file.create({ overwrite: true });
      file.write(json);

      haptics.success();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          UTI: 'public.json',
          dialogTitle: 'Export your Festie data',
        });
      } else {
        Alert.alert('Export ready', `Saved to ${file.uri}`);
      }
    } catch (err) {
      haptics.warning();
      const message = err instanceof Error ? err.message : 'Could not export your data.';
      // The server returns 429 with a "Next available" message when rate-limited.
      Alert.alert('Export unavailable', message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.row}
        onPress={() => void handleExport()}
        disabled={busy}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Export my data"
        accessibilityState={{ disabled: busy }}
      >
        <View style={styles.rowIcon}>
          <Ionicons name="download-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Export my data</Text>
          <Text style={styles.rowHint} numberOfLines={1}>
            {busy ? 'Preparing your export…' : 'A JSON copy of your account · once per day'}
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={t.colors.accent.aqua} />
        ) : (
          <Ionicons name="share-outline" size={18} color={t.colors.text.placeholder} />
        )}
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  rowIcon: {
    width: 24,
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  rowTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
}));
