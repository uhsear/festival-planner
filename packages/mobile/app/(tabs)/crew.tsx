import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Keyboard,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Share,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore, useCrewStore, useFestivalStore, useFestivalModeStore } from '@festie/shared/stores';
import { useCrew } from '@festie/shared/hooks';
import { mapErrorToUserMessage } from '@festie/shared/services';
import { setLabel, getInitials, buildJoinUrl } from '@festie/shared/utils';
import type { Crew, CrewMember, CrewOverlap, FestivalSet } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useHaptics } from '../../hooks/useHaptics';
import { useListBottomInset } from '../../hooks/useListBottomInset';
import Button from '../../components/Button';
import ScreenHeader from '../../components/ScreenHeader';
import CrewTabBar, { type CrewTabKey } from '../../components/CrewTabBar';
import EmptyState from '../../components/EmptyState';
import SectionLabel from '../../components/SectionLabel';
import { Skeleton } from '../../components/Skeleton';
import CrewHomeBase from '../../components/CrewHomeBase';
import CrewPhotoLink from '../../components/CrewPhotoLink';
import CrewPolls from '../../components/CrewPolls';
import CrewMeetingPoints from '../../components/CrewMeetingPoints';
import CrewStatus from '../../components/CrewStatus';
import CrewPacking from '../../components/CrewPacking';
import CrewRides from '../../components/CrewRides';
import CrewExpenses from '../../components/CrewExpenses';
import CrewActivity from '../../components/CrewActivity';
import CrewLiveLocation from '../../components/CrewLiveLocation';
import CrewSos from '../../components/CrewSos';
import UpdatedAgoBadge from '../../components/UpdatedAgoBadge';
import { LowPowerIndicator } from '../../components/LowPowerControls';

// DC2 deep-link tab whitelist. Module-scoped so its identity is stable across
// renders (a component-local array would be a new ref each render and force the
// ?tab effect to re-run / need it as a dep).
const TAB_KEYS: readonly CrewTabKey[] = ['members', 'plan', 'logistics', 'money'];

