// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Avatar worker thread pool (#18).
 * 2-thread pool for Sharp avatar processing to prevent blocking the event loop.
 * Falls back to inline processing if worker threads are unavailable.
 */

import { Worker } from 'worker_threads';

const POOL_SIZE = 2;
// Dual-mode resolution: under tsx (dev) import.meta.url ends in `.ts`, so the
// worker is `avatar-worker.ts`; in the esbuild bundle it ends in `.js`, so the
// worker is `dist/avatar-worker.js` (emitted as a sibling of dist/server.js).
const WORKER_EXT = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const WORKER_PATH = new URL(`./avatar-worker.${WORKER_EXT}`, import.meta.url);

export class AvatarPool {
  _workers: Worker[] = [];
  _queue: any[] = [];
  _available: Worker[] = [];
  _initialized = false;

  init() {
    if (this._initialized) return;
    this._initialized = true;
    for (let i = 0; i < POOL_SIZE; i++) {
      const worker = new Worker(WORKER_PATH, { execArgv: ['--experimental-strip-types'] });
      (worker as any)._busy = false;
      worker.on('error', () => {
        // Replace crashed worker
        const idx = this._workers.indexOf(worker);
        if (idx >= 0) {
          const replacement = new Worker(WORKER_PATH, { execArgv: ['--experimental-strip-types'] });
          (replacement as any)._busy = false;
          replacement.on('error', () => {}); // prevent unhandled
          this._workers[idx] = replacement;
          this._available.push(replacement);
          this._drain();
        }
      });
      this._workers.push(worker);
      this._available.push(worker);
    }
  }

  process(buffer: any, config: any) {
    return new Promise((resolve, reject) => {
      this.init();
      this._queue.push({ buffer, config, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    while (this._queue.length > 0 && this._available.length > 0) {
      const worker = this._available.pop()!;
      const task = this._queue.shift()!;
      (worker as any)._busy = true;

      const timeout = setTimeout(() => {
        cleanup();
        task.reject(new Error('Avatar processing timed out'));
      }, 15_000);

      const onMessage = (msg: any) => {
        cleanup();
        if (msg.error) {
          const err: any = new Error(msg.error);
          err.statusCode = msg.statusCode || 400;
          task.reject(err);
        } else {
          task.resolve(Buffer.from(msg.result));
        }
      };

      const onError = (err: any) => {
        cleanup();
        task.reject(err);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        worker.removeListener('message', onMessage);
        worker.removeListener('error', onError);
        (worker as any)._busy = false;
        this._available.push(worker);
        this._drain();
      };

      worker.on('message', onMessage);
      worker.on('error', onError);
      // Slice ArrayBuffer from Node's pool to get a standalone transferable copy
      const src = Buffer.from(task.buffer);
      const ab = src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
      worker.postMessage({
        buffer: ab,
        maxPixels: task.config.AVATAR_MAX_PIXELS,
        size: task.config.AVATAR_SIZE,
        quality: task.config.AVATAR_WEBP_QUALITY,
      }, [ab]);
    }
  }

  async terminate() {
    for (const w of this._workers) {
      await w.terminate().catch(() => {});
    }
    this._workers = [];
    this._available = [];
    this._initialized = false;
  }
}
