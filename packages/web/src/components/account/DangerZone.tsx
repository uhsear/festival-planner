import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { api, getApiBase } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { Download, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DangerZone() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const logout = useAuthStore((s) => s.logout);

  const [exporting, setExporting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await fetch(`${getApiBase()}/account/export`, {
        method: 'GET',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `festie-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Export downloaded', 'success');
    } catch {
      toast("Couldn't export data. Try again.", 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletePassword) return;

    setDeleting(true);
    try {
      await api.delete<void>('/account/', {
        body: { password: deletePassword },
      });
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
    <>
      {/* GDPR export section */}
      <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
        <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
          <Download className="w-4 h-4" aria-hidden="true" />
          Export Data
        </h2>

        <p className="text-sm text-text-muted">
          Download all your data in JSON format.
        </p>

        <Button
          variant="outline"
          fullWidth
          isLoading={exporting}
          onClick={handleExport}
          className="min-h-[44px]"
        >
          Download My Data
        </Button>
      </section>

      {/* Delete account section */}
      <section
        className={cn(
          'p-4 rounded-lg border space-y-3',
          'bg-accent-coral/5 border-accent-coral/30',
        )}
      >
        <h2 className="text-sm font-semibold text-accent-coral flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          Delete Account
        </h2>

        <p className="text-sm text-text-muted">
          This will permanently delete your account and all associated data. This action cannot be undone.
        </p>

        {!showDeleteConfirm ? (
          <Button
            variant="danger"
            fullWidth
            onClick={() => setShowDeleteConfirm(true)}
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
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeletePassword('');
                }}
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
    </>
  );
}
