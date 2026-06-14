import React, { useState } from 'react';
import UserMenuPanel from './UserMenuPanel';
import { inputBase } from '../../lib/styles';
import Button from '../ui/Button';

interface ChangePasswordModalProps {
  onClose: () => void;
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>;
}

export default function ChangePasswordModal({ onClose, onSubmit }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(currentPassword, newPassword);
    } finally {
      setBusy(false);
    }
  };

  return (
    <UserMenuPanel ariaLabel="Change password" onClose={onClose}>
      <section className="pt-3 mt-3 border-t border-border first-of-type:pt-0 first-of-type:mt-0 first-of-type:border-t-0">
        <div className="text-[11px] font-bold tracking-[1.2px] uppercase text-text-secondary mb-1.5">
          Change Password
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex flex-col items-stretch gap-1.5 py-2.5">
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-[.8px]" htmlFor="cp-current">
              Current password
            </label>
            <input
              id="cp-current"
              type="password"
              autoComplete="current-password"
              className={inputBase}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col items-stretch gap-1.5 py-2.5">
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-[.8px]" htmlFor="cp-new">
              New password
            </label>
            <input
              id="cp-new"
              type="password"
              autoComplete="new-password"
              className={inputBase}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="flex flex-col items-stretch gap-1.5 py-2.5">
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-[.8px]" htmlFor="cp-confirm">
              Confirm new password
            </label>
            <input
              id="cp-confirm"
              type="password"
              autoComplete="new-password"
              className={inputBase}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          {error && (
            <div
              role="alert"
              className="text-[13px] text-[var(--color-text-danger)] overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-[var(--space-3)]"
            >
              {error}
            </div>
          )}
          <div className="flex flex-col gap-[var(--space-3)]">
            <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={busy || !currentPassword || !newPassword || !confirmPassword}
            >
              {busy ? 'Saving…' : 'Update Password'}
            </Button>
          </div>
        </form>
      </section>
    </UserMenuPanel>
  );
}
