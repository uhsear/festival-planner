import React, { useState } from 'react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { api } from '@festie/shared/services/api';
import type { User } from '@festie/shared/types';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { Wallet } from 'lucide-react';

/**
 * Account settings for payment handles (Venmo / Cash App / PayPal). These power
 * the prefilled settle-up deep links in the crew expenses tab. All optional;
 * clearing a field removes it. A leading @/$ is normalized server-side.
 */
export default function PaymentHandlesSection() {
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [venmo, setVenmo] = useState(user?.venmoHandle ?? '');
  const [cashapp, setCashapp] = useState(user?.cashappCashtag ?? '');
  const [paypal, setPaypal] = useState(user?.paypalHandle ?? '');
  const [saving, setSaving] = useState(false);

  const current = {
    venmo: user?.venmoHandle ?? '',
    cashapp: user?.cashappCashtag ?? '',
    paypal: user?.paypalHandle ?? '',
  };
  const dirty =
    venmo.trim() !== current.venmo || cashapp.trim() !== current.cashapp || paypal.trim() !== current.paypal;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
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
      // Reflect normalized (stripped) values back into the inputs.
      setVenmo(res.user?.venmoHandle ?? '');
      setCashapp(res.user?.cashappCashtag ?? '');
      setPaypal(res.user?.paypalHandle ?? '');
      toast('Payment handles updated', 'success');
    } catch {
      toast("Couldn't update payment handles. Try again.", 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
      <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
        <Wallet className="w-4 h-4" aria-hidden="true" />
        Payment handles
      </h2>
      <p className="text-xs text-text-muted">
        Crewmates use these to pay you back when settling shared expenses. Leave blank to hide.
      </p>

      <form onSubmit={handleSave} className="space-y-3">
        <Input
          label="Venmo username"
          value={venmo}
          onChange={(e) => setVenmo(e.target.value)}
          placeholder="your-venmo"
          maxLength={64}
          autoComplete="off"
        />
        <Input
          label="Cash App $cashtag"
          value={cashapp}
          onChange={(e) => setCashapp(e.target.value)}
          placeholder="yourcashtag"
          maxLength={64}
          autoComplete="off"
        />
        <Input
          label="PayPal.me name"
          value={paypal}
          onChange={(e) => setPaypal(e.target.value)}
          placeholder="yourpaypal"
          maxLength={64}
          autoComplete="off"
        />
        <Button type="submit" variant="primary" size="md" isLoading={saving} disabled={!dirty} className="min-h-[44px]">
          Save
        </Button>
      </form>
    </section>
  );
}
