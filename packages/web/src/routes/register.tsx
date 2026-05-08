import React, { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useAuth } from '@festie/shared';
import { useToast } from '../lib/toastContext';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';

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
    <main className="auth-screen" aria-label="Authentication">
      <h1 className="logo-big">FESTIE</h1>
      <p className="tagline">Plan your sets. Sync with your crew.</p>

      <div className="auth-tabs" role="tablist" aria-label="Authentication method">
        <Link to="/login" className="auth-tab" role="tab" aria-selected={false} tabIndex={-1}>
          Login
        </Link>
        <button className="auth-tab active" role="tab" aria-selected={true} tabIndex={0} type="button">Create Account</button>
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate {...(isLoading ? { 'aria-busy': true } : {})}>
        <div id="authFormError" className="auth-error" role="alert" aria-live="assertive">
          {formError || '\u00A0'}
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
        />

        <label htmlFor="authEmail" className="sr-only">
          Email (optional)
        </label>
        <input
          type="email"
          id="authEmail"
          placeholder="Email — for password reset"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit(e);
          }}
          disabled={isLoading}
        />

        {/* TOS checkbox — matches legacy styling */}
        <label className="tos-checkbox my-2.5 flex min-h-11 cursor-pointer items-start gap-2 text-[13px] text-[var(--text-secondary)]">
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

        <button className="btn btn-primary min-h-11" type="submit" disabled={isLoading} {...(isLoading ? { 'aria-busy': true } : {})}>
          {isLoading ? 'Creating account...' : 'Create Account'}
        </button>
      </form>
    </main>
  );
}
