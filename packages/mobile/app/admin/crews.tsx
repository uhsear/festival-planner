import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import type { Festival } from '@festie/shared/types';
import ScreenHeader from '../../components/ScreenHeader';
import SectionLabel from '../../components/SectionLabel';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import Button from '../../components/Button';
import { ConfirmDialog } from '../../components/admin';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin — Crew management + bulk operations. The native mirror of the web admin
 * crew console (packages/web/src/components/admin/AdminCrews.tsx) plus the bulk
 * moderation ops backed by routes/admin-bulk.ts. No business logic lives here —
 * every call is the generic api.*; parsing/validation is server-side.
 *
 * Surfaces, against the same endpoints the web console uses:
 *   GET    /admin/crews                     → crew rows (with memberCount, creator)
 *   GET    /admin/crews/:id/members         → member rows (userId/username/role)
 *   DELETE /admin/crews/:id                 → delete a crew entirely
 *   GET    /admin/users                     → users (force-logout candidates)
 *   GET    /festivals                       → festivals (archive candidates)
 *   POST   /admin/bulk/deactivate    body { userIds }     → force-logout users
 *   POST   /admin/bulk/archive-festivals body { festivalIds } → archive festivals
 *
 * EVERY destructive write (delete crew, force-logout, archive) is gated behind
 * ConfirmDialog before the api call fires — the same destructive-confirm
 * discipline as the rest of the admin write surface.
 *
 * Route: /admin/crews. Lives under app/admin/ so the root AuthGate
 * (seg[0] === 'admin') guards it. Back-navigates to '/admin'.
 */

// ── Shapes ───────────────────────────────────────────────────────
// Crew rows from /admin/crews. memberCount arrives as a Postgres COUNT (a
// string); coerce defensively at render time.
interface Crew {
  id: string;
  name: string;
  festivalId: string;
  createdBy: string;
  creatorUsername?: string | null;
  festivalName?: string | null;
  memberCount: number | string;
  createdAt: string;
}

// Raw getMembers rows (admin-bulk.ts returns them unserialized).
interface CrewMember {
  userId: string;
  username?: string | null;
  role?: string | null;
}

interface AdminUser {
  id: string;
  username: string;
  email: string;
  roles: string[];
}

type ConfirmKind = 'delete-crew' | 'force-logout' | 'archive';
interface ConfirmState {
  kind: ConfirmKind;
  title: string;
  message: string;
}

function memberCountOf(c: Crew): number {
  const n = typeof c.memberCount === 'number' ? c.memberCount : parseInt(String(c.memberCount), 10);
  return Number.isFinite(n) ? n : 0;
}

