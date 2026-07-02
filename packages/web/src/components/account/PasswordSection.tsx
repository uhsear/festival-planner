import React, { useState } from 'react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { Lock } from 'lucide-react';

export default function PasswordSection() {
  const { toast } = useToast();
  const changePassword = useAuthStore((s) => s.changePassword);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const passwordsMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) return;
    if (newPassword.length < 8) {
      toast('New password must be at least 8 characters', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast('Passwords do not match', 'warning');
      return;
    }

    setSavingPassword(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast('Password changed', 'success');
    } catch {
      toast("Couldn't change password. Try again.", 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
        <Lock className="w-4 h-4" aria-hidden="true" />
        Change Password
      </h3>

      <form onSubmit={handlePasswordChange} className="space-y-3">
        <Input
          label="Current password"
          type="password"
          isPassword
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Current password"
          autoComplete="current-password"
        />
        <Input
          label="New password"
          type="password"
          isPassword
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password (min. 8 characters)"
          autoComplete="new-password"
          aria-describedby="pw-hint"
        />
        {newPassword.length > 0 && newPassword.length < 8 && (
          <p id="pw-hint" className="text-xs text-accent-coral">
            {8 - newPassword.length} more character{8 - newPassword.length === 1 ? '' : 's'} needed
          </p>
        )}
        <Input
          label="Confirm new password"
          type="password"
          isPassword
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
          error={passwordsMismatch ? 'Passwords do not match' : undefined}
        />
        <Button
          type="submit"
          variant="primary"
          fullWidth
          isLoading={savingPassword}
          disabled={
            !currentPassword ||
            !newPassword ||
            !confirmPassword ||
            newPassword.length < 8 ||
            newPassword !== confirmPassword
          }
          className="min-h-[44px]"
        >
          Update Password
        </Button>
      </form>
    </section>
  );
}
