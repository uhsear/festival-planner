import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Pressable,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import { timeAgoFromIso } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import SectionLabel from '../../components/SectionLabel';

/**
 * Admin Audit Log — filtered, cursor-paginated view of GET /admin/audit.
 *
 * Filters: action (free text), username/actor_id (free text), from/to date
 * (YYYY-MM-DD, coerced to ISO strings). Pagination uses the cursor the server
 * returns in meta.nextCursor; Prev goes back through a local stack of cursors.
 *
 * Each row is expandable to show the full detail object as formatted JSON.
 * Gated on isAdmin; non-admins see EmptyState and the route is unreachable
 * (AuthGate in the admin segment also gates the whole folder).
 */

interface AuditEntry {
  id: string;
  action: string;
  friendlyAction?: string;
  actorUsername?: string;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  detail?: unknown;
  createdAt: string;
}

interface AuditMeta {
  total: number;
  limit: number;
  nextCursor: string | null;
}

/** Build a query string from non-empty filter values + optional cursor. */
function buildQuery(
  params: {
    action: string;
    actor: string;
    from: string;
    to: string;
  },
  cursor: string | null,
): string {
  const p = new URLSearchParams();
  if (params.action.trim()) p.set('action', params.action.trim());
  if (params.actor.trim()) p.set('actor_id', params.actor.trim());
  if (params.from.trim()) p.set('from', new Date(params.from.trim()).toISOString());
  if (params.to.trim()) p.set('to', new Date(params.to.trim()).toISOString());
  if (cursor) p.set('cursor', cursor);
  p.set('limit', '25');
  const qs = p.toString();
  return qs ? `/admin/audit?${qs}` : '/admin/audit?limit=25';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s.trim())) return false;
  const d = new Date(s.trim());
  return !isNaN(d.getTime());
}

