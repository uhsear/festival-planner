// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// Cursor-based pagination utilities for API endpoints
// Cursors are opaque base64-encoded JSON: {field, value, id}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function encodeCursor(data: Record<string, any>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

export function decodeCursor(cursor: any): Record<string, any> | null {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') return null;
    return decoded;
  } catch {
    return null;
  }
}

export function parsePageParams(query: Record<string, any>, { defaultSize = DEFAULT_PAGE_SIZE, maxSize = MAX_PAGE_SIZE } = {}) {
  let limit = parseInt(query.limit || query.pageSize, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = defaultSize;
  if (limit > maxSize) limit = maxSize;

  const cursor = query.cursor || query.after || null;
  const direction = query.direction === 'prev' ? 'prev' : 'next';

  return { limit, cursor, direction };
}

interface PaginateArrayOptions {
  limit: number;
  cursor?: string | null;
  cursorField?: string;
  idField?: string;
}

export function paginateArray(items: any[], { limit, cursor = null, cursorField = 'createdAt', idField = 'id' }: PaginateArrayOptions) {
  let startIndex = 0;
  let hasMore = false;

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      startIndex = items.findIndex((item) => {
        if (item[cursorField] === decoded.value) {
          return item[idField] > decoded.id;
        }
        return item[cursorField] > decoded.value;
      });
      if (startIndex === -1) startIndex = items.length;
    }
  }

  const page = items.slice(startIndex, startIndex + limit + 1);
  if (page.length > limit) {
    hasMore = true;
    page.pop();
  }

  const nextCursor = hasMore && page.length > 0
    ? encodeCursor({ value: page[page.length - 1][cursorField], id: page[page.length - 1][idField] })
    : null;

  return {
    items: page,
    pagination: {
      hasMore,
      nextCursor,
      pageSize: limit,
      total: items.length,
    },
  };
}

export function buildPaginatedResponse(data: any, pagination: any) {
  return {
    data,
    pagination,
  };
}
