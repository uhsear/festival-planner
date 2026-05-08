import React, { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useAuth } from '@festie/shared';
import { useToast } from '../lib/toastContext';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';

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
  const { toast } = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
      toast('Login successful', 'success');
      await navigate({ to: '/cards' });
    } catch {
      setFormError(error || 'Login failed');
    }
  };

  return (
    <main className="auth-screen" aria-label="Authentication">
      <h1 className="logo-big">FESTIE</h1>
      <p className="tagline">Plan your sets. Sync with your crew.</p>

      <div className="auth-tabs" role="tablist" aria-label="Authentication method">
        <button className="auth-tab active" role="tab" aria-selected={true} tabIndex={0} type="button">Login</button>
        <Link to="/register" className="auth-tab" role="tab" aria-selected={false} tabIndex={-1}>
          Create Account
        </Link>
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate {...(isLoading ? { 'aria-busy': true } : {})}>
        <div
          id="authFormError"
          className="auth-error"
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
          className="min-h-11"
        />

        <label htmlFor="authPassword" className="sr-only">
          Password
        </label>
        <input
          type="password"
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
          className="min-h-11"
        />

        <button
          className="btn btn-primary min-h-11"
          type="submit"
          disabled={isLoading}
          {...(isLoading ? { 'aria-busy': true } : {})}
        >
          {isLoading ? 'Logging in...' : 'Login'}
        </button>

        <div className="mt-3 text-center">
          <Link
            to="/forgot-password"
            className="text-[13px] text-[var(--accent)] no-underline"
          >
            Forgot password?
          </Link>
        </div>
      </form>
    </main>
  );
}
