import React, { useState } from 'react';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import UserMenuPanel from './UserMenuPanel';
import { inputBase } from '../../lib/styles';
import Button from '../ui/Button';

interface ChangeEmailModalProps {
  /** Address currently on file. Absent means the account has no email yet, which switches the copy from "change" to "add". */
  currentEmail?: string;
  onClose: () => void;
  onSubmit: (email: string, password: string) => Promise<void>;
}

export default function ChangeEmailModal({ currentEmail, onClose, onSubmit }: ChangeEmailModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit(email.trim(), password);
    } catch (err) {
      setError(mapErrorToUserMessage(err, "Couldn't request the email change."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <UserMenuPanel ariaLabel="Change email" onClose={onClose}>
      <section className="pt-3 mt-3 border-t border-border first-of-type:pt-0 first-of-type:mt-0 first-of-type:border-t-0">
        <div className="text-[11px] font-bold tracking-[1.2px] uppercase text-text-secondary mb-1.5">
          {currentEmail ? 'Change Email' : 'Add Email'}
        </div>
        <p className="text-[length:var(--font-size-13)] text-text-secondary mb-1.5">
          We send a verification link to the new address, and tell{' '}
          {currentEmail ? 'your current address' : 'the address on file'} that a change was requested. Your login email
          stays the same until you open that link.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex flex-col items-stretch gap-1.5 py-2.5">
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-[.8px]" htmlFor="ce-email">
              New email
            </label>
            <input
              id="ce-email"
              type="email"
              autoComplete="email"
              className={inputBase}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              required
            />
          </div>
          <div className="flex flex-col items-stretch gap-1.5 py-2.5">
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-[.8px]" htmlFor="ce-password">
              Current password
            </label>
            <input
              id="ce-password"
              type="password"
              autoComplete="current-password"
              className={inputBase}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <div
              role="alert"
              className="text-[length:var(--font-size-13)] text-[var(--color-text-danger)] overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-[var(--space-3)]"
            >
              {error}
            </div>
          )}
          <div className="flex flex-col gap-[var(--space-3)]">
            <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={busy || !email || !password}>
              {busy ? 'Sending…' : 'Send Verification Link'}
            </Button>
          </div>
        </form>
      </section>
    </UserMenuPanel>
  );
}
