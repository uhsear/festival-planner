import React, { useState } from 'react';
import UserMenuPanel from './UserMenuPanel';

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
      <section className="user-menu-section">
        <div className="user-menu-section-title">Change Password</div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="account-setting-row flex-col items-stretch gap-1.5">
            <label className="account-setting-key" htmlFor="cp-current">
              Current password
            </label>
            <input
              id="cp-current"
              type="password"
              autoComplete="current-password"
              className="input-base"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="account-setting-row flex-col items-stretch gap-1.5">
            <label className="account-setting-key" htmlFor="cp-new">
              New password
            </label>
            <input
              id="cp-new"
              type="password"
              autoComplete="new-password"
              className="input-base"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="account-setting-row flex-col items-stretch gap-1.5">
            <label className="account-setting-key" htmlFor="cp-confirm">
              Confirm new password
            </label>
            <input
              id="cp-confirm"
              type="password"
              autoComplete="new-password"
              className="input-base"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          {error && (
            <div role="alert" className="account-setting-value text-[var(--color-accent-coral)]">
              {error}
            </div>
          )}
          <div className="user-menu-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={busy || !currentPassword || !newPassword || !confirmPassword}
            >
              {busy ? 'Saving...' : 'Update Password'}
            </button>
          </div>
        </form>
      </section>
    </UserMenuPanel>
  );
}
