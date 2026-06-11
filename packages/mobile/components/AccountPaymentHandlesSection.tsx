import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@festie/shared/stores';
import { api } from '@festie/shared/services';
import type { User } from '@festie/shared/types';
import Button from './Button';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/**
 * Payment-handle editor for the Account screen. Sets Venmo / Cash App / PayPal
 * handles used to build prefilled settle-up deep links in the crew expenses
 * tab. All optional; clearing a field removes it. A leading @/$ is normalized
 * server-side. PUT /account/payment-handles → { user } (serializePublicUser).
 */
export default function AccountPaymentHandlesSection() {
  const t = useTokens();
  const styles = useStyles();
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

  const dirty =
    venmo.trim() !== current.venmo || cashapp.trim() !== current.cashapp || paypal.trim() !== current.paypal;

  const summary =
    [current.venmo && 'Venmo', current.cashapp && 'Cash App', current.paypal && 'PayPal'].filter(Boolean).join(' · ') ||
    'Add a way to get paid back';

  const reset = () => {
    setVenmo(current.venmo);
    setCashapp(current.cashapp);
    setPaypal(current.paypal);
    setError(null);
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
      setOpen(false);
      Alert.alert('Payment handles updated', 'Your payment handles have been saved.');
    } catch (err) {
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
        <Ionicons name={open ? 'chevron-up' : 'chevron-forward'} size={18} color={t.colors.text.placeholder} />
      </TouchableOpacity>

      {open ? (
        <View style={styles.form}>
          <Text style={styles.fieldLabel}>Venmo username</Text>
          <TextInput
            style={styles.input}
            value={venmo}
            onChangeText={setVenmo}
            placeholder="your-venmo"
            placeholderTextColor={t.colors.text.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={64}
            editable={!submitting}
            accessibilityLabel="Venmo username"
          />

          <Text style={styles.fieldLabel}>Cash App $cashtag</Text>
          <TextInput
            style={styles.input}
            value={cashapp}
            onChangeText={setCashapp}
            placeholder="yourcashtag"
            placeholderTextColor={t.colors.text.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={64}
            editable={!submitting}
            accessibilityLabel="Cash App cashtag"
          />

          <Text style={styles.fieldLabel}>PayPal.me name</Text>
          <TextInput
            style={styles.input}
            value={paypal}
            onChangeText={setPaypal}
            placeholder="yourpaypal"
            placeholderTextColor={t.colors.text.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={64}
            editable={!submitting}
            accessibilityLabel="PayPal.me name"
          />

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Button
            label="Save Payment Handles"
            onPress={() => void submit()}
            loading={submitting}
            accessibilityLabel="Save payment handles"
            style={styles.submit}
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
    gap: t.spacing[2],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    paddingTop: t.spacing[3],
  },
  fieldLabel: {
    ...typeStyle('caption'),
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
    paddingVertical: t.spacing[3],
    minHeight: 48,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
  // Submit CTA layout only — fill/ink/disabled live in components/Button (F8).
  submit: {
    marginTop: t.spacing[1],
  },
}));
