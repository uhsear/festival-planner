'use strict';
/**
 * Static page routes — join redirect, password reset forms, static pages, SPA catch-all
 */
const crypto = require('crypto');
const path = require('path');

const { renderResetFormPage, renderResetErrorPage } = require('../lib/reset-pages');

module.exports = function createPageRoutes(deps) {
  const {
    express, config, rateLimit, pool, state, log,
    _sendError, _ErrorCodes,
  } = deps;

  const router = express.Router();

  // Crew invite deep link — /join/:code redirects to app with invite code
  router.get('/join/:code', (req, res) => {
    const code = (req.params.code || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
    if (!code) return res.redirect('/');
    res.redirect(`/?joinCrew=${encodeURIComponent(code)}`);
  });

  // GET /reset/:token — Password reset form page (admin-initiated)
  router.get('/reset/:token', rateLimit(config.AUTH_RATE_LIMIT_MAX, 'reset-form'), async (req, res) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    const setResetHeaders = (includeScript) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      const scriptSrc = includeScript ? ` script-src 'nonce-${nonce}';` : '';
      res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}';${scriptSrc} connect-src 'self'; frame-ancestors 'none'`);
    };
    try {
      const token = String(req.params.token || '').trim();
      if (!token || !/^[a-f0-9]{64}$/.test(token)) {
        setResetHeaders(false);
        return res.send(renderResetErrorPage('Invalid or expired reset link', nonce));
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      let tokenValid = false;

      if (state._adminResetTokens?.has(tokenHash)) {
        const tokenData = state._adminResetTokens.get(tokenHash);
        if (Date.now() <= tokenData.expiresAt) {
          tokenValid = true;
        } else {
          state._adminResetTokens.delete(tokenHash);
        }
      }

      if (!tokenValid) {
        const dbResult = await pool.query(
          `SELECT user_id AS "userId", expires_at AS "expiresAt"
           FROM password_reset_tokens
           WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
          [tokenHash]
        );
        if (dbResult.rows.length > 0) {
          const row = dbResult.rows[0];
          tokenValid = true;
          state._adminResetTokens.set(tokenHash, { userId: row.userId, expiresAt: new Date(row.expiresAt).getTime() });
        }
      }

      if (!tokenValid) {
        setResetHeaders(false);
        return res.send(renderResetErrorPage('Invalid or expired reset link', nonce));
      }

      setResetHeaders(true);
      return res.send(renderResetFormPage(token, config.PUBLIC_ORIGIN, nonce));
    } catch (error) {
      log.error('reset page error', { error: error.message });
      const errorNonce = crypto.randomBytes(16).toString('base64');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${errorNonce}'; frame-ancestors 'none'`);
      return res.send(renderResetErrorPage('Failed to load reset page', errorNonce));
    }
  });

  // GET /reset-password — Self-service password reset form (from forgot-password email)
  router.get('/reset-password', rateLimit(10, 'reset-page'), async (req, res) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    const setResetHeaders = (includeScript) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      const scriptSrc = includeScript ? ` script-src 'nonce-${nonce}';` : '';
      res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}';${scriptSrc} connect-src 'self'; frame-ancestors 'none'`);
      res.setHeader('Referrer-Policy', 'no-referrer');
    };
    try {
      const token = String(req.query.token || '').trim();
      if (!token || !/^[a-f0-9]{64}$/.test(token)) {
        setResetHeaders(false);
        return res.send(renderResetErrorPage('Invalid or expired reset link', nonce));
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const result = await pool.query(
        'SELECT id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()',
        [tokenHash],
      );

      if (result.rows.length === 0) {
        setResetHeaders(false);
        return res.send(renderResetErrorPage('This reset link has expired or already been used', nonce));
      }

      setResetHeaders(true);
      return res.send(renderResetFormPage(token, config.PUBLIC_ORIGIN, nonce));
    } catch (error) {
      log.error('reset-password page error', { error: error.message });
      const errorNonce = crypto.randomBytes(16).toString('base64');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${errorNonce}'; frame-ancestors 'none'`);
      return res.send(renderResetErrorPage('Failed to load reset page', errorNonce));
    }
  });

  // Static page routes (serve HTML files without .html extension)
  router.get('/privacy', (req, res) => res.sendFile(path.join(config.PUBLIC_DIR, 'privacy.html')));
  router.get('/terms', (req, res) => res.sendFile(path.join(config.PUBLIC_DIR, 'terms.html')));
  router.get('/security-whitepaper', (req, res) => res.sendFile(path.join(config.PUBLIC_DIR, 'security-whitepaper.html')));

  // SPA fallback - serve index.html for non-API, non-static routes.
  // Prefer React dist/index.html when the Vite build exists; fall back
  // to legacy public/index.html otherwise.
  const _fs = require('fs');
  const _reactIndex = path.join(config.PUBLIC_DIR, '..', 'packages', 'web', 'dist', 'index.html');
  const _spaIndex = _fs.existsSync(_reactIndex) ? _reactIndex : path.join(config.PUBLIC_DIR, 'index.html');
  router.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/uploads/')) {
      return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(_spaIndex, (err) => {
      if (err && !res.headersSent) next(err);
    });
  });

  return router;
};
