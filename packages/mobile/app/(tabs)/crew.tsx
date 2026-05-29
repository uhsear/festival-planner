import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useAuthStore,
  useCrewStore,
  useFestivalStore,
} from '@festie/shared/stores';
import type { Crew, CrewMember } from '@festie/shared/types';
import { useTokens, makeStyles, typeStyle } from '../../hooks/useTokens';
import ScreenHeader from '../../components/ScreenHeader';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';

/** Two-letter initials derived from a member's display name (fallback "?"). */
function initialsFor(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default function CrewScreen() {
  const t = useTokens();
  const styles = useStyles();

  const user = useAuthStore((s) => s.user);
  const crews = useCrewStore((s) => s.crews);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewLoading = useCrewStore((s) => s.crewLoading);
  const error = useCrewStore((s) => s.error);
  const loadCrews = useCrewStore((s) => s.loadCrews);
  const selectCrew = useCrewStore((s) => s.selectCrew);
  const createCrew = useCrewStore((s) => s.createCrew);
  const joinByCode = useCrewStore((s) => s.joinByCode);
  const setError = useCrewStore((s) => s.setError);
  const currentFestival = useFestivalStore((s) => s.currentFestival);

  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);

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

  if (!user) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Crew" icon="people" />
        <EmptyState
          icon="lock-closed"
          title="Sign in required"
          message="Log in to coordinate with your crew."
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
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScreenHeader
          title="Crew"
          subtitle="Coordinate with friends"
          icon="people"
        />
        <ScrollView
          contentContainerStyle={styles.formScroll}
          keyboardShouldPersistTaps="handled"
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
            <TouchableOpacity
              style={[styles.primaryButton, createBusy && styles.buttonDisabled]}
              onPress={handleCreate}
              disabled={createBusy || !name.trim()}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Create crew"
            >
              <Text style={styles.primaryButtonText}>
                {createBusy ? 'Creating…' : 'Create Crew'}
              </Text>
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
              <Text style={styles.outlineButtonText}>
                {joinBusy ? 'Joining…' : 'Join by Code'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Active crew: show name, invite code, and the member list.
  const crew: Crew = activeCrew;
  const members: CrewMember[] = crew.members ?? [];

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={crew.name}
        subtitle={`${members.length} ${members.length === 1 ? 'member' : 'members'}`}
        icon="people"
      />

      {crew.inviteCode ? (
        <View style={styles.inviteBar}>
          <Ionicons
            name="key-outline"
            size={16}
            color={t.colors.accent.aqua}
          />
          <Text style={styles.inviteLabel}>Invite code</Text>
          <Text style={styles.inviteCode} accessibilityLabel={`Invite code ${crew.inviteCode}`}>
            {crew.inviteCode}
          </Text>
        </View>
      ) : null}

      {crews.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.crewSwitcher}
        >
          {crews.map((c) => {
            const isActive = c.id === crew.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={[styles.crewChip, isActive && styles.crewChipActive]}
                onPress={() => {
                  if (!isActive) selectCrew(c.id).catch(() => {});
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Switch to crew ${c.name}`}
              >
                <Text
                  style={[styles.crewChipText, isActive && styles.crewChipTextActive]}
                  numberOfLines={1}
                >
                  {c.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

      <FlatList
        data={members}
        keyExtractor={(m) => m.id || m.userId}
        contentContainerStyle={styles.memberList}
        ListHeaderComponent={
          <Text style={styles.sectionLabel}>Members</Text>
        }
        renderItem={({ item }) => {
          const isOwner = item.role === 'owner' || item.userId === crew.owner;
          const displayName = item.name || 'Member';
          return (
            <View style={styles.memberRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsFor(item.name)}</Text>
              </View>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {displayName}
                </Text>
                {isOwner ? <Text style={styles.memberRole}>Owner</Text> : null}
              </View>
              {isOwner ? (
                <Ionicons
                  name="star"
                  size={16}
                  color={t.colors.accent.amber}
                />
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
      />

      {/* Deferred web sub-features: home base, schedule comparison/overlap,
          polls, meeting points, and member admin (kick/transfer/force-add)
          are not yet ported to mobile — the primary crew + members view is
          rendered here. */}
    </View>
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
  buttonDisabled: {
    opacity: 0.6,
  },
  inviteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    marginHorizontal: t.spacing[4],
    marginBottom: t.spacing[3],
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
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[3],
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
}));
