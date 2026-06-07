import React, { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useAuth } from '@festie/shared';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import Button from '../components/ui/Button';
import IconButton from '../components/ui/IconButton';
import AuthTabs from '../components/ui/AuthTabs';
import { Eye, EyeOff } from 'lucide-react';
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
  const [showPw, setShowPw] = useState(false);
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

    try {
      await login({ username, password });
      await navigate({ to: '/cards' });
    } catch {
      setFormError(error || 'Login failed');
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
        <div
          id="authFormError"
          className="text-accent-coral text-[13px] mb-3 min-h-[18px] text-center"
          role="alert"
          aria-live="assertive"
        >
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
            if (e.key === 'Enter') {
              document.getElementById('authPassword')?.focus();
            }
          }}
          disabled={isLoading}
          aria-invalid={Boolean(formError && !username)}
          aria-describedby={formError ? 'authFormError' : undefined}
          className={cn(
            'w-full py-3.5 px-[18px] text-[16px] text-left mb-3 min-h-11',
            'rounded-xl bg-bg-card border border-border text-text-primary',
            'placeholder:text-text-placeholder',
            'transition-[border-color,box-shadow,background] duration-200 ease-[var(--ease-out)]',
            'focus:outline-none focus:border-accent-aqua',
            'focus:shadow-[0_0_0_4px_var(--color-aqua-a1),0_0_24px_var(--color-aqua-a06)]',
          )}
        />

        <label htmlFor="authPassword" className="sr-only">
          Password
        </label>
        <div className="relative mb-3">
          <input
            type={showPw ? 'text' : 'password'}
            id="authPassword"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit(e);
            }}
            disabled={isLoading}
            aria-invalid={Boolean(formError && !password)}
            aria-describedby={formError ? 'authFormError' : undefined}
            className={cn(
              'w-full py-3.5 pl-[18px] pr-11 text-[16px] text-left min-h-11',
              'rounded-xl bg-bg-card border border-border text-text-primary',
              'placeholder:text-text-placeholder',
              'transition-[border-color,box-shadow,background] duration-200 ease-[var(--ease-out)]',
              'focus:outline-none focus:border-accent-aqua',
              'focus:shadow-[0_0_0_4px_var(--color-aqua-a1),0_0_24px_var(--color-aqua-a06)]',
            )}
          />
          <IconButton
            onClick={() => setShowPw((v) => !v)}
            label={showPw ? 'Hide password' : 'Show password'}
            icon={showPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            className="absolute right-0 top-1/2 -translate-y-1/2"
          />
        </div>

        <Button variant="primary" fullWidth type="submit" disabled={isLoading} isLoading={isLoading}>
          {isLoading ? 'Signing in…' : 'Sign in'}
        </Button>

        <div className="mt-3 text-center">
          <Link
            to="/forgot-password"
            className={cn(
              'text-[13px] text-accent-aqua underline underline-offset-2',
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
