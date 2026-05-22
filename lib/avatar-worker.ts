// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * Avatar processing worker thread (#18).
 * Runs Sharp operations off the main event loop to prevent p99 latency spikes
 * during concurrent avatar uploads.
 */

import { parentPort } from 'worker_threads';
import sharp from 'sharp';

parentPort!.on('message', async (msg: any) => {
  try {
    const { buffer, maxPixels, size, quality } = msg;
    const buf = Buffer.from(buffer);

    const metadata = await sharp(buf, { failOn: 'error', limitInputPixels: maxPixels }).metadata();

    const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'gif', 'webp']);
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      return parentPort!.postMessage({ error: 'Only JPEG, PNG, GIF, or WebP images are allowed', statusCode: 400 });
    }
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels) {
      return parentPort!.postMessage({ error: 'Image dimensions exceed maximum allowed size', statusCode: 400 });
    }

    const result = await sharp(buf, { failOn: 'error', limitInputPixels: maxPixels })
      .rotate()
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .webp({ quality, effort: 4 })
      .toBuffer();

    // Slice from Node's pool to get a standalone transferable ArrayBuffer
    const ab = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
    parentPort!.postMessage({ result: ab }, [ab]);
  } catch (err: any) {
    parentPort!.postMessage({ error: err.message, statusCode: 400 });
  }
});
