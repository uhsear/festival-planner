import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import Button from '../../components/Button';
import { ConfirmDialog, LabeledTextInput } from '../../components/admin';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Admin — User management (native mirror of packages/web AdminUsers.tsx).
 *
 * Lives under app/admin/ so the root AuthGate (seg[0] === 'admin') guards it;
 * a non-admin who deep-links here is bounced to the tabs by that gate, and we
 * also render an "Admins only" EmptyState as a belt-and-braces fallback. The
 * native Stack header (headerShown) supplies the back chevron that returns to
 * /admin — pushed non-tab screens use the platform header per ScreenHeader's
 * adoption rule.
 *
 * Reuses the shared api.* calls exactly as the web console does — NO new
 * backend logic. Endpoints resolve under /api/v1:
 *   GET    /admin/users                      → User[] (wrapper strips pagination meta)
 *   POST   /admin/users/:id/roles            { role: 'admin' }   → grant admin
 *   DELETE /admin/users/:id/roles/admin                          → revoke admin
 *   PUT    /admin/users/:id/reset-password   { newPassword }     → admin reset
 *   DELETE /admin/users/:id                                      → delete user
 *
 * Search is client-side over the loaded list (matching the web component); the
 * GET endpoint also accepts a `search` query, but the wrapper returns only the
 * first page, so filtering locally keeps every loaded row searchable. EVERY
 * destructive write (grant/revoke admin, reset password, delete) is gated
 * behind ConfirmDialog before the api.* call fires.
 */

interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  roles: string[];
  createdAt: string;
}

// Discriminated confirm intents — the parent owns the dialog state and which
// mutation the confirm button will run, mirroring the web ConfirmDialog wiring.
type PendingAction =
  | { kind: 'toggle-admin'; user: AdminUser; grant: boolean }
  | { kind: 'reset-password'; user: AdminUser; newPassword: string }
  | { kind: 'delete'; user: AdminUser };

