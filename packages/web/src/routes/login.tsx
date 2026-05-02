import React, { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useAuth } from '@festie/shared';
import { useToast } from '../lib/toastContext';

export default function LoginPage() {
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

      <div className="auth-tabs">
        <button className="auth-tab active">Login</button>
        <Link to="/register" className="auth-tab">
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
        />

        <button
          className="btn btn-primary"
          type="submit"
          disabled={isLoading}
          {...(isLoading ? { 'aria-busy': true } : {})}
        >
          {isLoading ? 'Logging in...' : 'Login'}
        </button>

        <div style={{ textAlign: 'center', marginTop: '12px' }}>
          <Link
            to="/forgot-password"
            style={{ color: 'var(--accent)', fontSize: '13px', textDecoration: 'none' }}
          >
            Forgot password?
          </Link>
        </div>
      </form>
    </main>
  );
}