export default function CrewScreen() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();

  // On tablet-width screens, inset the content so menu items and member rows
  // don't stretch edge-to-edge into an uncomfortably wide single column.
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const tabletInset = useMemo(() => (isTablet ? { paddingHorizontal: t.spacing[6] } : null), [isTablet, t.spacing]);

  // Bottom padding via the shared inset hook (single source of truth for the
  // home-indicator cushion). Crew is a TAB screen — the tab bar in (tabs)/_layout
  // already absorbs the safe-area inset, so we pass includeSafeArea:false to add
  // only the visible cushion and avoid double-padding the last row.
  const listBottomPad = useListBottomInset({ includeSafeArea: false });
  const memberBottomPad = useListBottomInset({ base: t.spacing[4], includeSafeArea: false });
  const memberListStyle = useMemo(
    () => [styles.memberList, tabletInset, { paddingBottom: memberBottomPad }],
    [styles.memberList, tabletInset, memberBottomPad],
  );
  const formScrollStyle = useMemo(
    () => [styles.formScroll, tabletInset, { paddingBottom: listBottomPad }],
    [styles.formScroll, tabletInset, listBottomPad],
  );
  // Per-tab scroll padding for the non-Members tabs (Plan / Logistics / Money).
  const tabScrollStyle = useMemo(
    () => [styles.tabScroll, tabletInset, { paddingBottom: listBottomPad }],
    [styles.tabScroll, tabletInset, listBottomPad],
  );

  const user = useAuthStore((s) => s.user);
  const crews = useCrewStore((s) => s.crews);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const crewOverlap = useCrewStore((s) => s.crewOverlap);
  const polls = useCrewStore((s) => s.polls);
  const packingItems = useCrewStore((s) => s.packingItems);
  const rideOffers = useCrewStore((s) => s.rideOffers);
  const expenseBalances = useCrewStore((s) => s.expenseBalances);
  const crewLoading = useCrewStore((s) => s.crewLoading);
  const error = useCrewStore((s) => s.error);
  const loadCrews = useCrewStore((s) => s.loadCrews);
  const selectCrew = useCrewStore((s) => s.selectCrew);
  const createCrew = useCrewStore((s) => s.createCrew);
  const updateCrew = useCrewStore((s) => s.updateCrew);
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
  const loadPacking = useCrewStore((s) => s.loadPacking);
  const loadRides = useCrewStore((s) => s.loadRides);
  const loadExpenses = useCrewStore((s) => s.loadExpenses);
  const setError = useCrewStore((s) => s.setError);

  const reformCrew = useCrewStore((s) => s.reformCrew);

  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalDays = useFestivalStore((s) => s.days);
  const sets = useFestivalStore((s) => s.sets) as FestivalSet[];
  const festivals = useFestivalStore((s) => s.festivals);
  const loadFestivals = useFestivalStore((s) => s.loadFestivals);

  // Festival low-power mode gates battery-hungry features (live-location
  // auto-share). Read from the shared store; the toggle itself lives on the
  // Now & Next screen.
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);

  // Per-set crew picks (shared hook) — used to enrich the overlap UI without
  // an extra endpoint round-trip.
  const { getCrewScopedOtherPicks } = useCrew();
  const router = useRouter();

  const [name, setName] = useState('');
  // Crew totem (rally marker) on the create form — a plain emoji field (no
  // picker) + short label, both optional. Capped server-side (16 / 40 chars).
  const [createTotemEmoji, setCreateTotemEmoji] = useState('');
  const [createTotemName, setCreateTotemName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  // Owner-only totem editor (in the Manage footer). Opens prefilled from the
  // active crew; `null` while closed so we can re-seed on open.
  const [totemEditOpen, setTotemEditOpen] = useState(false);
  const [editTotemEmoji, setEditTotemEmoji] = useState('');
  const [editTotemName, setEditTotemName] = useState('');
  const [totemBusy, setTotemBusy] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [overlapBusy, setOverlapBusy] = useState(false);
  const [overlapError, setOverlapError] = useState<string | null>(null);
  const [showOverlap, setShowOverlap] = useState(false);
  const [forceAddOpen, setForceAddOpen] = useState(false);
  const [forceAddId, setForceAddId] = useState('');
  const [forceAddBusy, setForceAddBusy] = useState(false);
  const [reformBusy, setReformBusy] = useState(false);
  // P1-2: which crew section tab is showing. Members / Plan / Logistics / Money.
  const [crewTab, setCrewTab] = useState<CrewTabKey>('members');

  // DC2: a raise-SOS affordance on /find and /map deep-links here with
  // ?tab=logistics so the user lands on the Find pane where CrewSos lives.
  // mpLat/mpLng: tap-to-create coords deep-linked from the map's long-press —
  // forwarded to CrewMeetingPoints to prefill+open its create form.
  const {
    tab: tabParam,
    mpLat: mpLatParam,
    mpLng: mpLngParam,
  } = useLocalSearchParams<{ tab?: string; mpLat?: string; mpLng?: string }>();
  const prefillCoords = useMemo(() => {
    const lat = mpLatParam != null ? Number(mpLatParam) : NaN;
    const lng = mpLngParam != null ? Number(mpLngParam) : NaN;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [mpLatParam, mpLngParam]);

  // Load the user's crews once on mount.
  useEffect(() => {
    if (user?.id && crews.length === 0) {
      loadCrews().catch(() => {});
    }
  }, [user?.id, crews.length, loadCrews]);

  // Auto-select the first crew when none is active yet.
  useEffect(() => {
    if (user?.id && crews.length > 0 && !activeCrew) {
      selectCrew(crews[0]!.id).catch(() => {});
    }
  }, [user?.id, crews, activeCrew, selectCrew]);

  // Reset the transient sub-feature UI whenever the active crew changes. Done
  // with the render-time "previous value" pattern (keyed off the crew id) rather
  // than a setState-in-effect, so the reset lands in the same render the crew
  // changes and before the ?tab deep-link effect below re-applies any tab.
  const [prevCrewId, setPrevCrewId] = useState(activeCrew?.id);
  if (activeCrew?.id !== prevCrewId) {
    setPrevCrewId(activeCrew?.id);
    setShowOverlap(false);
    setForceAddOpen(false);
    setForceAddId('');
    setCrewTab('members');
    setTotemEditOpen(false);
  }

  // DC2: honor a deep-linked ?tab=... (e.g. the find/map SOS shortcut lands on
  // the Find pane). Runs after the crew-change reset since it keys on the param.
  // TAB_KEYS is module-scoped (stable), so the param is the only dep.
  useEffect(() => {
    if (tabParam && (TAB_KEYS as readonly string[]).includes(tabParam)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- event-driven: apply the deep-linked ?tab exactly when the URL param changes; not derivable as render state since the user can still switch tabs afterward
      setCrewTab(tabParam as CrewTabKey);
    }
  }, [tabParam]);

  // Load polls + meeting points for the active crew (best-effort; errors land
  // in the shared store and surface in the header error line).
  useEffect(() => {
    const id = activeCrew?.id;
    if (!id) return;
    loadPolls(id).catch(() => {});
    loadMeetingPoints(id).catch(() => {});
    loadPacking(id).catch(() => {});
    loadRides(id).catch(() => {});
    loadExpenses(id).catch(() => {});
  }, [activeCrew?.id, loadPolls, loadMeetingPoints, loadPacking, loadRides, loadExpenses]);

  // Pull-to-refresh: re-fetch the crew list and the active crew (members,
  // polls, meeting points, expenses all reload off selectCrew + the effect).
  const handleRefresh = useCallback(() => {
    loadCrews().catch(() => {});
    if (activeCrew) {
      selectCrew(activeCrew.id).catch(() => {});
      loadPolls(activeCrew.id).catch(() => {});
      loadMeetingPoints(activeCrew.id).catch(() => {});
      loadPacking(activeCrew.id).catch(() => {});
      loadRides(activeCrew.id).catch(() => {});
      loadExpenses(activeCrew.id).catch(() => {});
    }
  }, [loadCrews, activeCrew, selectCrew, loadPolls, loadMeetingPoints, loadPacking, loadRides, loadExpenses]);

  // Fast set lookup by id for overlap labels.
  const setsById = useMemo(() => {
    const map = new Map<string, FestivalSet>();
    for (const s of sets ?? []) map.set(s.id, s);
    return map;
  }, [sets]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || createBusy) return;
    Keyboard.dismiss();
    setError(null);
    setCreateBusy(true);
    try {
      const emoji = createTotemEmoji.trim();
      const totemName = createTotemName.trim();
      await createCrew({
        name: trimmed,
        festivalId: currentFestival?.id,
        // Only send totem fields when the user actually filled them in.
        ...(emoji ? { totemEmoji: emoji } : {}),
        ...(totemName ? { totemName } : {}),
      });
      setName('');
      setCreateTotemEmoji('');
      setCreateTotemName('');
    } catch {
      // Error is set in the store.
    } finally {
      setCreateBusy(false);
    }
  };

  // Owner-only totem save (rename the crew's rally marker). Opens the editor
  // seeded from the active crew, then PUTs name + emoji via the shared store.
  const openTotemEditor = (c: Crew) => {
    setEditTotemEmoji(c.totem_emoji ?? '');
    setEditTotemName(c.totem_name ?? '');
    setTotemEditOpen(true);
  };

  const handleSaveTotem = async (crewId: string) => {
    if (totemBusy) return;
    Keyboard.dismiss();
    setError(null);
    setTotemBusy(true);
    try {
      // Send empty strings (not omitted) so clearing a field actually clears
      // the totem server-side.
      await updateCrew(crewId, {
        totemEmoji: editTotemEmoji.trim(),
        totemName: editTotemName.trim(),
      });
      setTotemEditOpen(false);
    } catch {
      // Error is set in the store.
    } finally {
      setTotemBusy(false);
    }
  };

  const handleJoin = async () => {
    const trimmed = inviteCode.trim();
    if (!trimmed || joinBusy) return;
    Keyboard.dismiss();
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
    // Friendly join link (DC15): festie.us/join/CODE 302-redirects into the app
    // (routes/pages.ts) instead of exposing the machiney /api/v1/crews/join URL.
    const url = buildJoinUrl(code);
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

  // Reform the active crew for another festival. Crews are festival-scoped, so
  // this creates a NEW crew in the chosen festival and brings the prior roster
  // across (members already in that festival are auto-added; the rest get the
  // invite link). Presents the eligible target festivals as an action sheet.
  const performReform = useCallback(
    async (sourceCrewId: string, targetFestivalId: string, festivalName: string) => {
      setReformBusy(true);
      try {
        const res = await reformCrew(sourceCrewId, targetFestivalId);
        const added = res.reform?.autoAdded?.length ?? 0;
        const invited = res.reform?.invited?.length ?? 0;
        Alert.alert(
          'Crew reformed',
          `Started fresh for ${festivalName}. ${added} member${added === 1 ? '' : 's'} added; ` +
            `share the invite code with the other ${invited} to bring them across.`,
        );
      } catch (err) {
        Alert.alert("Couldn't reform crew", mapErrorToUserMessage(err, 'Try again.'));
      } finally {
        setReformBusy(false);
      }
    },
    [reformCrew],
  );

  const handleReform = useCallback(
    (sourceCrewId: string, sourceFestivalId: string | undefined) => {
      const open = () => {
        const options = festivals.filter((f) => f.id !== sourceFestivalId);
        if (options.length === 0) {
          Alert.alert('No other festivals', 'There are no other festivals to reform this crew for yet.');
          return;
        }
        Alert.alert(
          'Reform crew',
          'Choose a festival to start this crew fresh for. Members already in that festival are added ' +
            'automatically; share the invite link with everyone else.',
          [
            ...options.slice(0, 10).map((f) => ({
              text: f.name,
              onPress: () => performReform(sourceCrewId, f.id, f.name),
            })),
            { text: 'Cancel', style: 'cancel' as const },
          ],
        );
      };
      if (festivals.length === 0) {
        loadFestivals()
          .then(open)
          .catch(() => Alert.alert("Couldn't load festivals", 'Try again.'));
      } else {
        open();
      }
    },
    [festivals, loadFestivals, performReform],
  );

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
          kickMember(crewId, member.userId).catch(() => {});
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
            transferOwnership(crewId, member.userId).catch(() => {});
          },
        },
      ],
    );
  };

  const handleForceAdd = async (crewId: string) => {
    const trimmed = forceAddId.trim();
    if (!trimmed || forceAddBusy) return;
    Keyboard.dismiss();
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
          icon="lock-closed-outline"
          title="Sign in required"
          message="Log in to coordinate with your crew."
          action={{ label: 'Sign in', onPress: () => router.push('/(auth)/login') }}
        />
      </View>
    );
  }

  // Initial load — no crews fetched yet. Show a skeleton that matches the crew
  // chrome + member-row geometry instead of a bare spinner, so the layout
  // doesn't jump when data lands. (Cached crews render immediately and skip
  // this branch entirely — this is the cold-start case only.)
  if (crewLoading && crews.length === 0 && !activeCrew) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Crew" icon="people" />
        <View
          style={[styles.crewChrome, tabletInset]}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading your crews"
        >
          <Skeleton height={44} radius={t.radii.default} />
          <View style={styles.skeletonList}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <Skeleton width={40} height={40} radius={20} />
                <View style={styles.skeletonRowBody}>
                  <Skeleton width="55%" height={14} radius={t.radii.xs} />
                  <Skeleton width="32%" height={10} radius={t.radii.xs} />
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  // No active crew: show create / join forms.
  if (!activeCrew) {
    return (
      // KAV is dropped: behavior='padding' is a no-op on Android and
      // behavior='height' doesn't scroll the focused field into view when it's
      // deep in the list. automaticallyAdjustKeyboardInsets on the scroll
      // container handles both platforms correctly (same pattern as
      // account.tsx / app/set/[setId].tsx).
      <View style={styles.screen}>
        <ScreenHeader title="Crew" subtitle="Coordinate with friends" icon="people" />
        <ScrollView
          style={styles.flex1}
          contentContainerStyle={formScrollStyle}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
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
            {/* Crew totem (rally marker) — the flag/emoji the crew holds up so
                they can find each other. Both optional; a plain emoji text
                field (no picker) + short label. */}
            <View style={styles.totemFieldRow}>
              <TextInput
                style={[styles.input, styles.totemEmojiInput]}
                placeholder="🦄"
                placeholderTextColor={t.colors.text.placeholder}
                value={createTotemEmoji}
                onChangeText={setCreateTotemEmoji}
                maxLength={16}
                autoCorrect={false}
                accessibilityLabel="Crew totem emoji"
              />
              <TextInput
                style={[styles.input, styles.totemNameInput]}
                placeholder="Totem name (optional)"
                placeholderTextColor={t.colors.text.placeholder}
                value={createTotemName}
                onChangeText={setCreateTotemName}
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={handleCreate}
                accessibilityLabel="Crew totem name"
              />
            </View>
            <Button
              label={createBusy ? 'Creating…' : 'Create Crew'}
              onPress={handleCreate}
              disabled={createBusy || !name.trim()}
              accessibilityLabel="Create crew"
            />
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
      </View>
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

  // Plan-tab at-a-glance counts (derived from already-loaded crew data, no extra
  // fetch): how many packing items still need a claimer, and how many rides are
  // on the board. Surfaced as small aqua count pills next to the section labels
  // so the crew sees what's outstanding without expanding each list.
  const packingLeft = packingItems.filter((i) => !i.claimed).length;
  const packingDone = packingItems.length > 0 && packingLeft === 0;
  const rideCount = rideOffers.length;

  // Shared pull-to-refresh control (only one tab renders at a time).
  const crewRefreshControl = (
    <RefreshControl
      refreshing={crewLoading}
      onRefresh={handleRefresh}
      tintColor={t.colors.accent.aqua}
      colors={[t.colors.accent.aqua]}
      progressBackgroundColor={t.colors.bg.secondary}
    />
  );

  return (
    // KAV is dropped: behavior='padding' is a no-op on Android and
    // behavior='height' doesn't scroll the focused field into view when it's
    // deep in the list (totem editor / force-add / expense inputs).
    // automaticallyAdjustKeyboardInsets on each scroll body handles both
    // platforms correctly (same pattern as account.tsx / app/set/[setId].tsx).
    <View style={styles.screen}>
      <ScreenHeader
        title={crew.name}
        subtitle={`${members.length} ${members.length === 1 ? 'member' : 'members'}`}
        icon="people"
      />

      {/* Persistent crew chrome — identity, invite code and crew switcher stay
          visible across every tab so switching crews or sharing the code never
          hides behind a tab. */}
      <View style={[styles.crewChrome, tabletInset]}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Crew totem (rally marker) + low-power status, shown in the header so
            the crew's flag is always visible. The totem chip renders only when
            the crew has an emoji or name set. */}
        {crew.totem_emoji || crew.totem_name ? (
          <View style={styles.totemChip} accessibilityLabel={`Crew totem ${crew.totem_name ?? ''}`.trim()}>
            {crew.totem_emoji ? <Text style={styles.totemChipEmoji}>{crew.totem_emoji}</Text> : null}
            {crew.totem_name ? (
              <Text style={styles.totemChipName} numberOfLines={1}>
                {crew.totem_name}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.crewMetaRow}>
          <UpdatedAgoBadge surface="crew" />
          <LowPowerIndicator />
          {/* Always-visible SOS entry: the full SOS panel lives in the Logistics
              tab, so this chip jumps there rather than duplicating the raise
              flow — safety must be reachable from every crew tab. */}
          <TouchableOpacity
            testID="crew-action-sos"
            style={styles.sosChip}
            onPress={() => setCrewTab('logistics')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Open crew safety to send an SOS"
          >
            <Ionicons name="alert-circle" size={t.iconSize.compact} color={t.colors.text.onAccent} />
            <Text style={styles.sosChipText} maxFontSizeMultiplier={MAX_FONT_SCALE}>SOS</Text>
          </TouchableOpacity>
        </View>

        {crew.inviteCode ? (
          <View style={styles.inviteBar}>
            <Ionicons name="key-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.inviteLabel}>Invite code</Text>
            <Text style={styles.inviteCode} accessibilityLabel={`Invite code ${crew.inviteCode}`}>
              {crew.inviteCode}
            </Text>
            <TouchableOpacity
              testID="crew-action-share-invite"
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
                testID="crew-action-regenerate-invite"
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
                    if (!active) {
                      haptics.select();
                      selectCrew(c.id).catch(() => {});
                    }
                  }}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to crew ${c.name}`}
                  accessibilityState={{ selected: active }}
                >
                  {c.totem_emoji ? (
                    <Text style={styles.crewChipEmoji} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                      {c.totem_emoji}
                    </Text>
                  ) : null}
                  <Text style={[styles.crewChipText, active && styles.crewChipTextActive]} numberOfLines={1}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {/* P1-2 — segmented crew tab bar (web parity). The screen's many sections
          become Members / Plan / Logistics / Money tabs instead of one long
          scroll; every prior section is still reachable inside a tab. */}
      <CrewTabBar
        activeTab={crewTab}
        onTabChange={setCrewTab}
        badges={{ plan: openPollCount, money: hasUnsettledBalance }}
      />

      {crewTab === 'members' ? (
        <FlatList
          style={styles.flex1}
          data={members}
          keyExtractor={(m) => m.userId}
          contentContainerStyle={memberListStyle}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          refreshControl={crewRefreshControl}
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
                  <Text style={styles.avatarText}>{getInitials(item.name ?? '') || '?'}</Text>
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
                      {/* swap-horizontal reads as "hand over / transfer"; the
                          star glyph is reserved for the Owner badge so the two
                          aren't visually conflated. */}
                      <Ionicons name="swap-horizontal" size={18} color={t.colors.accent.aqua} />
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
                  <View accessible accessibilityLabel="Owner">
                    <Ionicons name="star" size={16} color={t.colors.aquaAlpha[40]} />
                  </View>
                ) : null}
              </View>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="person-outline"
              title="No members yet"
              message="Share your invite code to bring friends in."
              action={
                crew.inviteCode
                  ? { label: 'Share invite', onPress: () => handleShareInvite(crew.inviteCode!, crew.name) }
                  : undefined
              }
            />
          }
          ListFooterComponent={
            <View style={styles.tabFooter}>
              <SectionLabel>Manage</SectionLabel>

              {/* Reform this crew for another festival (M3). */}
              <TouchableOpacity
                testID="crew-action-reform"
                style={styles.overlapToggle}
                onPress={() => handleReform(crew.id, crew.festivalId)}
                disabled={reformBusy}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Reform this crew for another festival"
              >
                <Ionicons name="calendar-outline" size={16} color={t.colors.accent.aqua} />
                <Text style={styles.overlapToggleText}>
                  {reformBusy ? 'Reforming…' : 'Reform for another festival'}
                </Text>
                {reformBusy ? (
                  <ActivityIndicator size="small" color={t.colors.accent.aqua} />
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
                )}
              </TouchableOpacity>

              {/* Owner-only crew totem editor (rally marker: emoji + name). */}
              {isOwner ? (
                totemEditOpen ? (
                  <View style={styles.forceAddBox}>
                    <Text style={styles.formLabel}>Crew totem</Text>
                    <View style={styles.totemFieldRow}>
                      <TextInput
                        style={[styles.input, styles.totemEmojiInput]}
                        placeholder="🦄"
                        placeholderTextColor={t.colors.text.placeholder}
                        value={editTotemEmoji}
                        onChangeText={setEditTotemEmoji}
                        maxLength={16}
                        autoCorrect={false}
                        accessibilityLabel="Crew totem emoji"
                      />
                      <TextInput
                        style={[styles.input, styles.totemNameInput]}
                        placeholder="Totem name"
                        placeholderTextColor={t.colors.text.placeholder}
                        value={editTotemName}
                        onChangeText={setEditTotemName}
                        maxLength={40}
                        returnKeyType="done"
                        onSubmitEditing={() => handleSaveTotem(crew.id)}
                        accessibilityLabel="Crew totem name"
                      />
                    </View>
                    <View style={styles.forceAddRow}>
                      <TouchableOpacity
                        style={[styles.outlineButton, styles.flexButton]}
                        onPress={() => setTotemEditOpen(false)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel totem edit"
                      >
                        <Text style={styles.outlineButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <Button
                        label={totemBusy ? 'Saving…' : 'Save totem'}
                        onPress={() => handleSaveTotem(crew.id)}
                        disabled={totemBusy}
                        accessibilityLabel="Save crew totem"
                        style={styles.flexButton}
                      />
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    testID="crew-action-edit-totem"
                    style={styles.overlapToggle}
                    onPress={() => openTotemEditor(crew)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Edit crew totem"
                  >
                    <Ionicons name="flag-outline" size={16} color={t.colors.accent.aqua} />
                    <Text style={styles.overlapToggleText}>
                      {crew.totem_emoji || crew.totem_name ? 'Edit crew totem' : 'Add crew totem'}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
                  </TouchableOpacity>
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
                      <Button
                        label={forceAddBusy ? 'Adding…' : 'Add'}
                        onPress={() => handleForceAdd(crew.id)}
                        disabled={forceAddBusy || !forceAddId.trim()}
                        accessibilityLabel="Confirm force-add"
                        style={styles.flexButton}
                      />
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    testID="crew-action-force-add"
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

              <View style={styles.footerActions}>
                {isOwner ? (
                  <TouchableOpacity
                    testID="crew-action-delete"
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
                    testID="crew-action-leave"
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
      ) : crewTab === 'plan' ? (
        <ScrollView
          style={styles.flex1}
          contentContainerStyle={tabScrollStyle}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={crewRefreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          {/* Everyday primary: the offline-native "what's my crew's plan"
              digest. Emphasized (aqua-tinted fill + border) so the most-used
              action carries more weight than the rest of the tab. Coral is
              reserved for danger/SOS, so these nav actions are aqua. */}
          <TouchableOpacity
            testID="crew-action-plan"
            style={[styles.overlapToggle, styles.overlapTogglePrimary]}
            onPress={() => router.push('/crew-plan')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="View your crew's plan"
          >
            <Ionicons name="calendar-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.overlapTogglePrimaryText}>Crew plan</Text>
            <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>

          {/* Schedule compare / overlap toggle. */}
          <TouchableOpacity
            testID="crew-action-overlap"
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
                        {/* DC25: 13 is off-grid; snap to iconSize.xs (12). */}
                        <Ionicons name="people" size={12} color={t.colors.accent.aqua} />
                        <Text style={styles.overlapBadgeText}>{o.memberCount}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )
          ) : null}

          {/* Full side-by-side compare matrix (members × sets). */}
          <TouchableOpacity
            testID="crew-action-compare-grid"
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

          {/* P2P plan handoff — discoverable from the Plan cluster so users
              find it before they need it. QR / SMS works with no signal. */}
          <TouchableOpacity
            testID="crew-action-share-plan-planning"
            style={styles.overlapToggle}
            onPress={() => router.push('/plan-share')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Share your plan — QR or SMS handoff, works offline"
          >
            <Ionicons name="qr-code-outline" size={16} color={t.colors.accent.aqua} />
            <View style={styles.overlapToggleLabelStack}>
              <Text style={styles.overlapToggleText}>Share plan</Text>
              <Text style={styles.overlapToggleHint}>QR / SMS handoff, works offline</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>

          <View style={styles.sectionLabelRow}>
            <SectionLabel>Polls</SectionLabel>
            {openPollCount > 0 ? (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{openPollCount}</Text>
              </View>
            ) : null}
          </View>
          <CrewPolls crewId={crew.id} currentUserId={user.id} isOwner={isOwner} />

          {/* DC4: Packing + Rides are pre-festival planning, so they live in
              Plan (moved out of the mid-festival "Find" cluster). The count
              pills give an at-a-glance "what's outstanding" without expanding. */}
          <View style={styles.sectionLabelRow}>
            <SectionLabel>Packing</SectionLabel>
            {packingDone ? (
              <View style={styles.donePill} accessibilityLabel="All packing items claimed">
                <Ionicons name="checkmark" size={12} color={t.colors.accent.aqua} />
                <Text style={styles.donePillText} maxFontSizeMultiplier={MAX_FONT_SCALE}>All packed</Text>
              </View>
            ) : packingLeft > 0 ? (
              <View
                style={styles.countBadge}
                accessibilityLabel={`${packingLeft} packing ${packingLeft === 1 ? 'item' : 'items'} unclaimed`}
              >
                <Text style={styles.countBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{packingLeft}</Text>
              </View>
            ) : null}
          </View>
          <CrewPacking crewId={crew.id} currentUserId={user.id} isOwner={isOwner} />

          <View style={styles.sectionLabelRow}>
            <SectionLabel>Rides</SectionLabel>
            {rideCount > 0 ? (
              <View
                style={styles.countBadge}
                accessibilityLabel={`${rideCount} ${rideCount === 1 ? 'ride' : 'rides'} on the board`}
              >
                <Text style={styles.countBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{rideCount}</Text>
              </View>
            ) : null}
          </View>
          <CrewRides crewId={crew.id} currentUserId={user.id} isOwner={isOwner} />
        </ScrollView>
      ) : crewTab === 'logistics' ? (
        <ScrollView
          style={styles.flex1}
          contentContainerStyle={tabScrollStyle}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={crewRefreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          {/* DC2: SOS must be reachable without any scroll — top of the pane,
              always visible the instant the Find tab opens. */}
          <CrewSos crewId={crew.id} currentUserId={user.id} />

          {/* "Find each other" — ONE destination that co-locates the crew map,
              the meeting-point compass and saved meeting points. */}
          <TouchableOpacity
            testID="crew-action-find"
            style={styles.overlapToggle}
            onPress={() => router.push('/find')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Find each other — crew map, compass and meeting points"
          >
            <Ionicons name="location-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.overlapToggleText}>Find each other</Text>
            <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>

          {/* M5 P2P plan handoff — QR / scan / SMS when signal is dead. */}
          <TouchableOpacity
            testID="crew-action-share-plan"
            style={styles.overlapToggle}
            onPress={() => router.push('/plan-share')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Share your plan with a friend (QR or text)"
          >
            <Ionicons name="qr-code-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.overlapToggleText}>Share plan (QR / text)</Text>
            <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
          </TouchableOpacity>

          {/* Live location toggle sits below the SOS button. In low-power mode
              the battery-hungry live-location share is paused (gated by the
              shared festival low-power flag); a chip explains why. */}
          <SectionLabel>Live location</SectionLabel>
          <View style={styles.liveSafetyBlock}>
            {lowPowerMode ? (
              <View style={styles.lowPowerPaused}>
                <LowPowerIndicator />
                <Text style={styles.lowPowerPausedText}>
                  Live location is paused to save battery. Turn off low-power mode on the Now & Next screen to share
                  again.
                </Text>
              </View>
            ) : (
              <CrewLiveLocation crewId={crew.id} />
            )}
          </View>

          <SectionLabel>Meeting points</SectionLabel>
          <CrewStatus crewId={crew.id} currentUserId={user.id} />
          <CrewMeetingPoints
            crewId={crew.id}
            currentUserId={user.id}
            isOwner={isOwner}
            festival={currentFestival}
            days={festivalDays}
            prefillCoords={prefillCoords}
          />

          <CrewHomeBase crewId={crew.id} location={crew.homeBaseLocation} time={crew.homeBaseTime} isOwner={isOwner} />

          <CrewPhotoLink crewId={crew.id} photoAlbumUrl={crew.photoAlbumUrl} />

          <SectionLabel>Activity</SectionLabel>
          <CrewActivity crewId={crew.id} />
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.flex1}
          contentContainerStyle={tabScrollStyle}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={crewRefreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.sectionLabelRow}>
            <SectionLabel>Expenses</SectionLabel>
            {hasUnsettledBalance ? (
              <View style={styles.unsettledDot} accessibilityLabel="You have an unsettled balance" />
            ) : null}
          </View>
          <CrewExpenses crewId={crew.id} members={members} currentUserId={user.id} />
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  // Bind each scroll body (Members FlatList + the Plan/Logistics/Money
  // ScrollViews + the no-crew form) to the screen's remaining height. Without
  // flex:1 they size to content, overflow past the bottom tab bar (member rows
  // "overlapping" the nav) and let the fixed chrome / CrewTabBar above expand to
  // fill the slack — which is why a tab's controls looked oversized on the
  // shorter Plan/Logistics panes. flex:1 makes the body absorb the slack and
  // scroll internally instead.
  flex1: {
    flex: 1,
  },
  formScroll: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[4],
  },
  // Persistent crew chrome (identity / invite / switcher) above the tab bar.
  crewChrome: {
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[3],
    paddingBottom: t.spacing[3],
  },
  // Header meta row: freshness badge + low-power indicator.
  crewMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  // Compact always-visible SOS entry, right-aligned in the header meta row.
  // coralStrong bg + white text mirrors the Button danger pattern; jumps to the
  // Logistics tab where the full CrewSos panel renders.
  sosChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    marginLeft: 'auto',
    paddingHorizontal: t.spacing[3],
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: t.radii.default,
    backgroundColor: t.colors.accent.coralStrong,
  },
  sosChipText: {
    ...typeStyle('label', 700),
    color: t.colors.text.onAccent,
  },
  // Crew totem chip shown in the header (emoji + name rally marker).
  totemChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    alignSelf: 'flex-start',
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[15],
  },
  totemChipEmoji: {
    ...typeStyle('label'),
  },
  totemChipName: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
    flexShrink: 1,
  },
  // Totem create/edit fields: a narrow emoji box + a flexible name box.
  totemFieldRow: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  totemEmojiInput: {
    width: 64,
    textAlign: 'center',
  },
  totemNameInput: {
    flex: 1,
  },
  // Live-location block when low-power mode pauses the share.
  lowPowerPaused: {
    gap: t.spacing[2],
  },
  lowPowerPausedText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  // Scroll content for the Plan / Logistics / Money tabs.
  tabScroll: {
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[1],
    gap: t.spacing[3],
  },
  // Members-tab footer (Manage cluster + danger actions).
  tabFooter: {
    gap: t.spacing[3],
    marginTop: t.spacing[4],
  },
  error: {
    ...typeStyle('body'),
    color: t.colors.text.danger,
    textAlign: 'center',
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
  // Primary aqua CTAs migrated to components/Button (F8).
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
    padding: t.spacing[2],
    // Guarantee a >=44pt touch target (WCAG / Apple HIG) for these small
    // (16-18px) icon-only controls — padding alone can't reach it.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
    // WCAG 2.5.5 44pt floor (F43) — matches dayChip/filterChip/iconButton.
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  // Totem emoji shown inline before the crew name in the switcher chip, so the
  // crew's rally marker is recognizable at a glance when hopping between crews.
  crewChipEmoji: {
    ...typeStyle('caption'),
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
  overlapToggleLabelStack: {
    flex: 1,
    flexDirection: 'column',
    gap: 1,
  },
  overlapToggleHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  // Emphasized variant for the everyday-primary action (Crew plan): aqua-tinted
  // fill + aqua border so it carries more weight than the plain toolbox rows,
  // without becoming a loud solid-aqua CTA.
  overlapTogglePrimary: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  overlapTogglePrimaryText: {
    ...typeStyle('label', 700),
    color: t.colors.accent.aqua,
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
    gap: t.spacing[3],
  },
  // Cold-start skeleton (mirrors the member-row geometry so nothing jumps).
  skeletonList: {
    gap: t.spacing[3],
    marginTop: t.spacing[3],
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 56,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  skeletonRowBody: {
    flex: 1,
    gap: t.spacing[2],
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
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  // "All packed" affordance — a calm aqua confirmation pill (not coral; this is
  // a positive done-state, not an alarm) shown when nothing is left to claim.
  donePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[12],
    marginBottom: t.spacing[1],
  },
  donePillText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
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
    // Match AccountScreen's row floor so every member row keeps a >=44pt
    // touch target even when the name wraps to a single short line.
    minHeight: 56,
    // Hairline-divider idiom: flat row separated by a single-pixel bottom
    // border rather than individually boxed cards.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border.default,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.aquaAlpha[15],
  },
  avatarText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
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
    color: t.colors.text.secondary,
  },
  memberActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  liveSafetyBlock: {
    gap: t.spacing[3],
    marginBottom: t.spacing[2],
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
