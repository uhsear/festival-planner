/**
 * Playwright global setup for visual regression — register one shared user
 * and persist its session cookies to .auth/state.json. The auth visual
 * regression project loads this storageState so every test runs authed
 * without hammering /auth/register.
 */
import { test as setup, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.FESTIE_BASE_URL || 'http://localhost:4000';
const STATE_FILE = path.join(__dirname, '.auth', 'state.json');
const PASSWORD = 'visual-regression-pass-12345';

setup('register shared visreg user', async ({ request }: any) => {
  const username = 'pwvisreg_shared_' + Date.now();
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    headers: { 'content-type': 'application/json', 'x-trusted-mutation': '1' },
    data: { username, password: PASSWORD, confirmPassword: PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true },
  });
  expect(res.ok(), 'register failed: ' + res.status() + ' ' + (res.ok() ? '' : await res.text())).toBeTruthy();
  await request.storageState({ path: STATE_FILE });
  console.log('  registered ' + username + ' -> ' + STATE_FILE);
});
