import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function AccountDangerZone() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const logout = useAuthStore((s) => s.logout);

  const [deletePassword, setDeletePassword] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deletePassword) return;
    setDeleting(true);
    try {
      await api.delete<void>('/account/', { body: { password: deletePassword } });
      await logout();
      toast('Account deleted', 'info');
      navigate({ to: '/login' });
    } catch {
      toast("Couldn't delete account. Try again.", 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section
      className={cn(
        'p-4 rounded-lg border space-y-4',
        'bg-accent-coral/5 border-accent-coral/30',
      )}
    >
      <h2 className="text-sm font-semibold text-accent-coral flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        Delete Account
      </h2>

      <p className="text-sm text-text-muted">
        This will permanently delete your account and all associated data. This action cannot be undone.
      </p>

      {!showConfirm ? (
        <Button
          variant="danger"
          fullWidth
          onClick={() => setShowConfirm(true)}
          className="min-h-[44px]"
        >
          Delete My Account
        </Button>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (deletePassword && !deleting) handleDelete();
          }}
        >
          <Input
            label="Enter your password to confirm"
            type="password"
            isPassword
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setShowConfirm(false); setDeletePassword(''); }}
              className="flex-1 min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              isLoading={deleting}
              disabled={!deletePassword}
              className="flex-1 min-h-[44px]"
            >
              Confirm Delete
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