export default function AdminAuditScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.isAdmin);

  // Filter state
  const [filterAction, setFilterAction] = useState('');
  const [filterActor, setFilterActor] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Applied filters (separate from pending edits so we only re-fetch on submit)
  const [appliedAction, setAppliedAction] = useState('');
  const [appliedActor, setAppliedActor] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  // Pagination
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // cursorStack holds previous cursors for back-navigation. isPrevAvailable mirrors
  // stack.length > 0 as state so it is safe to read during render (refs must not
  // be read during render — react-hooks/refs).
  const cursorStack = useRef<string[]>([]);
  const [isPrevAvailable, setIsPrevAvailable] = useState(false);

  // Data
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  // Expanded row ids
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Filter panel open
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Validation errors
  const fromError = filterFrom.trim() && !isValidDate(filterFrom) ? 'Use YYYY-MM-DD' : null;
  const toError = filterTo.trim() && !isValidDate(filterTo) ? 'Use YYYY-MM-DD' : null;

  const fetchAudit = useCallback(
    async (cursor: string | null, applied: { action: string; actor: string; from: string; to: string }) => {
      setError(false);
      try {
        const url = buildQuery(applied, cursor);
        // The API wrapper unwraps { data, error } envelopes, but audit returns
        // { entries, meta } directly inside data — handle both shapes.
        const raw = await api.get<unknown>(url);
        let entriesArr: AuditEntry[] = [];
        let metaObj: AuditMeta = { total: 0, limit: 25, nextCursor: null };

        if (raw && typeof raw === 'object') {
          const r = raw as Record<string, unknown>;
          if (Array.isArray(r.entries ?? r)) {
            // Shape: { entries: [...], meta: { ... } }
            entriesArr = Array.isArray(r.entries) ? (r.entries as AuditEntry[]) : [];
            if (r.meta && typeof r.meta === 'object') {
              const m = r.meta as Record<string, unknown>;
              metaObj = {
                total: typeof m.total === 'number' ? m.total : 0,
                limit: typeof m.limit === 'number' ? m.limit : 25,
                nextCursor: typeof m.nextCursor === 'string' ? m.nextCursor : null,
              };
            }
          } else if (Array.isArray(raw)) {
            // Fallback: bare array (legacy wrapper)
            entriesArr = raw as AuditEntry[];
          }
        }

        setEntries(entriesArr);
        setTotal(metaObj.total);
        setNextCursor(metaObj.nextCursor);
      } catch {
        setError(true);
      }
    },
    [],
  );

  const applied = { action: appliedAction, actor: appliedActor, from: appliedFrom, to: appliedTo };

  useEffect(() => {
    if (!isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load-once guard: non-admins have nothing to fetch, so clear the initial loading flag. Tied to the fetch lifecycle, not derivable from render inputs.
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchAudit(currentCursor, applied).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only re-fetch when applied filters or cursor change
  }, [isAdmin, appliedAction, appliedActor, appliedFrom, appliedTo, currentCursor]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchAudit(currentCursor, applied).finally(() => setRefreshing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCursor, appliedAction, appliedActor, appliedFrom, appliedTo]);

  const applyFilters = useCallback(() => {
    if (fromError || toError) return;
    // Reset to first page whenever filters change
    cursorStack.current = [];
    setIsPrevAvailable(false);
    setCurrentCursor(null);
    setAppliedAction(filterAction);
    setAppliedActor(filterActor);
    setAppliedFrom(filterFrom);
    setAppliedTo(filterTo);
    setFiltersOpen(false);
  }, [filterAction, filterActor, filterFrom, filterTo, fromError, toError]);

  const clearFilters = useCallback(() => {
    setFilterAction('');
    setFilterActor('');
    setFilterFrom('');
    setFilterTo('');
    cursorStack.current = [];
    setIsPrevAvailable(false);
    setCurrentCursor(null);
    setAppliedAction('');
    setAppliedActor('');
    setAppliedFrom('');
    setAppliedTo('');
    setFiltersOpen(false);
  }, []);

  const goNext = useCallback(() => {
    if (!nextCursor) return;
    cursorStack.current = [...cursorStack.current, currentCursor ?? ''];
    setIsPrevAvailable(true);
    setCurrentCursor(nextCursor);
  }, [nextCursor, currentCursor]);

  const goPrev = useCallback(() => {
    const stack = cursorStack.current;
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1] ?? null;
    cursorStack.current = stack.slice(0, -1);
    setIsPrevAvailable(stack.length > 1);
    setCurrentCursor(prev === '' ? null : prev);
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const hasActiveFilters = !!(appliedAction || appliedActor || appliedFrom || appliedTo);

  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + t.spacing[4] }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={t.iconSize.md} color={t.colors.accent.aqua} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Text
            style={styles.headerTitleText}
            numberOfLines={1}
            adjustsFontSizeToFit
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            accessibilityRole="header"
          >
            Audit Log
          </Text>
          {total !== null ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {total.toLocaleString()} entries{hasActiveFilters ? ' (filtered)' : ''}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => setFiltersOpen((v) => !v)}
          style={[styles.filterButton, hasActiveFilters && styles.filterButtonActive]}
          accessibilityRole="button"
          accessibilityLabel={filtersOpen ? 'Close filters' : 'Open filters'}
          accessibilityState={{ expanded: filtersOpen }}
        >
          <Ionicons
            name={hasActiveFilters ? 'filter' : 'filter-outline'}
            size={t.iconSize.md}
            color={hasActiveFilters ? t.colors.accent.aqua : t.colors.text.secondary}
          />
        </TouchableOpacity>
      </View>

      {/* Filter panel (collapsible) */}
      {filtersOpen ? (
        <View style={styles.filterPanel}>
          <View style={styles.filterRow}>
            <FilterInput
              label="Action"
              value={filterAction}
              onChangeText={setFilterAction}
              placeholder="e.g. user.login"
            />
            <FilterInput
              label="User"
              value={filterActor}
              onChangeText={setFilterActor}
              placeholder="username or ID"
            />
          </View>
          <View style={styles.filterRow}>
            <FilterInput
              label="From"
              value={filterFrom}
              onChangeText={setFilterFrom}
              placeholder="YYYY-MM-DD"
              error={fromError}
              keyboardType="numbers-and-punctuation"
            />
            <FilterInput
              label="To"
              value={filterTo}
              onChangeText={setFilterTo}
              placeholder="YYYY-MM-DD"
              error={toError}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.filterActions}>
            <TouchableOpacity
              style={[styles.filterActionBtn, styles.filterClearBtn]}
              onPress={clearFilters}
              accessibilityRole="button"
              accessibilityLabel="Clear filters"
            >
              <Text style={styles.filterClearLabel}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.filterActionBtn,
                styles.filterApplyBtn,
                !!(fromError || toError) && styles.filterApplyBtnDisabled,
              ]}
              onPress={applyFilters}
              disabled={!!(fromError || toError)}
              accessibilityRole="button"
              accessibilityLabel="Apply filters"
            >
              <Text style={styles.filterApplyLabel}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {loading ? (
        <LoadingState label="Loading audit log" />
      ) : error ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load audit log"
          message="Something went wrong reaching the server."
          action={{ label: 'Try again', onPress: onRefresh }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={t.colors.accent.aqua}
              colors={[t.colors.accent.aqua]}
            />
          }
        >
          <SectionLabel>
            {entries.length > 0
              ? `${entries.length} entries${isPrevAvailable || nextCursor ? ' (page)' : ''}`
              : 'No entries'}
          </SectionLabel>

          {entries.length === 0 ? (
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.rowHint}>
                  {hasActiveFilters ? 'No entries match the current filters.' : 'No audit entries found.'}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.card}>
              {entries.map((entry, i) => {
                const isExpanded = expandedIds.has(entry.id);
                const isLast = i === entries.length - 1;
                return (
                  <View key={entry.id ?? i}>
                    <Pressable
                      style={[styles.row, !isLast && styles.rowDivider]}
                      onPress={() => toggleExpand(entry.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`${entry.friendlyAction ?? entry.action} by ${entry.actorUsername ?? 'system'}, ${timeAgoFromIso(entry.createdAt)}. ${isExpanded ? 'Collapse' : 'Expand'} details.`}
                      accessibilityState={{ expanded: isExpanded }}
                    >
                      <View style={styles.rowBody}>
                        <Text style={styles.rowTitle} numberOfLines={isExpanded ? undefined : 1}>
                          {entry.friendlyAction ?? entry.action}
                        </Text>
                        <Text style={styles.rowHint} numberOfLines={1}>
                          {entry.actorUsername ?? 'system'}
                          {entry.resourceType ? ` · ${entry.resourceType}` : ''}
                          {' · '}
                          {timeAgoFromIso(entry.createdAt)}
                        </Text>
                        {isExpanded ? (
                          <View style={styles.detailBox}>
                            {entry.resourceId ? (
                              <Text style={styles.detailLine} selectable>
                                <Text style={styles.detailKey}>ID: </Text>
                                {entry.resourceId}
                              </Text>
                            ) : null}
                            {entry.actorId ? (
                              <Text style={styles.detailLine} selectable>
                                <Text style={styles.detailKey}>Actor ID: </Text>
                                {entry.actorId}
                              </Text>
                            ) : null}
                            <Text style={styles.detailLine} selectable>
                              <Text style={styles.detailKey}>Timestamp: </Text>
                              {new Date(entry.createdAt).toLocaleString()}
                            </Text>
                            {entry.detail !== undefined && entry.detail !== null ? (
                              <Text style={styles.detailLine} selectable>
                                <Text style={styles.detailKey}>Detail: </Text>
                                {JSON.stringify(entry.detail, null, 2)}
                              </Text>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                      <Ionicons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={t.iconSize.sm}
                        color={t.colors.text.muted}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}

          {/* Pagination controls */}
          {(isPrevAvailable || nextCursor) ? (
            <View style={styles.paginationRow}>
              <TouchableOpacity
                style={[styles.pageBtn, !isPrevAvailable && styles.pageBtnDisabled]}
                onPress={goPrev}
                disabled={!isPrevAvailable}
                accessibilityRole="button"
                accessibilityLabel="Previous page"
                accessibilityState={{ disabled: !isPrevAvailable }}
              >
                <Ionicons
                  name="chevron-back"
                  size={t.iconSize.sm}
                  color={isPrevAvailable ? t.colors.accent.aqua : t.colors.text.muted}
                />
                <Text style={[styles.pageBtnLabel, !isPrevAvailable && styles.pageBtnLabelDisabled]}>
                  Prev
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.pageBtn, !nextCursor && styles.pageBtnDisabled]}
                onPress={goNext}
                disabled={!nextCursor}
                accessibilityRole="button"
                accessibilityLabel="Next page"
                accessibilityState={{ disabled: !nextCursor }}
              >
                <Text style={[styles.pageBtnLabel, !nextCursor && styles.pageBtnLabelDisabled]}>
                  Next
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={t.iconSize.sm}
                  color={nextCursor ? t.colors.accent.aqua : t.colors.text.muted}
                />
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Inline filter text-input (local to this screen — simpler than importing
// LabeledTextInput because we need 2-column layout with tight spacing).
// ---------------------------------------------------------------------------

interface FilterInputProps {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  error?: string | null;
  keyboardType?: 'default' | 'numbers-and-punctuation';
}

function FilterInput({ label, value, onChangeText, placeholder, error, keyboardType = 'default' }: FilterInputProps) {
  const t = useTokens();
  const styles = useFilterStyles();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, focused && styles.inputFocused, error ? styles.inputError : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.colors.text.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={label}
      />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const useFilterStyles = makeStyles((t) => ({
  field: {
    flex: 1,
    gap: t.spacing[1],
  },
  label: {
    ...typeStyle('caption', 600),
    color: t.colors.text.secondary,
  },
  input: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    backgroundColor: t.colors.bg.primary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 44,
  },
  inputFocused: {
    borderColor: t.colors.accent.aqua,
  },
  inputError: {
    borderColor: t.colors.accent.coral,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
}));

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    flex: 1,
    gap: t.spacing[1],
  },
  headerTitleText: {
    ...typeStyle('heading'),
    lineHeight: undefined,
    color: t.colors.text.primary,
  },
  headerSubtitle: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  filterButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    flexShrink: 0,
  },
  filterButtonActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  filterPanel: {
    backgroundColor: t.colors.bg.secondary,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    gap: t.spacing[3],
  },
  filterRow: {
    flexDirection: 'row',
    gap: t.spacing[3],
  },
  filterActions: {
    flexDirection: 'row',
    gap: t.spacing[3],
    justifyContent: 'flex-end',
  },
  filterActionBtn: {
    minHeight: 44,
    paddingHorizontal: t.spacing[4],
    borderRadius: t.radii.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterClearBtn: {
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  filterClearLabel: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  filterApplyBtn: {
    backgroundColor: t.colors.accent.aqua,
  },
  filterApplyBtnDisabled: {
    opacity: 0.4,
  },
  filterApplyLabel: {
    ...typeStyle('label', 600),
    color: t.colors.text.onLightAccent,
  },
  scroll: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[2],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
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
  detailBox: {
    marginTop: t.spacing[2],
    padding: t.spacing[3],
    backgroundColor: t.colors.bg.primary,
    borderRadius: t.radii.sm,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    gap: t.spacing[1],
  },
  detailLine: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  detailKey: {
    ...typeStyle('caption', 600),
    color: t.colors.text.secondary,
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: t.spacing[3],
    marginTop: t.spacing[2],
  },
  pageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 44,
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.secondary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  pageBtnDisabled: {
    opacity: 0.4,
  },
  pageBtnLabel: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
  pageBtnLabelDisabled: {
    color: t.colors.text.muted,
  },
}));
