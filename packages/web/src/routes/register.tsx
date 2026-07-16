import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '@festie/shared';
import { isValidEmail } from '@festie/shared/utils';
import { useToast } from '../lib/toastContext';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import AuthTabs from '../components/ui/AuthTabs';
import { cn } from '../lib/utils';

export default function RegisterPage() {
  return (
    <RenderErrorBoundary name="register">
      <RegisterPageInner />
    </RenderErrorBoundary>
  );
}

function RegisterPageInner() {
  const navigate = useNavigate();
  const { register, isLoading, error } = useAuth();
  const { toast } = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  const [usernameErr, setUsernameErr] = useState('');
  const [passwordErr, setPasswordErr] = useState('');
  const [confirmErr, setConfirmErr] = useState('');
  const [emailErr, setEmailErr] = useState('');
  const [dobErr, setDobErr] = useState('');
  const [formError, setFormError] = useState('');

  // isValidEmail is the shared UX-level check (@festie/shared/utils); the backend
  // Zod schema remains the authoritative validation boundary.
  // UX-only check; the backend Zod schema is the authoritative 18+ gate.
  const isAtLeast18 = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return false;
    const t = new Date(Date.UTC(d.getUTCFullYear() + 18, d.getUTCMonth(), d.getUTCDate()));
    return t.getTime() <= Date.now();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setUsernameErr('');
    setPasswordErr('');
    setConfirmErr('');
    setEmailErr('');
    setDobErr('');

    if (!username) {
      setUsernameErr('Username is required');
      return;
    }
    if (!password) {
      setPasswordErr('Password is required');
      return;
    }
    if (password.length < 8) {
      setPasswordErr('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setConfirmErr('Passwords do not match');
      return;
    }
    if (email && !isValidEmail(email)) {
      setEmailErr('Please enter a valid email address');
      return;
    }
    if (!tosAccepted) {
      setFormError('You must accept the Terms of Service');
      return;
    }
    if (!dateOfBirth) {
      setDobErr('Date of birth is required');
      return;
    }
    if (!isAtLeast18(dateOfBirth)) {
      setDobErr('You must be at least 18 to use Festie');
      return;
    }

    try {
      await register({
        username,
        password,
        confirmPassword,
        dateOfBirth,
        tosAccepted,
        email: email || undefined,
      });
      toast('Account created', 'success');
      await navigate({ to: '/cards' });
    } catch {
      setFormError(error || "Couldn't create your account. Try again.");
    }
  };

  return (
    <>
      <h1
        className={cn(
          'font-display text-[clamp(22px,5vw,36px)] font-bold tracking-[6px] uppercase',
          'text-accent-aqua mb-3 relative z-[1]',
          '[text-shadow:0_0_40px_rgba(0,232,208,0.3)]',
        )}
      >
        FESTIE
      </h1>
      <p className="text-text-secondary text-[15px] mb-11 tracking-[0.5px] relative z-[1]">
        Plan your sets. Sync with your crew.
      </p>

      <AuthTabs active="register" variant="split" />

      <form
        className="w-full max-w-[360px] relative z-[1]"
        onSubmit={handleSubmit}
        noValidate
        {...(isLoading ? { 'aria-busy': true } : {})}
      >
        {formError && (
          <div
            className="text-[var(--color-text-danger)] text-[length:var(--font-size-13)] mb-3 text-center"
            role="alert"
            aria-live="assertive"
          >
            {formError}
          </div>
        )}

        <div className="mb-3">
          <Input
            aria-label="Username"
            placeholder="Username"
            autoComplete="username"
            maxLength={30}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isLoading}
            error={usernameErr}
          />
        </div>

        <div className="mb-3">
          <Input
            aria-label="Password"
            placeholder="Password"
            isPassword
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            error={passwordErr}
            helperText="At least 8 characters"
          />
        </div>

        <div className="mb-3">
          <Input
            aria-label="Confirm password"
            placeholder="Confirm Password"
            isPassword
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={isLoading}
            error={confirmErr}
          />
        </div>

        <div className="mb-3">
          <Input
            aria-label="Date of birth"
            type="date"
            helperText="You must be 18 or older"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            disabled={isLoading}
            error={dobErr}
          />
        </div>

        <div className="mb-3">
          <Input
            aria-label="Email (optional)"
            type="email"
            placeholder="Email (optional)"
            helperText="For password recovery"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            error={emailErr}
          />
        </div>

        {/* TOS checkbox */}
        <label className="my-2.5 flex min-h-11 cursor-pointer items-start gap-2 text-[length:var(--font-size-13)] text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            id="authTos"
            checked={tosAccepted}
            onChange={(e) => setTosAccepted(e.target.checked)}
            disabled={isLoading}
            className="auth-tos-checkbox mt-0.5 h-[22px] w-[22px] min-w-[22px] p-0"
          />
          <span>
            I agree to the{' '}
            <a
              href="/terms.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-aqua underline underline-offset-2 hover:text-[var(--color-accent-aqua-hover)] rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a
              href="/privacy.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-aqua underline underline-offset-2 hover:text-[var(--color-accent-aqua-hover)] rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
            >
              Privacy Policy
            </a>
          </span>
        </label>

        <Button variant="primary" fullWidth type="submit" disabled={isLoading} isLoading={isLoading}>
          {isLoading ? 'Creating account…' : 'Create Account'}
        </Button>
      </form>
    </>
  );
}