export default function AdminUsersScreen() {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');

  // Which user's inline action panel (reset-password form) is expanded.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);

  // Pending destructive intent + in-flight guard for the ConfirmDialog.
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const result = await api.get<AdminUser[]>('/admin/users');
      setUsers(Array.isArray(result) ? result : []);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load-once guard: non-admins have nothing to fetch, so clear the initial loading flag. Tied to the fetch lifecycle, not derivable from render inputs.
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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.username.toLowerCase().includes(q) || (u.email ? u.email.toLowerCase().includes(q) : false),
    );
  }, [users, search]);

  // ── Open the reset-password panel for a user (collapse others) ──────────
  const toggleExpanded = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
    setNewPassword('');
    setPwError(null);
  }, []);

  // ── Stage a destructive intent into the ConfirmDialog ───────────────────
  const requestToggleAdmin = useCallback((user: AdminUser) => {
    const grant = !user.roles.includes('admin');
    setPending({ kind: 'toggle-admin', user, grant });
  }, []);

  const requestResetPassword = useCallback(
    (user: AdminUser) => {
      const pw = newPassword;
      if (pw.length < 8) {
        setPwError('Password must be at least 8 characters.');
        return;
      }
      setPwError(null);
      setPending({ kind: 'reset-password', user, newPassword: pw });
    },
    [newPassword],
  );

  const requestDelete = useCallback((user: AdminUser) => {
    setPending({ kind: 'delete', user });
  }, []);

  // ── Run the confirmed mutation, then reconcile local state ──────────────
  const runPending = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'toggle-admin') {
        const { user, grant } = pending;
        if (grant) {
          await api.post<unknown>(`/admin/users/${user.id}/roles`, { role: 'admin' });
        } else {
          await api.delete<unknown>(`/admin/users/${user.id}/roles/admin`);
        }
        setUsers((prev) =>
          prev.map((u) =>
            u.id === user.id
              ? { ...u, roles: grant ? [...u.roles, 'admin'] : u.roles.filter((r) => r !== 'admin') }
              : u,
          ),
        );
        setPending(null);
        Alert.alert(grant ? 'Admin granted' : 'Admin revoked', `@${user.username} ${grant ? 'now has' : 'no longer has'} admin access.`);
      } else if (pending.kind === 'reset-password') {
        const { user, newPassword: pw } = pending;
        await api.put<unknown>(`/admin/users/${user.id}/reset-password`, { newPassword: pw });
        setPending(null);
        setExpandedId(null);
        setNewPassword('');
        Alert.alert('Password reset', `A new password has been set for @${user.username}.`);
      } else {
        const { user } = pending;
        await api.delete<unknown>(`/admin/users/${user.id}`);
        setUsers((prev) => prev.filter((u) => u.id !== user.id));
        if (expandedId === user.id) setExpandedId(null);
        setPending(null);
        Alert.alert('User deleted', `@${user.username} has been removed.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Try again.';
      // Keep the dialog open on failure so the admin can retry or cancel.
      Alert.alert('Action failed', msg);
    } finally {
      setBusy(false);
    }
  }, [pending, expandedId]);

  // Confirm-dialog copy derived from the staged intent.
  const confirm = useMemo(() => {
    if (!pending) return null;
    if (pending.kind === 'toggle-admin') {
      return {
        title: pending.grant ? `Grant admin to @${pending.user.username}?` : `Revoke admin from @${pending.user.username}?`,
        message: pending.grant
          ? 'This gives the user full access to the admin console, including destructive operations.'
          : 'This removes the user’s access to the admin console.',
        confirmLabel: pending.grant ? 'Grant Admin' : 'Revoke Admin',
        destructive: true,
      };
    }
    if (pending.kind === 'reset-password') {
      return {
        title: `Reset password for @${pending.user.username}?`,
        message:
          'This sets a new password and signs the user out of all sessions. Share the new password with them securely.',
        confirmLabel: 'Reset Password',
        destructive: true,
      };
    }
    return {
      title: `Delete @${pending.user.username}?`,
      message: 'This permanently removes their account, picks, and crew memberships. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    };
  }, [pending]);

  // Non-admins never see the data — the AuthGate bounces them, but render a
  // clear fallback in case this mounts before the redirect lands.
  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: true, title: 'Users' }} />
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
      <Stack.Screen options={{ headerShown: true, title: 'Users' }} />

      {loading ? (
        <LoadingState label="Loading users" />
      ) : error ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load users"
          message="Something went wrong reaching the server."
          action={{ label: 'Try again', onPress: () => void onRefresh() }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={t.colors.accent.aqua}
              colors={[t.colors.accent.aqua]}
            />
          }
        >
          <LabeledTextInput
            label={`Search (${filtered.length})`}
            value={search}
            onChangeText={setSearch}
            placeholder="Search by username or email…"
            autoCapitalize="none"
            accessibilityLabel="Search users by username or email"
          />

          {filtered.length === 0 ? (
            <EmptyState
              icon="search-outline"
              title="No users found"
              message="Try adjusting your search query."
            />
          ) : (
            <View style={styles.card}>
              {filtered.map((user, i) => {
                const isUserAdmin = user.roles.includes('admin');
                const expanded = expandedId === user.id;
                const isSelf = user.id === currentUserId;
                return (
                  <View key={user.id} style={[i < filtered.length - 1 && styles.rowDivider]}>
                    <View style={styles.row}>
                      <View style={styles.rowBody}>
                        <View style={styles.nameLine}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {user.username}
                          </Text>
                          {isUserAdmin ? (
                            <View style={styles.adminBadge}>
                              <Text style={styles.adminBadgeText}>ADMIN</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.rowHint} numberOfLines={1}>
                          {user.email ?? 'no email'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.expandButton}
                        onPress={() => toggleExpanded(user.id)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={expanded ? `Hide actions for ${user.username}` : `Manage ${user.username}`}
                        accessibilityState={{ expanded }}
                      >
                        <Ionicons
                          name={expanded ? 'chevron-up' : 'chevron-forward'}
                          size={18}
                          color={t.colors.text.placeholder}
                        />
                      </TouchableOpacity>
                    </View>

                    {expanded ? (
                      <View style={styles.actions}>
                        {!isSelf ? (
                          <Button
                            label={isUserAdmin ? 'Revoke Admin' : 'Grant Admin'}
                            variant="secondary"
                            size="sm"
                            icon="shield-checkmark-outline"
                            onPress={() => requestToggleAdmin(user)}
                            accessibilityLabel={isUserAdmin ? `Revoke admin from ${user.username}` : `Grant admin to ${user.username}`}
                          />
                        ) : null}

                        <View style={styles.resetBlock}>
                          <LabeledTextInput
                            label="New password"
                            value={newPassword}
                            onChangeText={(v) => {
                              setNewPassword(v);
                              if (pwError) setPwError(null);
                            }}
                            placeholder="At least 8 characters"
                            hint="Sets a new password and signs the user out everywhere."
                            error={pwError}
                            autoCapitalize="none"
                            maxLength={200}
                            accessibilityLabel={`New password for ${user.username}`}
                          />
                          <Button
                            label="Reset Password"
                            variant="secondary"
                            size="sm"
                            icon="key-outline"
                            onPress={() => requestResetPassword(user)}
                            accessibilityLabel={`Reset password for ${user.username}`}
                          />
                        </View>

                        {!isSelf ? (
                          <Button
                            label="Delete User"
                            variant="danger"
                            size="sm"
                            icon="trash-outline"
                            onPress={() => requestDelete(user)}
                            accessibilityLabel={`Delete ${user.username}`}
                          />
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      <ConfirmDialog
        visible={!!pending && !busy}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.confirmLabel ?? 'Confirm'}
        destructive={confirm?.destructive ?? true}
        onConfirm={() => void runPending()}
        onCancel={() => setPending(null)}
      />
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
    paddingTop: t.spacing[4],
    gap: t.spacing[3],
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
    alignItems: 'center',
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
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  rowTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  // Aqua, not coral: "admin" is a role/status, not a danger state. Coral is
  // reserved for danger/SOS (one-accent rule), and the Account screen's own
  // ADMIN badge is aqua — this list badge was an inconsistent misuse.
  adminBadge: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 2,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  adminBadgeText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  expandButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
    paddingTop: t.spacing[1],
    gap: t.spacing[3],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
  },
  resetBlock: {
    gap: t.spacing[3],
  },
}));
