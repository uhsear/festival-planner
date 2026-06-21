// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// ── Invite Page Renderers ────────────────────────────────────────────
// Extracted from routes/crews.js — standalone HTML pages for crew invite links.

import { escapeHtml } from './helpers/sanitize.js';

export function renderInviteJoinPage({ crewName, festivalName, inviteCode, origin }: any) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Join Crew - ${crewName}</title>
  <meta name="description" content="Join ${crewName} crew on Festie">
  <meta property="og:title" content="Join Crew - ${crewName}">
  <meta property="og:description" content="Join ${crewName} for ${festivalName}">
  <meta property="og:type" content="website">
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
    .invite-container {
      max-width: 400px;
      width: 100%;
      text-align: center;
    }
    .invite-card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 40px 24px;
    }
    .invite-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .invite-crew-name {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .invite-festival {
      font-size: 14px;
      color: #ff3366;
      font-weight: 600;
      margin-bottom: 24px;
    }
    .invite-description {
      font-size: 14px;
      color: #aaa;
      margin-bottom: 32px;
      line-height: 1.6;
    }
    .invite-button {
      display: inline-block;
      background: #ff3366;
      color: #fff;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 15px;
      transition: background 0.2s;
      border: none;
      cursor: pointer;
    }
    .invite-button:hover {
      background: #e62e5c;
    }
    .invite-footer {
      font-size: 12px;
      color: #666;
      margin-top: 24px;
    }
    .invite-footer a {
      color: #aaa;
      text-decoration: none;
    }
    .invite-footer a:hover {
      color: #ddd;
    }
  </style>
</head>
<body>
  <div class="invite-container">
    <div class="invite-card">
      <div class="invite-icon">\u{1F465}</div>
      <div class="invite-crew-name">${crewName}</div>
      <div class="invite-festival">for ${festivalName}</div>
      <div class="invite-description">You're invited to join this crew. Click below to accept the invite.</div>
      <a href="${origin}?joinCrew=${inviteCode}" class="invite-button">Join Crew</a>
      <div class="invite-footer">
        <p><a href="${origin}">Back to Festie</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function renderInviteErrorPage(origin: any, message: any) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invalid Invite</title>
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
    .invite-container {
      max-width: 400px;
      width: 100%;
      text-align: center;
    }
    .invite-card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 40px 24px;
    }
    .invite-error-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .invite-error-title {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .invite-error-message {
      font-size: 14px;
      color: #aaa;
      margin-bottom: 32px;
      line-height: 1.6;
    }
    .invite-footer {
      font-size: 14px;
    }
    .invite-footer a {
      color: #ff3366;
      text-decoration: none;
      font-weight: 600;
    }
    .invite-footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="invite-container">
    <div class="invite-card">
      <div class="invite-error-icon">❌</div>
      <div class="invite-error-title">Invite link invalid or expired</div>
      <div class="invite-error-message">${escapeHtml(message)}</div>
      <div class="invite-footer">
        <a href="${origin}">Return to Festie</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export { escapeHtml };