export default function AdminCrewsScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [crews, setCrews] = useState<Crew[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [festivals, setFestivals] = useState<Festival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [membersByCrew, setMembersByCrew] = useState<Record<string, CrewMember[]>>({});
  const [membersLoading, setMembersLoading] = useState<Record<string, boolean>>({});

  // Bulk-ops selections (Sets of ids) + collapsed/expanded section state.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [selectedFestivalIds, setSelectedFestivalIds] = useState<Set<string>>(new Set());

  // The pending destructive action + the id(s) it targets. The parent owns the
  // ConfirmDialog visibility, mirroring the lineup-import + Account inline edits.
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmTargetId, setConfirmTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [banner, setBanner] = useState<{ text: string; error: boolean } | null>(null);

  // Safe dismiss: a cold deep link has no back stack, so router.back() would
  // strand the user on a blank screen. Fall back to the admin root.
  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/admin');
    }
  }, [router]);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [crewRows, userRows, festivalRows] = await Promise.all([
        api.get<Crew[]>('/admin/crews'),
        api.get<AdminUser[]>('/admin/users'),
        api.get<Festival[]>('/festivals'),
      ]);
      setCrews(Array.isArray(crewRows) ? crewRows : []);
      setUsers(Array.isArray(userRows) ? userRows : []);
      setFestivals(Array.isArray(festivalRows) ? festivalRows : []);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load-once guard: non-admins have nothing to fetch, so clear the initial loading flag.
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, load]);

  const loadCrewMembers = useCallback(
    async (crewId: string) => {
      if (membersByCrew[crewId]) return; // cached — re-expand is instant
      setMembersLoading((prev) => ({ ...prev, [crewId]: true }));
      try {
        const result = await api.get<CrewMember[]>(`/admin/crews/${crewId}/members`);
        setMembersByCrew((prev) => ({ ...prev, [crewId]: Array.isArray(result) ? result : [] }));
      } catch {
        setBanner({ text: "Couldn't load members. Try again.", error: true });
      } finally {
        setMembersLoading((prev) => ({ ...prev, [crewId]: false }));
      }
    },
    [membersByCrew],
  );

  const toggleExpand = useCallback(
    (crewId: string) => {
      if (expandedId === crewId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(crewId);
      void loadCrewMembers(crewId);
    },
    [expandedId, loadCrewMembers],
  );

  const toggleSelect = useCallback((set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }, []);

  const filteredCrews = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return crews;
    return crews.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.creatorUsername || c.createdBy || '').toLowerCase().includes(q) ||
        (c.festivalName || '').toLowerCase().includes(q),
    );
  }, [crews, search]);

  // ── Destructive-action requests (open the confirm) ───────────────
  const requestDeleteCrew = useCallback((crew: Crew) => {
    const links = `${memberCountOf(crew)} member link${memberCountOf(crew) === 1 ? '' : 's'}`;
    setConfirmTargetId(crew.id);
    setConfirm({
      kind: 'delete-crew',
      title: `Delete ${crew.name}?`,
      message: `This removes the crew and all ${links}. Members lose access to shared picks. This can't be undone.`,
    });
  }, []);

  const requestForceLogout = useCallback(() => {
    const n = selectedUserIds.size;
    if (n === 0) return;
    setConfirmTargetId(null);
    setConfirm({
      kind: 'force-logout',
      title: `Force logout ${n} user${n === 1 ? '' : 's'}?`,
      message: `This clears the selected user${n === 1 ? "'s" : "s'"} active sessions, signing them out everywhere. They can sign back in with unchanged credentials.`,
    });
  }, [selectedUserIds]);

  const requestArchive = useCallback(() => {
    const n = selectedFestivalIds.size;
    if (n === 0) return;
    setConfirmTargetId(null);
    setConfirm({
      kind: 'archive',
      title: `Archive ${n} festival${n === 1 ? '' : 's'}?`,
      message: `This soft-deletes the selected festival${n === 1 ? '' : 's'} and evicts their crew rooms. Attendees lose access until restored.`,
    });
  }, [selectedFestivalIds]);

  // ── Confirmed actions (fire the api call) ────────────────────────
  const runConfirmed = useCallback(async () => {
    if (!confirm) return;
    setBusy(true);
    setBanner(null);
    try {
      if (confirm.kind === 'delete-crew' && confirmTargetId) {
        const name = crews.find((c) => c.id === confirmTargetId)?.name || 'crew';
        await api.delete<void>(`/admin/crews/${confirmTargetId}`);
        setCrews((prev) => prev.filter((c) => c.id !== confirmTargetId));
        if (expandedId === confirmTargetId) setExpandedId(null);
        setBanner({ text: `Deleted ${name}.`, error: false });
      } else if (confirm.kind === 'force-logout') {
        const userIds = Array.from(selectedUserIds);
        await api.post<void>('/admin/bulk/deactivate', { userIds });
        setSelectedUserIds(new Set());
        setBanner({ text: `Forced logout for ${userIds.length} user${userIds.length === 1 ? '' : 's'}.`, error: false });
      } else if (confirm.kind === 'archive') {
        const festivalIds = Array.from(selectedFestivalIds);
        await api.post<void>('/admin/bulk/archive-festivals', { festivalIds });
        setFestivals((prev) => prev.filter((f) => !selectedFestivalIds.has(f.id)));
        setSelectedFestivalIds(new Set());
        setBanner({ text: `Archived ${festivalIds.length} festival${festivalIds.length === 1 ? '' : 's'}.`, error: false });
      }
      setConfirm(null);
      setConfirmTargetId(null);
    } catch (err: unknown) {
      setBanner({ text: err instanceof Error ? err.message : 'Action failed. Try again.', error: true });
    } finally {
      setBusy(false);
    }
  }, [confirm, confirmTargetId, crews, expandedId, selectedUserIds, selectedFestivalIds]);

  const cancelConfirm = useCallback(() => {
    if (busy) return;
    setConfirm(null);
    setConfirmTargetId(null);
  }, [busy]);

  // ── Non-admin guard (AuthGate already bounces; mirror defensively) ─
  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Crews" subtitle="Admin" icon="people-outline" />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
        <Stack.Screen options={{ headerShown: false }} />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader
          title="Crews"
          subtitle="Management & bulk ops"
          icon="people-outline"
          right={<Button label="Back" variant="ghost" size="sm" icon="chevron-back" onPress={goBack} />}
        />
        <LoadingState label="Loading crews" />
        <Stack.Screen options={{ headerShown: false }} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.screen}>
        <ScreenHeader
          title="Crews"
          subtitle="Management & bulk ops"
          icon="people-outline"
          right={<Button label="Back" variant="ghost" size="sm" icon="chevron-back" onPress={goBack} />}
        />
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load crews"
          message="Something went wrong reaching the server."
          action={{ label: 'Try again', onPress: () => { setLoading(true); void load().finally(() => setLoading(false)); } }}
        />
        <Stack.Screen options={{ headerShown: false }} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Crews"
        subtitle="Management & bulk ops"
        icon="people-outline"
        right={<Button label="Back" variant="ghost" size="sm" icon="chevron-back" onPress={goBack} />}
      />

      <FlatList
        data={filteredCrews}
        keyExtractor={(c) => c.id}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {banner ? (
              <View style={[styles.banner, banner.error ? styles.bannerError : styles.bannerOk]}>
                <Text style={[styles.bannerText, banner.error && styles.bannerTextError]}>{banner.text}</Text>
              </View>
            ) : null}

            <SectionLabel>Crews ({filteredCrews.length})</SectionLabel>

            <TextInput
              style={[styles.search, searchFocused && styles.searchFocused]}
              value={search}
              onChangeText={setSearch}
              placeholder="Search by crew, creator, or festival…"
              placeholderTextColor={t.colors.text.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              accessibilityLabel="Search crews by name, creator, or festival"
            />
          </View>
        }
        renderItem={({ item: crew }) => {
          const isExpanded = expandedId === crew.id;
          const members = membersByCrew[crew.id];
          const isLoadingMembers = !!membersLoading[crew.id];
          const count = memberCountOf(crew);
          return (
            <View style={[styles.card, styles.crewCard]}>
              <View style={styles.crewHead}>
                <View style={styles.crewMeta}>
                  <Text style={styles.crewName} numberOfLines={1}>
                    {crew.name}
                  </Text>
                  <Text style={styles.crewSub} numberOfLines={2}>
                    {count} member{count === 1 ? '' : 's'} · {crew.creatorUsername || crew.createdBy}
                    {crew.festivalName ? ` · ${crew.festivalName}` : ''}
                  </Text>
                </View>
              </View>
              <View style={styles.crewActions}>
                <Button
                  label={isExpanded ? 'Hide' : 'View'}
                  variant="secondary"
                  size="sm"
                  icon={isExpanded ? 'chevron-up' : 'people-outline'}
                  onPress={() => toggleExpand(crew.id)}
                  style={styles.flexBtn}
                />
                <Button
                  label="Delete"
                  variant="danger"
                  size="sm"
                  icon="trash-outline"
                  onPress={() => requestDeleteCrew(crew)}
                  style={styles.flexBtn}
                />
              </View>

              {isExpanded ? (
                <View style={styles.membersBlock}>
                  <Text style={styles.membersHeading}>Members</Text>
                  {isLoadingMembers && !members ? (
                    <Text style={styles.memberHint}>Loading members…</Text>
                  ) : !members || members.length === 0 ? (
                    <Text style={styles.memberHint}>No members.</Text>
                  ) : (
                    members.map((m) => (
                      <View key={m.userId} style={styles.memberRow}>
                        <Ionicons name="person-circle-outline" size={t.iconSize.md} color={t.colors.text.muted} />
                        <Text style={styles.memberName} numberOfLines={1}>
                          {m.username || m.userId}
                        </Text>
                        <Text style={styles.memberRole}>· {m.role || 'member'}</Text>
                      </View>
                    ))
                  )}
                </View>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="search-outline"
            title="No crews found"
            message={search.trim() ? 'Try adjusting your search.' : 'No crews have been created yet.'}
          />
        }
        ListFooterComponent={
          <View style={styles.footerBlock}>
            {/* ── Bulk operations ─────────────────────────────────── */}
            <SectionLabel>Bulk operations</SectionLabel>
            <TouchableOpacity
              style={[styles.card, styles.bulkToggle]}
              onPress={() => setBulkOpen((o) => !o)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Bulk operations, ${bulkOpen ? 'collapse' : 'expand'}`}
              accessibilityState={{ expanded: bulkOpen }}
            >
              <View style={styles.bulkToggleBody}>
                <Text style={styles.bulkTitle}>Force-logout &amp; archive</Text>
                <Text style={styles.memberHint} numberOfLines={1}>
                  Select users or festivals to act on in bulk
                </Text>
              </View>
              <Ionicons
                name={bulkOpen ? 'chevron-up' : 'chevron-down'}
                size={t.iconSize.md}
                color={t.colors.text.placeholder}
              />
            </TouchableOpacity>

            {bulkOpen ? (
              <View style={styles.bulkBody}>
                {/* Force-logout users */}
                <Text style={styles.bulkGroupTitle}>Force-logout users</Text>
                <View style={styles.card}>
                  {users.length === 0 ? (
                    <View style={styles.selectRow}>
                      <Text style={styles.memberHint}>No users.</Text>
                    </View>
                  ) : (
                    users.map((u, i) => {
                      const selected = selectedUserIds.has(u.id);
                      const isSelf = u.id === currentUserId;
                      return (
                        <TouchableOpacity
                          key={u.id}
                          style={[styles.selectRow, i < users.length - 1 && styles.selectDivider]}
                          onPress={isSelf ? undefined : () => toggleSelect(selectedUserIds, setSelectedUserIds, u.id)}
                          disabled={isSelf}
                          activeOpacity={isSelf ? 1 : 0.7}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: selected, disabled: isSelf }}
                          accessibilityLabel={`${u.username}${u.roles.includes('admin') ? ', admin' : ''}${isSelf ? ' (you — cannot force-logout yourself)' : ''}`}
                        >
                          <Ionicons
                            name={selected ? 'checkbox' : 'square-outline'}
                            size={t.iconSize.md}
                            color={isSelf ? t.colors.text.placeholder : selected ? t.colors.accent.aqua : t.colors.text.muted}
                          />
                          <View style={styles.selectMeta}>
                            <Text style={[styles.selectName, isSelf && styles.selectNameMuted]} numberOfLines={1}>
                              {u.username}
                              {u.roles.includes('admin') ? ' · admin' : ''}
                              {isSelf ? ' (you)' : ''}
                            </Text>
                            <Text style={styles.selectSub} numberOfLines={1}>
                              {u.email}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
                <Button
                  label={
                    selectedUserIds.size > 0
                      ? `Force-logout ${selectedUserIds.size} user${selectedUserIds.size === 1 ? '' : 's'}`
                      : 'Force-logout selected'
                  }
                  variant="danger"
                  icon="log-out-outline"
                  disabled={selectedUserIds.size === 0}
                  onPress={requestForceLogout}
                  style={styles.bulkActionBtn}
                />

                {/* Archive festivals */}
                <Text style={styles.bulkGroupTitle}>Archive festivals</Text>
                <View style={styles.card}>
                  {festivals.length === 0 ? (
                    <View style={styles.selectRow}>
                      <Text style={styles.memberHint}>No festivals.</Text>
                    </View>
                  ) : (
                    festivals.map((f, i) => {
                      const selected = selectedFestivalIds.has(f.id);
                      return (
                        <TouchableOpacity
                          key={f.id}
                          style={[styles.selectRow, i < festivals.length - 1 && styles.selectDivider]}
                          onPress={() => toggleSelect(selectedFestivalIds, setSelectedFestivalIds, f.id)}
                          activeOpacity={0.7}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: selected }}
                          accessibilityLabel={f.name}
                        >
                          <Ionicons
                            name={selected ? 'checkbox' : 'square-outline'}
                            size={t.iconSize.md}
                            color={selected ? t.colors.accent.aqua : t.colors.text.muted}
                          />
                          <View style={styles.selectMeta}>
                            <Text style={styles.selectName} numberOfLines={1}>
                              {f.name}
                            </Text>
                            {f.location ? (
                              <Text style={styles.selectSub} numberOfLines={1}>
                                {f.location}
                              </Text>
                            ) : null}
                          </View>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
                <Button
                  label={
                    selectedFestivalIds.size > 0
                      ? `Archive ${selectedFestivalIds.size} festival${selectedFestivalIds.size === 1 ? '' : 's'}`
                      : 'Archive selected'
                  }
                  variant="danger"
                  icon="archive-outline"
                  disabled={selectedFestivalIds.size === 0}
                  onPress={requestArchive}
                  style={styles.bulkActionBtn}
                />
              </View>
            ) : null}
          </View>
        }
      />

      {/* Destructive confirm — gates delete-crew / force-logout / archive. */}
      <ConfirmDialog
        visible={!!confirm && !busy}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmLabel={
          confirm?.kind === 'delete-crew' ? 'Delete' : confirm?.kind === 'archive' ? 'Archive' : 'Force logout'
        }
        destructive
        onConfirm={() => void runConfirmed()}
        onCancel={cancelConfirm}
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
    gap: t.spacing[2],
  },
  footerBlock: {
    gap: t.spacing[2],
    marginTop: t.spacing[2],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
  },
  // Search ----------------------------------------------------------------
  search: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    backgroundColor: t.colors.bg.input,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 48,
  },
  searchFocused: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  // Crew card -------------------------------------------------------------
  crewCard: {
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  crewHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  crewMeta: {
    flex: 1,
    gap: t.spacing[1],
  },
  crewName: {
    ...typeStyle('title', 600),
    color: t.colors.text.primary,
  },
  crewSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  crewActions: {
    flexDirection: 'row',
    gap: t.spacing[3],
  },
  flexBtn: {
    flex: 1,
  },
  // Members ---------------------------------------------------------------
  membersBlock: {
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    paddingTop: t.spacing[3],
    gap: t.spacing[2],
  },
  membersHeading: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  memberHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  memberName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  memberRole: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  // Banner ----------------------------------------------------------------
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
  // Bulk ------------------------------------------------------------------
  bulkToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  bulkToggleBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  bulkTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  bulkBody: {
    gap: t.spacing[2],
  },
  bulkGroupTitle: {
    ...typeStyle('label', 600),
    color: t.colors.text.secondary,
    marginTop: t.spacing[2],
  },
  bulkActionBtn: {
    marginTop: t.spacing[1],
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  selectDivider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  selectMeta: {
    flex: 1,
    gap: t.spacing[1],
  },
  selectName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  selectNameMuted: {
    color: t.colors.text.muted,
  },
  selectSub: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
}));
