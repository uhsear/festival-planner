import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, expect } from '@playwright/test';

// @ts-expect-error -- legacy SQLite planner module removed during PostgreSQL migration
import { importLegacyJsonToSqlite } from '../../lib/planner-db';
import { createFestivalPlanner } from '../../server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'test-admin-password';
const DEFAULT_PASSWORD = 'Str0ngTest!Pw';

function createFestivalFixture() {
  return [
    {
      id: 'fest-1',
      name: 'Test Fest',
      location: 'Test Grounds',
      stages: [
        { id: 'main', name: 'Main Stage', color: '#ff3366' },
        { id: 'forest', name: 'Forest Stage', color: '#00e8d0' },
      ],
      days: [
        {
          label: 'Friday',
          date: '2026-06-05',
          sets: [
            { id: 'set-a', artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00' },
            { id: 'set-b', artist: 'Beta', stageId: 'forest', startTime: '10:30', endTime: '11:30' },
            { id: 'set-c', artist: 'Gamma', stageId: 'main', startTime: '12:00', endTime: '13:00' },
          ],
        },
        {
          label: 'Saturday',
          date: '2026-06-06',
          sets: [
            { id: 'set-d', artist: 'Delta', stageId: 'forest', startTime: '14:00', endTime: '15:00' },
          ],
        },
      ],
      createdAt: '2026-03-09T00:00:00.000Z',
      updatedAt: '2026-03-09T00:00:00.000Z',
    },
    {
      id: 'fest-2',
      name: 'Campfire Fest',
      location: 'Lakeside',
      stages: [
        { id: 'ember', name: 'Ember Stage', color: '#ff8c00' },
      ],
      days: [
        {
          label: 'Sunday',
          date: '2026-06-07',
          sets: [
            { id: 'set-o', artist: 'Omega', stageId: 'ember', startTime: '16:00', endTime: '17:00' },
          ],
        },
      ],
      createdAt: '2026-03-09T00:00:00.000Z',
      updatedAt: '2026-03-09T00:00:00.000Z',
    },
  ];
}

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'festie-e2e-'));
  fs.writeFileSync(path.join(dataDir, 'festivals.json'), JSON.stringify(createFestivalFixture(), null, 2));
  fs.writeFileSync(path.join(dataDir, 'profiles.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'users.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'messages-fest-1.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'messages-fest-2.json'), '[]');
  importLegacyJsonToSqlite({ dataDir });

  const planner = await createFestivalPlanner({
    ADMIN_USER,
    ADMIN_PASSWORD,
    DATA_DIR: dataDir,
    PUBLIC_DIR,
    NODE_ENV: 'test',
  });

  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  const address = planner.server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    planner,
    async close() {
      await planner.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export const test = base.extend<{ app: any }>({
  app: async ({}, use: any) => {
    const app = await startServer();
    await use(app);
    await app.close();
  },
});

export {
  expect,
  ADMIN_USER,
  ADMIN_PASSWORD,
  DEFAULT_PASSWORD,
};
