'use strict';

function escapeHtmlResetPage(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderResetFormPage(token, origin) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Password</title>
  <meta name="description" content="Reset your Festie password">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0f;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .reset-container {
      max-width: 400px;
      width: 100%;
    }
    .reset-card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 40px 24px;
    }
    .reset-title {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 8px;
      text-align: center;
    }
    .reset-subtitle {
      font-size: 14px;
      color: #aaa;
      text-align: center;
      margin-bottom: 32px;
    }
    .reset-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .reset-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .reset-label {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #aaa;
    }
    .reset-input {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      padding: 10px 12px;
      color: #e0e0e0;
      font-size: 14px;
      font-family: inherit;
    }
    .reset-input:focus {
      outline: none;
      border-color: #ff3366;
      background: rgba(255, 255, 255, 0.12);
    }
    .reset-button {
      background: #ff3366;
      color: #fff;
      border: none;
      padding: 12px 16px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 15px;
      cursor: pointer;
      transition: background 0.2s;
      margin-top: 8px;
    }
    .reset-button:hover {
      background: #e62e5c;
    }
    .reset-button:disabled {
      background: #555;
      cursor: not-allowed;
      opacity: 0.6;
    }
    .reset-error {
      display: none;
      background: rgba(255, 51, 102, 0.1);
      border: 1px solid rgba(255, 51, 102, 0.3);
      border-radius: 6px;
      padding: 12px;
      color: #ff6b9d;
      font-size: 13px;
      margin-bottom: 16px;
      text-align: center;
    }
    .reset-error.show {
      display: block;
    }
    .reset-footer {
      text-align: center;
      font-size: 12px;
      color: #666;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <div class="reset-container">
    <div class="reset-card">
      <h1 class="reset-title">Reset Password</h1>
      <p class="reset-subtitle">Enter your new password below</p>

      <div class="reset-error" id="error"></div>

      <form class="reset-form" id="resetForm" onsubmit="handleSubmit(event)">
        <div class="reset-field">
          <label class="reset-label" for="password">New Password</label>
          <input
            type="password"
            id="password"
            class="reset-input"
            placeholder="At least 8 characters"
            required
            minlength="8"
            autocomplete="new-password"
          />
        </div>

        <div class="reset-field">
          <label class="reset-label" for="confirmPassword">Confirm Password</label>
          <input
            type="password"
            id="confirmPassword"
            class="reset-input"
            placeholder="Confirm your password"
            required
            minlength="8"
            autocomplete="new-password"
          />
        </div>

        <button type="submit" class="reset-button" id="submitBtn">Reset Password</button>
      </form>

      <div class="reset-footer">
        <p><a href="${escapeHtmlResetPage(origin)}" style="color: #aaa; text-decoration: none;">Back to Festie</a></p>
      </div>
    </div>
  </div>

  <script>
    const token = ${JSON.stringify(token)};
    const origin = ${JSON.stringify(origin)};

    async function handleSubmit(event) {
      event.preventDefault();
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirmPassword').value;
      const submitBtn = document.getElementById('submitBtn');
      const errorDiv = document.getElementById('error');

      if (password !== confirmPassword) {
        errorDiv.textContent = 'Passwords do not match';
        errorDiv.classList.add('show');
        return;
      }

      if (password.length < 8) {
        errorDiv.textContent = 'Password must be at least 8 characters';
        errorDiv.classList.add('show');
        return;
      }

      submitBtn.disabled = true;
      errorDiv.classList.remove('show');

      try {
        const response = await fetch(origin + '/api/v1/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            newPassword: password,
            confirmPassword,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          errorDiv.textContent = data.error || 'Failed to reset password';
          errorDiv.classList.add('show');
          submitBtn.disabled = false;
          return;
        }

        // Success — redirect to login
        window.location.href = origin + '/login';
      } catch (error) {
        errorDiv.textContent = 'Network error: ' + error.message;
        errorDiv.classList.add('show');
        submitBtn.disabled = false;
      }
    }
  </script>
</body>
</html>`;
}

function renderResetErrorPage(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Link Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0f;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .error-container {
      max-width: 400px;
      width: 100%;
      text-align: center;
    }
    .error-card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 40px 24px;
    }
    .error-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .error-title {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .error-message {
      font-size: 14px;
      color: #aaa;
      margin-bottom: 32px;
      line-height: 1.6;
    }
    .error-link {
      display: inline-block;
      background: #ff3366;
      color: #fff;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      transition: background 0.2s;
    }
    .error-link:hover {
      background: #e62e5c;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-card">
      <div class="error-icon">❌</div>
      <h1 class="error-title">Invalid Reset Link</h1>
      <p class="error-message">${escapeHtmlResetPage(message)}</p>
      <a href="/" class="error-link">Return to Festie</a>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { renderResetFormPage, renderResetErrorPage, escapeHtmlResetPage };
