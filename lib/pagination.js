// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

// Cursor-based pagination utilities for API endpoints
// Cursors are opaque base64-encoded JSON: {field, value, id}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function encodeCursor(data) {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') return null;
    return decoded;
  } catch {
    return null;
  }
}

function parsePageParams(query, { defaultSize = DEFAULT_PAGE_SIZE, maxSize = MAX_PAGE_SIZE } = {}) {
  let limit = parseInt(query.limit || query.pageSize, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = defaultSize;
  if (limit > maxSize) limit = maxSize;

  const cursor = query.cursor || query.after || null;
  const direction = query.direction === 'prev' ? 'prev' : 'next';

  return { limit, cursor, direction };
}

function paginateArray(items, { limit, cursor, cursorField = 'createdAt', idField = 'id' }) {
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

function buildPaginatedResponse(data, pagination) {
  return {
    data,
    pagination,
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  encodeCursor,
  decodeCursor,
  parsePageParams,
  paginateArray,
  buildPaginatedResponse,
};
