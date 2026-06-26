import { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@festie/shared/hooks';
import Button from './Button';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { passwordStrength } from '../lib/accountFormat';

/**
 * Password-change form for the Account screen.
 *
 * Wired to the shared useAuth().changePassword → authStore.changePassword,
 * which POSTs /auth/change-password with { currentPassword, newPassword }.
 * The shared method is fully platform-neutral, so this is just the UI: two
 * secure fields, an 8-char minimum check, in-flight spinner, and inline errors.
 */
const STRENGTH_COLORS = ['#f87171', '#ffb020', '#00e8d0', '#39ff14'] as const; // weak→strong

export default function AccountPasswordSection() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const { changePassword } = useAuth();

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One toggle reveals every field — fewer taps than a per-field eye and the
  // user is changing all three at once anyway.
  const [reveal, setReveal] = useState(false);

  // Refs to chain the three secure fields: current → new → confirm → submit.
  const nextRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    setReveal(false);
  };

  const toggle = () => {
    setOpen((prev) => {
      if (prev) reset();
      return !prev;
    });
  };

  const validate = (): string | null => {
    if (!current) return 'Enter your current password.';
    if (next.length < 8) return 'New password must be at least 8 characters.';
    if (next !== confirm) return 'New passwords do not match.';
    if (next === current) return 'New password must differ from the current one.';
    return null;
  };

  const submit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      haptics.warning();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      haptics.success();
      reset();
      setOpen(false);
      Alert.alert('Password updated', 'Your password has been changed.');
    } catch (err) {
      haptics.warning();
      setError(err instanceof Error ? err.message : 'Could not change password.');
    } finally {
      setSubmitting(false);
    }
  };

  const strength = passwordStrength(next);
  const matchState: 'none' | 'match' | 'mismatch' =
    confirm.length === 0 ? 'none' : confirm === next ? 'match' : 'mismatch';

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.row}
        onPress={toggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide change password form' : 'Change password'}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.rowIcon}>
          <Ionicons name="key-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Change Password</Text>
          <Text style={styles.rowHint}>At least 8 characters</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-forward'} size={18} color={t.colors.text.placeholder} />
      </TouchableOpacity>

      {open ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={current}
            onChangeText={setCurrent}
            placeholder="Current password"
            placeholderTextColor={t.colors.text.placeholder}
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            editable={!submitting}
            accessibilityLabel="Current password"
            returnKeyType="next"
            onSubmitEditing={() => nextRef.current?.focus()}
            blurOnSubmit={false}
          />

          <TextInput
            ref={nextRef}
            style={styles.input}
            value={next}
            onChangeText={setNext}
            placeholder="New password"
            placeholderTextColor={t.colors.text.placeholder}
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoComplete="password-new"
            textContentType="newPassword"
            editable={!submitting}
            accessibilityLabel="New password"
            returnKeyType="next"
            onSubmitEditing={() => confirmRef.current?.focus()}
            blurOnSubmit={false}
          />

          {/* Strength meter — UX guidance only; the 8-char rule is authoritative. */}
          {next.length > 0 ? (
            <View style={styles.meterWrap} accessibilityRole="text" accessibilityLabel={`Password strength: ${strength.label}`}>
              <View style={styles.meterTrack}>
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={[
                      styles.meterSeg,
                      i < strength.score && { backgroundColor: STRENGTH_COLORS[Math.max(0, strength.score - 1)] },
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.meterLabel, { color: STRENGTH_COLORS[Math.max(0, strength.score - 1)] }]}>
                {strength.label}
              </Text>
            </View>
          ) : null}

          <TextInput
            ref={confirmRef}
            style={[
              styles.input,
              matchState === 'mismatch' && styles.inputError,
              matchState === 'match' && styles.inputOk,
            ]}
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Confirm new password"
            placeholderTextColor={t.colors.text.placeholder}
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoComplete="password-new"
            textContentType="newPassword"
            editable={!submitting}
            accessibilityLabel="Confirm new password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />

          <View style={styles.metaRow}>
            {matchState === 'match' ? (
              <View style={styles.matchPill}>
                <Ionicons name="checkmark-circle" size={13} color={t.colors.status.verified} style={styles.matchIcon} />
                <Text style={[styles.matchText, { color: t.colors.status.verified }]}>Passwords match</Text>
              </View>
            ) : matchState === 'mismatch' ? (
              <View style={styles.matchPill}>
                <Ionicons name="close-circle" size={13} color={t.colors.text.danger} style={styles.matchIcon} />
                <Text style={[styles.matchText, { color: t.colors.text.danger }]}>Doesn’t match</Text>
              </View>
            ) : (
              <View />
            )}
            <TouchableOpacity
              onPress={() => setReveal((r) => !r)}
              activeOpacity={0.7}
              hitSlop={8}
              accessibilityRole="switch"
              accessibilityLabel={reveal ? 'Hide passwords' : 'Show passwords'}
              accessibilityState={{ checked: reveal }}
              style={styles.reveal}
            >
              <Ionicons name={reveal ? 'eye-off-outline' : 'eye-outline'} size={15} color={t.colors.text.secondary} style={styles.revealIcon} />
              <Text style={styles.revealText}>{reveal ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Button
            label="Update Password"
            onPress={() => void submit()}
            loading={submitting}
            accessibilityLabel="Save new password"
          />
        </View>
      ) : null}
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
  form: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
    gap: t.spacing[3],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    paddingTop: t.spacing[3],
  },
  input: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    backgroundColor: t.colors.bg.primary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 48,
  },
  inputError: {
    borderColor: t.colors.accent.coral,
  },
  inputOk: {
    borderColor: t.colors.aquaAlpha[40],
  },
  meterWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    marginTop: -t.spacing[1],
  },
  meterTrack: {
    flex: 1,
    flexDirection: 'row',
    gap: t.spacing[1],
  },
  meterSeg: {
    flex: 1,
    height: 4,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.border.light,
  },
  meterLabel: {
    ...typeStyle('caption'),
    minWidth: 52,
    textAlign: 'right',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -t.spacing[1],
  },
  matchPill: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  matchIcon: {
    marginRight: 4,
  },
  matchText: {
    ...typeStyle('caption'),
  },
  reveal: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: t.spacing[1],
  },
  revealIcon: {
    marginRight: 4,
  },
  revealText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
}));
