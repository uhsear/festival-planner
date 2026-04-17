import React, { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useAuth } from '@festie/shared';
import { useToast } from '../lib/toastContext';

export default function RegisterPage() {
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
    } catch (err) {
      setFormError(error || 'Registration failed');
    }
  };

  return (
    <div className="auth-screen" role="region" aria-label="Authentication">
      <div className="logo-big">FESTIE</div>
      <div className="tagline">Plan your sets. Sync with your crew.</div>

      <div className="auth-tabs">
        <Link to="/login" className="auth-tab">
          Login
        </Link>
        <button className="auth-tab active">Create Account</button>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-error" role="alert" aria-live="assertive">
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
          placeholder="Email (optional, for password reset)"
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
        <label
          className="tos-checkbox"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            margin: '10px 0',
            fontSize: '13px',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            id="authTos"
            checked={tosAccepted}
            onChange={(e) => setTosAccepted(e.target.checked)}
            style={{
              width: '18px',
              height: '18px',
              minWidth: '18px',
              padding: '0',
              marginTop: '2px',
              accentColor: 'var(--accent)',
            }}
          />
          <span>
            I agree to the{' '}
            <a href="/terms.html" target="_blank" style={{ color: 'var(--accent)' }}>
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="/privacy.html" target="_blank" style={{ color: 'var(--accent)' }}>
              Privacy Policy
            </a>
          </span>
        </label>

        <button className="btn btn-primary" type="submit" disabled={isLoading}>
          {isLoading ? 'Creating account...' : 'Create Account'}
        </button>
      </form>
    </div>
  );
}
