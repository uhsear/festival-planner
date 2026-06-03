import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore, useCrewStore, useFestivalStore, useUIStore } from '@festie/shared/stores';
import { useCrew } from '@festie/shared/hooks';
import { mapErrorToUserMessage } from '@festie/shared/services';
import type { Crew, CrewMember, CrewOverlap, FestivalSet } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../../hooks/useTokens';
import ScreenHeader from '../../components/ScreenHeader';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import CrewHomeBase from '../../components/CrewHomeBase';
import CrewPolls from '../../components/CrewPolls';
import CrewMeetingPoints from '../../components/CrewMeetingPoints';
import CrewExpenses from '../../components/CrewExpenses';
import CrewActivity from '../../components/CrewActivity';

/** Compact "synced N ago" label from an epoch-ms timestamp (inlined, no shared dep). */
function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0 || !Number.isFinite(diff)) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Two-letter initials derived from a member's display name (fallback "?"). */
function initialsFor(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Compact "Artist — HH:MM" label for a set in the overlap list. */
function setLabel(set: FestivalSet | undefined, fallbackId: string): string {
  if (!set) return `Set ${fallbackId.slice(0, 6)}`;
  const artist = set.artist ?? set.artists?.[0]?.name ?? `Set ${fallbackId.slice(0, 6)}`;
  const time = set.startTime ? ` — ${set.startTime}` : '';
  return `${artist}${time}`;
}

export default function CrewScreen() {
  const t = useTokens();
  const styles = useStyles();

  const user = useAuthStore((s) => s.user);
  const crews = useCrewStore((s) => s.crews);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const crewOverlap = useCrewStore((s) => s.crewOverlap);
  const polls = useCrewStore((s) => s.polls);
  const expenseBalances = useCrewStore((s) => s.expenseBalances);
  const crewLoading = useCrewStore((s) => s.crewLoading);
  const cachedAt = useCrewStore((s) => s._cachedAt);
  const offlineMode = useUIStore((s) => s.offlineMode);
  const error = useCrewStore((s) => s.error);
  const loadCrews = useCrewStore((s) => s.loadCrews);
  const selectCrew = useCrewStore((s) => s.selectCrew);
  const createCrew = useCrewStore((s) => s.createCrew);
  const joinByCode = useCrewStore((s) => s.joinByCode);
  const leaveCrew = useCrewStore((s) => s.leaveCrew);
  const deleteCrew = useCrewStore((s) => s.deleteCrew);
  const kickMember = useCrewStore((s) => s.kickMember);
  const transferOwnership = useCrewStore((s) => s.transferOwnership);
  const forceAddMember = useCrewStore((s) => s.forceAddMember);
  const regenerateInvite = useCrewStore((s) => s.regenerateInvite);
  const loadOverlap = useCrewStore((s) => s.loadOverlap);
  const loadPolls = useCrewStore((s) => s.loadPolls);
  const loadMeetingPoints = useCrewStore((s) => s.loadMeetingPoints);
  const loadExpenses = useCrewStore((s) => s.loadExpenses);
  const setError = useCrewStore((s) => s.setError);

  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const sets = useFestivalStore((s) => s.sets) as FestivalSet[];

  // Per-set crew picks (shared hook) — used to enrich the overlap UI without
  // an extra endpoint round-trip.
  const { getCrewScopedOtherPicks } = useCrew();
  const router = useRouter();

  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [overlapBusy, setOverlapBusy] = useState(false);
  const [overlapError, setOverlapError] = useState<string | null>(null);
  const [showOverlap, setShowOverlap] = useState(false);
  const [forceAddOpen, setForceAddOpen] = useState(false);
  const [forceAddId, setForceAddId] = useState('');
  const [forceAddBusy, setForceAddBusy] = useState(false);

  // Load the user's crews once on mount.
  useEffect(() => {
    if (user && crews.length === 0) {
      loadCrews().catch(() => {});
    }
  }, [user?.id, crews.length, loadCrews]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select the first crew when none is active yet.
  useEffect(() => {
    if (user && crews.length > 0 && !activeCrew) {
      selectCrew(crews[0]!.id).catch(() => {});
    }
  }, [user?.id, crews, activeCrew, selectCrew]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the transient sub-feature UI whenever the active crew changes.
  useEffect(() => {
    setShowOverlap(false);
    setForceAddOpen(false);
    setForceAddId('');
  }, [activeCrew?.id]);

  // Load polls + meeting points for the active crew (best-effort; errors land
  // in the shared store and surface in the header error line).
  useEffect(() => {
    const id = activeCrew?.id;
    if (!id) return;
    loadPolls(id).catch(() => {});
    loadMeetingPoints(id).catch(() => {});
    loadExpenses(id).catch(() => {});
  }, [activeCrew?.id, loadPolls, loadMeetingPoints, loadExpenses]);

  // Pull-to-refresh: re-fetch the crew list and the active crew (members,
  // polls, meeting points, expenses all reload off selectCrew + the effect).
  const handleRefresh = useCallback(() => {
    loadCrews().catch(() => {});
    if (activeCrew) {
      selectCrew(activeCrew.id).catch(() => {});
      loadPolls(activeCrew.id).catch(() => {});
      loadMeetingPoints(activeCrew.id).catch(() => {});
      loadExpenses(activeCrew.id).catch(() => {});
    }
  }, [loadCrews, activeCrew, selectCrew, loadPolls, loadMeetingPoints, loadExpenses]);

  // Fast set lookup by id for overlap labels.
  const setsById = useMemo(() => {
    const map = new Map<string, FestivalSet>();
    for (const s of sets ?? []) map.set(s.id, s);
    return map;
  }, [sets]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || createBusy) return;
    setError(null);
    setCreateBusy(true);
    try {
      await createCrew({ name: trimmed, festivalId: currentFestival?.id });
      setName('');
    } catch {
      // Error is set in the store.
    } finally {
      setCreateBusy(false);
    }
  };

  const handleJoin = async () => {
    const trimmed = inviteCode.trim();
    if (!trimmed || joinBusy) return;
    setError(null);
    setJoinBusy(true);
    try {
      await joinByCode({ inviteCode: trimmed });
      setInviteCode('');
    } catch {
      // Error is set in the store.
    } finally {
      setJoinBusy(false);
    }
  };

  const handleShareInvite = useCallback((code: string, crewName: string) => {
    const url = `https://festie.us/api/v1/crews/join/${code}`;
    Share.share({
      message: `Join "${crewName}" on Festie — tap to join: ${url}`,
      url,
    }).catch(() => {});
  }, []);

  const handleRegenerate = (crewId: string) => {
    Alert.alert('Regenerate invite code', 'The current code will stop working. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Regenerate',
        style: 'destructive',
        onPress: async () => {
          setRegenBusy(true);
          try {
            await regenerateInvite(crewId);
          } catch {
            // Error is set in the store.
          } finally {
            setRegenBusy(false);
          }
        },
      },
    ]);
  };

  const handleToggleOverlap = async (crewId: string) => {
    if (showOverlap) {
      setShowOverlap(false);
      return;
    }
    const festivalId = activeCrew?.festivalId ?? currentFestival?.id;
    if (!festivalId) {
      Alert.alert('No festival selected', 'Pick a festival before comparing schedules.');
      return;
    }
    setOverlapBusy(true);
    setOverlapError(null);
    try {
      await loadOverlap(crewId, festivalId);
      setShowOverlap(true);
    } catch (e) {
      setOverlapError(mapErrorToUserMessage(e, 'Couldn’t load schedule overlap'));
    } finally {
      setOverlapBusy(false);
    }
  };

  const handleKick = (crewId: string, member: CrewMember) => {
    Alert.alert('Remove member', `Remove ${member.name || 'this member'} from the crew?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          kickMember(crewId, member.id).catch(() => {});
        },
      },
    ]);
  };

  const handleTransfer = (crewId: string, member: CrewMember) => {
    Alert.alert(
      'Transfer ownership',
      `Make ${member.name || 'this member'} the crew owner? You will become a regular member.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Transfer',
          style: 'destructive',
          onPress: () => {
            transferOwnership(crewId, member.id).catch(() => {});
          },
        },
      ],
    );
  };

  const handleForceAdd = async (crewId: string) => {
    const trimmed = forceAddId.trim();
    if (!trimmed || forceAddBusy) return;
    setForceAddBusy(true);
    try {
      await forceAddMember(crewId, trimmed);
      setForceAddId('');
      setForceAddOpen(false);
    } catch {
      // Error is set in the store.
    } finally {
      setForceAddBusy(false);
    }
  };

  const handleLeave = (crewId: string) => {
    Alert.alert('Leave crew', 'Are you sure you want to leave this crew?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          leaveCrew(crewId).catch(() => {});
        },
      },
    ]);
  };

  const handleDelete = (crewId: string) => {
    Alert.alert('Delete crew', 'This permanently deletes the crew for everyone. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteCrew(crewId).catch(() => {});
        },
      },
    ]);
  };

  if (!user) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Crew" icon="people" />
        <EmptyState
          icon="lock-closed"
          title="Sign in required"
          message="Log in to coordinate with your crew."
          action={{ label: 'Sign in', onPress: () => router.push('/(auth)/login') }}
        />
      </View>
    );
  }

  // Initial load — no crews fetched yet.
  if (crewLoading && crews.length === 0 && !activeCrew) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Crew" icon="people" />
        <LoadingState label="Loading your crews…" />
      </View>
    );
  }

  // No active crew: show create / join forms.
  if (!activeCrew) {
    return (
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScreenHeader title="Crew" subtitle="Coordinate with friends" icon="people" />
        <ScrollView contentContainerStyle={styles.formScroll} keyboardShouldPersistTaps="handled">
          <EmptyState
            icon="people-outline"
            title="No crew yet"
            message="Create a crew or join an existing one to coordinate with friends."
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Create a crew</Text>
            <TextInput
              style={styles.input}
              placeholder="Sunset Squad"
              placeholderTextColor={t.colors.text.placeholder}
              value={name}
              onChangeText={setName}
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={handleCreate}
              accessibilityLabel="Crew name"
            />
            <TouchableOpacity
              style={[styles.primaryButton, createBusy && styles.buttonDisabled]}
              onPress={handleCreate}
              disabled={createBusy || !name.trim()}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Create crew"
            >
              <Text style={styles.primaryButtonText}>{createBusy ? 'Creating…' : 'Create Crew'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Join by code</Text>
            <TextInput
              style={styles.input}
              placeholder="A1B2C3"
              placeholderTextColor={t.colors.text.placeholder}
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={20}
              returnKeyType="done"
              onSubmitEditing={handleJoin}
              accessibilityLabel="Invite code"
            />
            <TouchableOpacity
              style={[styles.outlineButton, joinBusy && styles.buttonDisabled]}
              onPress={handleJoin}
              disabled={joinBusy || !inviteCode.trim()}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Join crew by code"
            >
              <Text style={styles.outlineButtonText}>{joinBusy ? 'Joining…' : 'Join by Code'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Active crew: header, invite code, switcher, members + admin, overlap, actions.
  const crew: Crew = activeCrew;
  const members: CrewMember[] = crewMembers.length ? crewMembers : (crew.members ?? []);

  // Current user's role within this crew drives which admin controls show.
  const myMembership = members.find((m) => m.userId === user.id);
  const isOwner = crew.owner === user.id || myMembership?.role === 'owner';

  const overlapEntries: CrewOverlap[] = Object.values(crewOverlap)
    .filter((o) => o.memberCount > 0)
    .sort((a, b) => b.memberCount - a.memberCount);

  // Badge counts derived from already-loaded crew data (no extra fetch):
  // open polls = polls not yet closed; unsettled = current user has a
  // non-zero expense balance (owes or is owed).
  const openPollCount = polls.filter((p) => !p.closed).length;
  const myBalance = expenseBalances.find((b) => b.userId === user.id)?.balance ?? 0;
  const hasUnsettledBalance = Math.abs(myBalance) > 0.01;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader
        title={crew.name}
        subtitle={`${members.length} ${members.length === 1 ? 'member' : 'members'}`}
        icon="people"
      />

      <FlatList
        data={members}
        keyExtractor={(m) => m.id || m.userId}
        contentContainerStyle={styles.memberList}
        refreshControl={
          <RefreshControl
            refreshing={crewLoading}
            onRefresh={handleRefresh}
            tintColor={t.colors.accent.aqua}
            colors={[t.colors.accent.aqua]}
            progressBackgroundColor={t.colors.bg.secondary}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {cachedAt ? (
              <Text style={styles.syncedLine}>
                {offlineMode ? `Showing offline data · synced ${timeAgo(cachedAt)}` : `Synced ${timeAgo(cachedAt)}`}
              </Text>
            ) : null}

            {crew.inviteCode ? (
              <View style={styles.inviteBar}>
                <Ionicons name="key-outline" size={16} color={t.colors.accent.aqua} />
                <Text style={styles.inviteLabel}>Invite code</Text>
                <Text style={styles.inviteCode} accessibilityLabel={`Invite code ${crew.inviteCode}`}>
                  {crew.inviteCode}
                </Text>
                <TouchableOpacity
                  onPress={() => handleShareInvite(crew.inviteCode!, crew.name)}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Share invite link"
                >
                  <Ionicons name="share-outline" size={16} color={t.colors.accent.aqua} />
                </TouchableOpacity>
                {isOwner ? (
                  <TouchableOpacity
                    onPress={() => handleRegenerate(crew.id)}
                    disabled={regenBusy}
                    style={styles.iconButton}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Regenerate invite code"
                  >
                    {regenBusy ? (
                      <ActivityIndicator size="small" color={t.colors.accent.aqua} />
                    ) : (
                      <Ionicons name="refresh" size={16} color={t.colors.accent.aqua} />
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {crews.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crewSwitcher}>
                {crews.map((c) => {
                  const active = c.id === crew.id;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.crewChip, active && styles.crewChipActive]}
                      onPress={() => {
                        if (!active) selectCrew(c.id).catch(() => {});
                      }}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={`Switch to crew ${c.name}`}
                    >
                      <Text style={[styles.crewChipText, active && styles.crewChipTextActive]} numberOfLines={1}>
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : null}

            {/* Schedule compare / overlap toggle. */}
            <TouchableOpacity
              style={styles.overlapToggle}
              onPress={() => handleToggleOverlap(crew.id)}
              disabled={overlapBusy}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={showOverlap ? 'Hide schedule overlap' : 'Compare crew schedules'}
            >
              <Ionicons name="git-compare-outline" size={16} color={t.colors.accent.aqua} />
              <Text style={styles.overlapToggleText}>
                {overlapBusy ? 'Loading overlap…' : showOverlap ? 'Hide schedule overlap' : 'Compare schedules'}
              </Text>
              {overlapBusy ? (
                <ActivityIndicator size="small" color={t.colors.accent.aqua} />
              ) : (
                <Ionicons name={showOverlap ? 'chevron-up' : 'chevron-down'} size={16} color={t.colors.accent.aqua} />
              )}
            </TouchableOpacity>

            {/* Full side-by-side compare matrix (members × sets). */}
            <TouchableOpacity
              style={styles.overlapToggle}
              onPress={() => router.push('/crew-compare')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Open full compare grid"
            >
              <Ionicons name="grid-outline" size={16} color={t.colors.accent.aqua} />
              <Text style={styles.overlapToggleText}>Full compare grid</Text>
              <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
            </TouchableOpacity>

            {overlapError ? (
              <TouchableOpacity
                style={styles.overlapErrorRow}
                onPress={() => handleToggleOverlap(crew.id)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Retry loading schedule overlap"
              >
                <Ionicons name="cloud-offline-outline" size={16} color={t.colors.text.danger} />
                <Text style={styles.overlapErrorText}>{overlapError}</Text>
                <Text style={styles.overlapRetryText}>Retry</Text>
              </TouchableOpacity>
            ) : null}

            {showOverlap ? (
              overlapEntries.length === 0 ? (
                <Text style={styles.overlapEmpty}>No shared picks yet — overlap appears once members add sets.</Text>
              ) : (
                <View style={styles.overlapList}>
                  {overlapEntries.map((o) => {
                    const picks = getCrewScopedOtherPicks(o.setId);
                    const mustCount = picks.filter((p) => p.priority === 'must').length;
                    return (
                      <View key={o.setId} style={styles.overlapRow}>
                        <View style={styles.overlapInfo}>
                          <Text style={styles.overlapSet} numberOfLines={1}>
                            {setLabel(setsById.get(o.setId), o.setId)}
                          </Text>
                          <Text style={styles.overlapMeta}>
                            {o.memberCount} {o.memberCount === 1 ? 'member' : 'members'}
                            {mustCount > 0 ? ` · ${mustCount} must-see` : ''}
                          </Text>
                        </View>
                        <View style={styles.overlapBadge}>
                          <Ionicons name="people" size={13} color={t.colors.accent.aqua} />
                          <Text style={styles.overlapBadgeText}>{o.memberCount}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )
            ) : null}

            {/* Force-add (admin-gated server-side). Shown to owners. */}
            {isOwner ? (
              forceAddOpen ? (
                <View style={styles.forceAddBox}>
                  <Text style={styles.formLabel}>Force-add member by user ID</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="user_id"
                    placeholderTextColor={t.colors.text.placeholder}
                    value={forceAddId}
                    onChangeText={setForceAddId}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={() => handleForceAdd(crew.id)}
                    accessibilityLabel="User ID to force-add"
                  />
                  <View style={styles.forceAddRow}>
                    <TouchableOpacity
                      style={[styles.outlineButton, styles.flexButton]}
                      onPress={() => {
                        setForceAddOpen(false);
                        setForceAddId('');
                      }}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel force-add"
                    >
                      <Text style={styles.outlineButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.primaryButton,
                        styles.flexButton,
                        (forceAddBusy || !forceAddId.trim()) && styles.buttonDisabled,
                      ]}
                      onPress={() => handleForceAdd(crew.id)}
                      disabled={forceAddBusy || !forceAddId.trim()}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel="Confirm force-add"
                    >
                      <Text style={styles.primaryButtonText}>{forceAddBusy ? 'Adding…' : 'Add'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.overlapToggle}
                  onPress={() => setForceAddOpen(true)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Force-add a member by user ID"
                >
                  <Ionicons name="person-add-outline" size={16} color={t.colors.accent.aqua} />
                  <Text style={styles.overlapToggleText}>Force-add member</Text>
                </TouchableOpacity>
              )
            ) : null}

            <Text style={styles.sectionLabel}>Members</Text>
          </View>
        }
        renderItem={({ item }) => {
          const rowIsOwner = item.role === 'owner' || item.userId === crew.owner;
          const displayName = item.name || 'Member';
          const isSelf = item.userId === user.id;
          // Owners may manage other members (kick + transfer). Force-add and
          // these controls hit admin-gated shared store actions.
          const canManage = isOwner && !rowIsOwner && !isSelf;
          return (
            <View style={styles.memberRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsFor(item.name)}</Text>
              </View>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {displayName}
                  {isSelf ? ' (you)' : ''}
                </Text>
                {rowIsOwner ? <Text style={styles.memberRole}>Owner</Text> : null}
              </View>
              {canManage ? (
                <View style={styles.memberActions}>
                  <TouchableOpacity
                    onPress={() => handleTransfer(crew.id, item)}
                    style={styles.iconButton}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Transfer ownership to ${displayName}`}
                  >
                    <Ionicons name="star-outline" size={18} color={t.colors.accent.amber} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleKick(crew.id, item)}
                    style={styles.iconButton}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${displayName} from crew`}
                  >
                    <Ionicons name="person-remove-outline" size={18} color={t.colors.text.danger} />
                  </TouchableOpacity>
                </View>
              ) : rowIsOwner ? (
                <Ionicons name="star" size={16} color={t.colors.accent.amber} />
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="person-outline"
            title="No members yet"
            message="Share your invite code to bring friends in."
          />
        }
        ListFooterComponent={
          <View>
            <CrewHomeBase
              crewId={crew.id}
              location={crew.homeBaseLocation}
              time={crew.homeBaseTime}
              isOwner={isOwner}
            />

            <Text style={styles.sectionLabel}>Meeting points</Text>
            <CrewMeetingPoints crewId={crew.id} currentUserId={user.id} isOwner={isOwner} />

            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabel}>Polls</Text>
              {openPollCount > 0 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{openPollCount}</Text>
                </View>
              ) : null}
            </View>
            <CrewPolls crewId={crew.id} currentUserId={user.id} isOwner={isOwner} />

            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabel}>Expenses</Text>
              {hasUnsettledBalance ? (
                <View style={styles.unsettledDot} accessibilityLabel="You have an unsettled balance" />
              ) : null}
            </View>
            <CrewExpenses crewId={crew.id} members={members} currentUserId={user.id} />

            <Text style={styles.sectionLabel}>Activity</Text>
            <CrewActivity crewId={crew.id} />

            <View style={styles.footerActions}>
              {isOwner ? (
                <TouchableOpacity
                  style={styles.dangerButton}
                  onPress={() => handleDelete(crew.id)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Delete crew"
                >
                  <Ionicons name="trash-outline" size={16} color={t.colors.text.danger} />
                  <Text style={styles.dangerButtonText}>Delete crew</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.dangerButton}
                  onPress={() => handleLeave(crew.id)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Leave crew"
                >
                  <Ionicons name="exit-outline" size={16} color={t.colors.text.danger} />
                  <Text style={styles.dangerButtonText}>Leave crew</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        }
      />
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  formScroll: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[4],
  },
  headerBlock: {
    gap: t.spacing[3],
    marginBottom: t.spacing[1],
  },
  error: {
    ...typeStyle('body'),
    color: t.colors.text.danger,
    textAlign: 'center',
  },
  syncedLine: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  formGroup: {
    gap: t.spacing[2],
  },
  formLabel: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  input: {
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  primaryButton: {
    backgroundColor: t.colors.accent.coral,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typeStyle('label'),
    color: t.colors.text.onAccent,
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
    alignItems: 'center',
  },
  outlineButtonText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  flexButton: {
    flex: 1,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  iconButton: {
    padding: t.spacing[1],
  },
  inviteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  inviteLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  inviteCode: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    marginLeft: 'auto',
    letterSpacing: 2,
  },
  crewSwitcher: {
    gap: t.spacing[2],
    paddingBottom: t.spacing[1],
  },
  crewChip: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  crewChipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[12],
  },
  crewChipText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  crewChipTextActive: {
    color: t.colors.accent.aqua,
  },
  overlapToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  overlapToggleText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  overlapEmpty: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[2],
  },
  overlapErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.text.danger,
    backgroundColor: t.colors.bg.secondary,
  },
  overlapErrorText: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    flex: 1,
  },
  overlapRetryText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  overlapList: {
    gap: t.spacing[2],
  },
  overlapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  overlapInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  overlapSet: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  overlapMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  overlapBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[12],
  },
  overlapBadgeText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  forceAddBox: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  forceAddRow: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  memberList: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[2],
  },
  sectionLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    marginBottom: t.spacing[1],
    textTransform: 'uppercase',
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  countBadge: {
    minWidth: 18,
    paddingHorizontal: t.spacing[1],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[15],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: t.spacing[1],
  },
  countBadgeText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
    fontWeight: '700',
  },
  unsettledDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.accent.coral,
    marginBottom: t.spacing[1],
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.accent.aqua,
  },
  avatarText: {
    ...typeStyle('label'),
    color: t.colors.text.onLightAccent,
  },
  memberInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  memberName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  memberRole: {
    ...typeStyle('caption'),
    color: t.colors.accent.amber,
  },
  memberActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  footerActions: {
    marginTop: t.spacing[4],
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.text.danger,
    backgroundColor: t.colors.bg.secondary,
  },
  dangerButtonText: {
    ...typeStyle('label'),
    color: t.colors.text.danger,
  },
}));
