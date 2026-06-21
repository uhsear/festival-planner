import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import { parseLineupCsv, type LineupRow } from '@festie/shared/utils';
import ScreenHeader from '../../components/ScreenHeader';
import SectionLabel from '../../components/SectionLabel';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import Button from '../../components/Button';
import { ConfirmDialog, LabeledTextInput } from '../../components/admin';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin — Lineup import. The native mirror of the web admin LineupImport
 * (packages/web/src/components/admin/LineupImport.tsx): paste CSV/TSV, parse it
 * with the SHARED parseLineupCsv util, preview the parsed rows + any errors,
 * then POST the rows to the same endpoint the web console uses:
 *   POST /admin/festivals/:id/import-lineup  body { sets: LineupRow[] }
 *
 * No business logic lives here — parsing is shared, the POST is the generic
 * api.post. This screen is the native UI only.
 *
 * Route: /admin/lineup-import?id=<festivalId>. Lives under app/admin/ so the
 * root AuthGate (seg[0] === 'admin') guards it. The import is destructive (it
 * replaces a festival's lineup), so it is gated behind ConfirmDialog before the
 * api call fires — the same destructive-confirm discipline as the rest of the
 * admin write surface. Back-navigates to '/admin'.
 */
export default function LineupImportScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { id: festivalId } = useLocalSearchParams<{ id?: string }>();

  const [importText, setImportText] = useState('');
  const [preview, setPreview] = useState<LineupRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [parsed, setParsed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [resultError, setResultError] = useState(false);

  // Safe dismiss: a cold deep link has no back stack, so router.back() would
  // strand the user on a blank screen. Fall back to the admin root.
  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/admin');
    }
  }, [router]);

  const handleParse = useCallback(() => {
    const { rows, errors: parseErrors } = parseLineupCsv(importText);
    setPreview(rows);
    setErrors(parseErrors);
    setParsed(true);
    setResultMessage(null);
    setResultError(false);
  }, [importText]);

  const handleClear = useCallback(() => {
    setImportText('');
    setPreview([]);
    setErrors([]);
    setParsed(false);
    setResultMessage(null);
    setResultError(false);
  }, []);

  const handleImport = useCallback(async () => {
    setConfirmVisible(false);
    if (!festivalId || preview.length === 0) return;
    setImporting(true);
    setResultMessage(null);
    setResultError(false);
    try {
      await api.post<void>(`/admin/festivals/${festivalId}/import-lineup`, { sets: preview });
      const count = preview.length;
      handleClear();
      setResultMessage(`Imported ${count} set${count === 1 ? '' : 's'}.`);
      setResultError(false);
    } catch (err: unknown) {
      setResultMessage(err instanceof Error ? err.message : 'Import failed.');
      setResultError(true);
    } finally {
      setImporting(false);
    }
  }, [festivalId, preview, handleClear]);

  const canImport = preview.length > 0 && !importing;

  const headerListData = useMemo(() => preview, [preview]);

  // Non-admins never reach the data; AuthGate already guards the segment, but
  // mirror the index screen's defensive empty state in case of a direct render.
  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Import lineup" subtitle="Admin" icon="cloud-upload-outline" />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
        <Stack.Screen options={{ headerShown: false }} />
      </View>
    );
  }

  // No festival id in the route — there is nothing to import into.
  if (!festivalId) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Import lineup" subtitle="Admin" icon="cloud-upload-outline" />
        <EmptyState
          icon="alert-circle-outline"
          title="No festival selected"
          message="Open this screen from a festival to import its lineup."
          action={{ label: 'Back to admin', onPress: goBack }}
        />
        <Stack.Screen options={{ headerShown: false }} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Import lineup"
        subtitle="Paste CSV/TSV and preview"
        icon="cloud-upload-outline"
        right={<Button label="Back" variant="ghost" size="sm" icon="chevron-back" onPress={goBack} />}
      />

      <FlatList
        data={headerListData}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {/* Paste area + column reference */}
            <View style={styles.card}>
              <Text style={styles.helpTitle}>Required columns</Text>
              <Text style={styles.helpMono}>dayLabel  date  artist  stage</Text>
              <Text style={styles.helpTitle}>Optional columns</Text>
              <Text style={styles.helpMono}>startTime  endTime  stageColor</Text>
            </View>

            <LabeledTextInput
              label="CSV / TSV data"
              value={importText}
              onChangeText={setImportText}
              placeholder="Paste CSV or TSV data here…"
              autoCapitalize="none"
              multiline
              hint="First row must be the header. Rows missing an artist are skipped."
            />

            <View style={styles.actionsRow}>
              <Button
                label="Parse & preview"
                variant="secondary"
                icon="eye-outline"
                onPress={handleParse}
                disabled={importText.trim().length === 0}
                style={styles.flexBtn}
              />
              {parsed ? (
                <Button
                  label="Clear"
                  variant="ghost"
                  icon="close-outline"
                  onPress={handleClear}
                  style={styles.flexBtn}
                />
              ) : null}
            </View>

            {/* Import result (success or failure) */}
            {resultMessage ? (
              <View style={[styles.banner, resultError ? styles.bannerError : styles.bannerOk]}>
                <Text style={[styles.bannerText, resultError && styles.bannerTextError]}>
                  {resultMessage}
                </Text>
              </View>
            ) : null}

            {/* Errors from the parse */}
            {errors.length > 0 ? (
              <>
                <SectionLabel>Issues found</SectionLabel>
                <View style={[styles.card, styles.errorCard]}>
                  {errors.map((e, i) => (
                    <Text key={i} style={styles.errorLine}>
                      • {e}
                    </Text>
                  ))}
                </View>
              </>
            ) : null}

            {/* Loading overlay while the POST is in flight */}
            {importing ? <LoadingState label={`Importing ${preview.length} sets`} /> : null}

            {preview.length > 0 ? (
              <SectionLabel>Preview ({preview.length} sets)</SectionLabel>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => (
          <View
            style={[styles.card, index < preview.length - 1 && styles.previewSpacer]}
            accessibilityRole="text"
            accessibilityLabel={`${item.artist}, ${item.stage}, ${item.dayLabel} ${item.date}`}
          >
            <View style={styles.previewRow}>
              <Text style={styles.previewArtist} numberOfLines={1}>
                {item.artist}
              </Text>
              <View style={styles.stagePill}>
                <Text style={styles.stagePillText} numberOfLines={1}>
                  {item.stage}
                </Text>
              </View>
            </View>
            <Text style={styles.previewMeta} numberOfLines={1}>
              {item.dayLabel} · {item.date}
              {item.startTime ? ` · ${item.startTime}` : ''}
              {item.endTime ? `–${item.endTime}` : ''}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          parsed && errors.length === 0 && !importing ? (
            <EmptyState
              icon="document-text-outline"
              title="No valid rows"
              message="Nothing parsed from the pasted data. Check the header row and try again."
            />
          ) : null
        }
        ListFooterComponent={
          preview.length > 0 ? (
            <View style={styles.footer}>
              <Button
                label={`Import ${preview.length} set${preview.length === 1 ? '' : 's'}`}
                icon="cloud-upload-outline"
                loading={importing}
                loadingLabel={`Importing ${preview.length} sets`}
                disabled={!canImport}
                onPress={() => setConfirmVisible(true)}
              />
            </View>
          ) : null
        }
      />

      {/* Destructive confirm: importing replaces the festival's lineup. */}
      <ConfirmDialog
        visible={confirmVisible}
        title="Import lineup?"
        message={`This will import ${preview.length} set${preview.length === 1 ? '' : 's'} into this festival, replacing its current lineup. This can't be undone.`}
        confirmLabel="Import"
        destructive
        onConfirm={() => void handleImport()}
        onCancel={() => setConfirmVisible(false)}
      />

      <Stack.Screen options={{ headerShown: false }} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  scroll: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[2],
  },
  headerBlock: {
    gap: t.spacing[3],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    gap: t.spacing[1],
  },
  helpTitle: {
    ...typeStyle('label', 600),
    color: t.colors.text.secondary,
  },
  helpMono: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    marginBottom: t.spacing[2],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: t.spacing[3],
  },
  flexBtn: {
    flex: 1,
  },
  banner: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  bannerOk: {
    backgroundColor: t.colors.bg.secondary,
    borderColor: t.colors.accent.aqua,
  },
  bannerError: {
    backgroundColor: t.colors.bg.secondary,
    borderColor: t.colors.accent.coral,
  },
  bannerText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  bannerTextError: {
    color: t.colors.text.danger,
  },
  errorCard: {
    borderColor: t.colors.accent.coral,
    gap: t.spacing[1],
  },
  errorLine: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
  previewSpacer: {
    marginBottom: t.spacing[2],
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  previewArtist: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  previewMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  stagePill: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    maxWidth: 160,
    flexShrink: 0,
  },
  stagePillText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  footer: {
    marginTop: t.spacing[3],
  },
}));
