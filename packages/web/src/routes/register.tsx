import React, { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useAuth } from '@festie/shared';
import { useToast } from '../lib/toastContext';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import Button from '../components/ui/Button';
import { cn } from '../lib/utils';

export default function RegisterPage() {
  return (
    <RenderErrorBoundary name="register">
      <RegisterPageInner />
    </RenderErrorBoundary>
  );
}

const authInputClasses = cn(
  'w-full py-3.5 px-[18px] text-base text-left mb-3 rounded-DEFAULT',
  'bg-[var(--color-bg-card)] backdrop-blur-[12px] min-h-11',
  'transition-[border-color,box-shadow,background] duration-200 ease-[var(--ease-out)]',
  'focus:shadow-[0_0_0_4px_var(--color-aqua-a1),0_0_24px_var(--color-aqua-a06)]',
);

function RegisterPageInner() {
  const navigate = useNavigate();
  const { register, isLoading, error } = useAuth();
  const { toast } = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!username) {
      setFormError('Username is required');
      return;
    }
    if (!password) {
      setFormError('Password is required');
      return;
    }
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }
    if (!tosAccepted) {
      setFormError('You must accept the Terms of Service');
      return;
    }

    try {
      await register({
        username,
        password,
        confirmPassword,
        tosAccepted,
        email: email || undefined,
      });
      toast('Account created successfully', 'success');
      await navigate({ to: '/cards' });
    } catch {
      setFormError(error || 'Registration failed');
    }
  };

  return (
    <>
      <h1
        className={cn(
          'font-display text-[clamp(22px,5vw,36px)] font-bold tracking-[6px] uppercase',
          'text-accent-coral mb-3 relative z-[1]',
          '[text-shadow:0_0_40px_rgba(var(--accent-coral-rgb),0.3)]',
        )}
      >
        FESTIE
      </h1>
      <p className="text-text-secondary text-[15px] mb-11 tracking-[0.5px] relative z-[1]">
        Plan your sets. Sync with your crew.
      </p>

      <div
        className={cn(
          'flex mb-6 border border-border-light rounded-DEFAULT overflow-hidden',
          'w-full max-w-[360px] relative z-[1]',
        )}
        role="tablist"
        aria-label="Authentication method"
      >
        <Link
          to="/login"
          className={cn(
            'flex-1 py-[var(--space-6)] text-sm font-semibold text-center min-h-11 cursor-pointer',
            'bg-[var(--color-bg-card)] text-text-secondary',
            'transition-[background,color] duration-200 ease-[var(--ease-out)]',
            'inline-flex items-center justify-center',
          )}
          role="tab"
          aria-selected={false}
          tabIndex={-1}
        >
          Login
        </Link>
        <button
          className={cn(
            'flex-1 py-[var(--space-6)] text-sm font-bold text-center min-h-11 cursor-pointer',
            'bg-accent-aqua text-[var(--text-on-light-accent)]',
            'transition-[background,color] duration-200 ease-[var(--ease-out)]',
          )}
          role="tab"
          aria-selected={true}
          tabIndex={0}
          type="button"
        >
          Create Account
        </button>
      </div>

      <form
        className="w-full max-w-[360px] relative z-[1]"
        onSubmit={handleSubmit}
        noValidate
        {...(isLoading ? { 'aria-busy': true } : {})}
      >
        <div
          id="authFormError"
          className="text-accent-coral text-[13px] mb-3 min-h-[18px] text-center"
          role="alert"
          aria-live="assertive"
        >
          {formError || ' '}
        </div>

        <label htmlFor="authUsername" className="sr-only">
          Username
        </label>
        <input
          type="text"
          id="authUsername"
          placeholder="Username"
          autoComplete="username"
          maxLength={30}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') document.getElementById('authPassword')?.focus();
          }}
          disabled={isLoading}
          aria-invalid={Boolean(formError && !username)}
          aria-describedby={formError ? 'authFormError' : undefined}
          className={authInputClasses}
        />

        <label htmlFor="authPassword" className="sr-only">
          Password
        </label>
        <input
          type="password"
          id="authPassword"
          placeholder="Password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') document.getElementById('authPassword2')?.focus();
          }}
          disabled={isLoading}
          aria-invalid={Boolean(formError && !password)}
          aria-describedby={formError ? 'authFormError' : undefined}
          className={authInputClasses}
        />

        <label htmlFor="authPassword2" className="sr-only">
          Confirm Password
        </label>
        <input
          type="password"
          id="authPassword2"
          placeholder="Confirm Password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') document.getElementById('authEmail')?.focus();
          }}
          disabled={isLoading}
          className={authInputClasses}
        />

        <label htmlFor="authEmail" className="sr-only">
          Email (optional)
        </label>
        <input
          type="email"
          id="authEmail"
          placeholder="Email &#x2014; for password reset"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit(e);
          }}
          disabled={isLoading}
          className={authInputClasses}
        />

        {/* TOS checkbox */}
        <label className="my-2.5 flex min-h-11 cursor-pointer items-start gap-2 text-[13px] text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            id="authTos"
            checked={tosAccepted}
            onChange={(e) => setTosAccepted(e.target.checked)}
            className="mt-0.5 h-[22px] w-[22px] min-w-[22px] p-0 accent-[var(--accent)]"
          />
          <span>
            I agree to the{' '}
            <a href="/terms.html" target="_blank" className="text-[var(--accent)]">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="/privacy.html" target="_blank" className="text-[var(--accent)]">
              Privacy Policy
            </a>
          </span>
        </label>

        <Button
          variant="primary"
          fullWidth
          type="submit"
          disabled={isLoading}
          isLoading={isLoading}
        >
          {isLoading ? 'Creating account...' : 'Create Account'}
        </Button>
      </form>
    </>
  );
}
