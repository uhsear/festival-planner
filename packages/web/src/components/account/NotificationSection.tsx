import React, { useState } from 'react';
import { useToast } from '../../lib/toastContext';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import Button from '../ui/Button';
import { Bell, BellOff } from 'lucide-react';

export default function NotificationSection() {
  const { toast } = useToast();
  const push = usePushNotifications();
  const [pushBusy, setPushBusy] = useState(false);

  const handleEnablePush = async () => {
    if (!push.isSupported) {
      if (push.unsupportedReason === 'ios-needs-install') {
        toast('Add Festie to your Home Screen first. iOS needs the installed PWA to allow notifications.', 'info');
      } else {
        toast('Push notifications not supported on this browser', 'error');
      }
      return;
    }
    setPushBusy(true);
    try {
      const res = await push.requestPermission();
      if (res === 'granted') {
        await push.registerToken();
        toast('Push notifications enabled', 'success');
      } else if (res === 'denied') {
        toast('Permission denied. Enable in browser settings to turn on.', 'error');
      } else {
        toast('Permission prompt dismissed.', 'info');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not enable notifications. Try again.', 'error');
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    try {
      await push.unregisterToken();
      toast('Push notifications disabled', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not disable notifications. Try again.', 'error');
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
        {push.permission === 'granted' ? (
          <Bell className="w-4 h-4" aria-hidden="true" />
        ) : (
          <BellOff className="w-4 h-4" aria-hidden="true" />
        )}
        Push Notifications
      </h3>
      {!push.isSupported ? (
        push.unsupportedReason === 'ios-needs-install' ? (
          <p className="text-sm text-text-muted">
            On iOS, notifications work only when Festie is installed to your Home Screen. Tap the{' '}
            <span aria-hidden="true">Share</span> button in Safari and choose <strong>Add to Home Screen</strong>, then
            open Festie from the new icon to enable notifications.
          </p>
        ) : (
          <p className="text-sm text-text-muted">
            Not supported on this browser. Try Chrome, Edge, or Safari 16+ (iOS requires Add-to-Home-Screen install).
          </p>
        )
      ) : push.permission === 'granted' ? (
        <>
          <p className="text-sm text-text-muted">
            You'll get notified when your crew picks sets, sends polls, or updates the meeting point.
          </p>
          <Button variant="outline" fullWidth isLoading={pushBusy} onClick={handleDisablePush} className="min-h-[44px]">
            Disable Notifications
          </Button>
        </>
      ) : push.permission === 'denied' ? (
        <p className="text-sm text-text-muted">
          Permission blocked. Re-enable in your browser's site settings (lock icon in the address bar) and reload.
        </p>
      ) : (
        <>
          <p className="text-sm text-text-muted">
            Get notified when your crew picks sets, sends polls, or updates the meeting point.
          </p>
          <Button variant="primary" fullWidth isLoading={pushBusy} onClick={handleEnablePush} className="min-h-[44px]">
            Enable Notifications
          </Button>
        </>
      )}
    </section>
  );
}
