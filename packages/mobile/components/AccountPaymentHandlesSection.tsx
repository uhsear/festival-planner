import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@festie/shared/stores';
import { api } from '@festie/shared/services';
import type { User } from '@festie/shared/types';
import Button from './Button';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

/**
 * Payment-handle editor for the Account screen. Sets Venmo / Cash App / PayPal
 * handles used to build prefilled settle-up deep links in the crew expenses
 * tab. All optional; clearing a field removes it. A leading @/$ is normalized
 * server-side. PUT /account/payment-handles → { user } (serializePublicUser).
 */
export default function AccountPaymentHandlesSection() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const current = {
    venmo: user?.venmoHandle ?? '',
    cashapp: user?.cashappCashtag ?? '',
    paypal: user?.paypalHandle ?? '',
  };

  const [open, setOpen] = useState(false);
  const [venmo, setVenmo] = useState(current.venmo);
  const [cashapp, setCashapp] = useState(current.cashapp);
  const [paypal, setPaypal] = useState(current.paypal);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Transient inline confirmation — a quiet "Saved" beats a modal Alert for a
  // non-destructive success (matches the password/avatar sections; Alerts are
  // reserved for destructive confirmations).
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const dirty =
    venmo.trim() !== current.venmo || cashapp.trim() !== current.cashapp || paypal.trim() !== current.paypal;

  const count = [current.venmo, current.cashapp, current.paypal].filter(Boolean).length;
  const summary =
    [current.venmo && 'Venmo', current.cashapp && 'Cash App', current.paypal && 'PayPal'].filter(Boolean).join(' · ') ||
    'Add a way to get paid back';

  const reset = () => {
    setVenmo(current.venmo);
    setCashapp(current.cashapp);
    setPaypal(current.paypal);
    setError(null);
    setSaved(false);
  };

  const toggle = () => {
    setOpen((prev) => {
      if (prev) reset();
      return !prev;
    });
  };

  const submit = async () => {
    if (!dirty) {
      setError('No changes to save.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.put<{ user: User }>('/account/payment-handles', {
        venmoHandle: venmo.trim(),
        cashappCashtag: cashapp.trim(),
        paypalHandle: paypal.trim(),
      });
      if (user) {
        setUser({
          ...user,
          venmoHandle: res.user?.venmoHandle ?? null,
          cashappCashtag: res.user?.cashappCashtag ?? null,
          paypalHandle: res.user?.paypalHandle ?? null,
        });
      }
      setVenmo(res.user?.venmoHandle ?? '');
      setCashapp(res.user?.cashappCashtag ?? '');
      setPaypal(res.user?.paypalHandle ?? '');
      haptics.success();
      // Keep the card open briefly to show the inline confirmation, then collapse.
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => {
        setSaved(false);
        setOpen(false);
      }, 1800);
    } catch (err) {
      haptics.warning();
      setError(err instanceof Error ? err.message : 'Could not update payment handles.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.row}
        onPress={toggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide payment handles form' : 'Edit payment handles'}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.rowIcon}>
          <Ionicons name="wallet-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Payment handles</Text>
          <Text style={styles.rowHint} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        {count > 0 && !open ? (
          <View style={styles.countPill}>
            <Text style={styles.countText}>{count}</Text>
          </View>
        ) : null}
        <Ionicons name={open ? 'chevron-up' : 'chevron-forward'} size={18} color={t.colors.text.placeholder} />
      </TouchableOpacity>

      {open ? (
        <View style={styles.form}>
          <Text style={styles.formIntro}>
            Used to prefill settle-up links when your crew pays you back. All optional.
          </Text>

          <PrefixField
            label="Venmo username"
            prefix="@"
            value={venmo}
            onChangeText={setVenmo}
            placeholder="your-venmo"
            editable={!submitting}
            accessibilityLabel="Venmo username"
          />
          <PrefixField
            label="Cash App $cashtag"
            prefix="$"
            value={cashapp}
            onChangeText={setCashapp}
            placeholder="yourcashtag"
            editable={!submitting}
            accessibilityLabel="Cash App cashtag"
          />
          <PrefixField
            label="PayPal.me name"
            prefix="paypal.me/"
            value={paypal}
            onChangeText={setPaypal}
            placeholder="yourpaypal"
            editable={!submitting}
            accessibilityLabel="PayPal.me name"
          />

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          {saved ? (
            <View style={styles.savedRow} accessibilityLiveRegion="polite">
              <Ionicons name="checkmark-circle" size={14} color={t.colors.status.verified} style={styles.savedIcon} />
              <Text style={styles.savedText}>Saved</Text>
            </View>
          ) : null}

          <Button
            label="Save Payment Handles"
            onPress={() => void submit()}
            loading={submitting}
            disabled={!dirty}
            accessibilityLabel="Save payment handles"
            style={styles.submit}
          />
        </View>
      ) : null}
    </View>
  );
}

/** A labelled text field with a fixed leading affordance (@, $, paypal.me/). */
function PrefixField({
  label,
  prefix,
  value,
  onChangeText,
  placeholder,
  editable,
  accessibilityLabel,
}: {
  label: string;
  prefix: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  editable: boolean;
  accessibilityLabel: string;
}) {
  const t = useTokens();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrap, focused && styles.inputFocused]}>
        <Text style={styles.prefix}>{prefix}</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.colors.text.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={64}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={accessibilityLabel}
        />
        {value.length > 0 && editable ? (
          <TouchableOpacity
            onPress={() => onChangeText('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            style={styles.clear}
          >
            <Ionicons name="close-circle" size={16} color={t.colors.text.placeholder} />
          </TouchableOpacity>
        ) : null}
      </View>
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
  countPill: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: t.spacing[2],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[12],
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  form: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
    gap: t.spacing[3],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    paddingTop: t.spacing[3],
  },
  formIntro: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  field: {
    gap: t.spacing[1],
  },
  fieldLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.bg.primary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    paddingHorizontal: t.spacing[3],
    minHeight: 48,
  },
  inputFocused: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  prefix: {
    ...typeStyle('body'),
    color: t.colors.text.muted,
    marginRight: t.spacing[1],
  },
  input: {
    ...typeStyle('body'),
    flex: 1,
    color: t.colors.text.primary,
    paddingVertical: t.spacing[3],
  },
  clear: {
    padding: t.spacing[1],
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -t.spacing[1],
  },
  savedIcon: {
    marginRight: 4,
  },
  savedText: {
    ...typeStyle('caption'),
    color: t.colors.status.verified,
  },
  // Submit CTA layout only — fill/ink/disabled live in components/Button (F8).
  submit: {
    marginTop: t.spacing[1],
  },
}));
