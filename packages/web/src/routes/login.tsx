import React, { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useAuth } from '@festie/shared';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import AuthTabs from '../components/ui/AuthTabs';
import { cn } from '../lib/utils';

export default function LoginPage() {
  return (
    <RenderErrorBoundary name="login">
      <LoginPageInner />
    </RenderErrorBoundary>
  );
}

function LoginPageInner() {
  const navigate = useNavigate();
  const { login, isLoading, error } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usernameErr, setUsernameErr] = useState('');
  const [passwordErr, setPasswordErr] = useState('');
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setUsernameErr('');
    setPasswordErr('');

    if (!username) {
      setUsernameErr('Username is required');
      return;
    }
    if (!password) {
      setPasswordErr('Password is required');
      return;
    }

    try {
      await login({ username, password });
      await navigate({ to: '/cards' });
    } catch {
      setFormError(error || 'Sign-in failed. Check your username and password and try again.');
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

      <AuthTabs active="login" variant="pill" />

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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            error={passwordErr}
          />
        </div>

        <Button variant="primary" fullWidth type="submit" disabled={isLoading} isLoading={isLoading}>
          {isLoading ? 'Signing in…' : 'Sign in'}
        </Button>

        <div className="mt-3 text-center">
          <Link
            to="/forgot-password"
            className={cn(
              'text-[length:var(--font-size-13)] text-accent-aqua underline underline-offset-2',
              'hover:text-[var(--color-accent-aqua-hover)]',
              'inline-flex items-center min-h-11 px-0 py-2.5',
              'rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
            )}
          >
            Forgot password?
          </Link>
        </div>
      </form>
    </>
  );
}
