'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  encodeCursor,
  decodeCursor,
  parsePageParams,
  paginateArray,
  buildPaginatedResponse,
} = require('../lib/pagination');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('pagination: constants', () => {
  it('DEFAULT_PAGE_SIZE is 50', () => {
    assert.equal(DEFAULT_PAGE_SIZE, 50);
  });

  it('MAX_PAGE_SIZE is 200', () => {
    assert.equal(MAX_PAGE_SIZE, 200);
  });
});

// ---------------------------------------------------------------------------
// encodeCursor / decodeCursor
// ---------------------------------------------------------------------------

describe('pagination: encodeCursor', () => {
  it('returns a base64url string', () => {
    const cursor = encodeCursor({ value: '2024-01-01', id: 'abc' });
    assert.equal(typeof cursor, 'string');
    assert.ok(cursor.length > 0);
    // base64url chars only
    assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  });

  it('round-trips through decodeCursor', () => {
    const data = { value: '2024-01-01T00:00:00Z', id: 'item-42' };
    const encoded = encodeCursor(data);
    const decoded = decodeCursor(encoded);
    assert.deepEqual(decoded, data);
  });
});

describe('pagination: decodeCursor', () => {
  it('returns null for null input', () => {
    assert.equal(decodeCursor(null), null);
  });

  it('returns null for undefined input', () => {
    assert.equal(decodeCursor(undefined), null);
  });

  it('returns null for empty string', () => {
    assert.equal(decodeCursor(''), null);
  });

  it('returns null for non-string input', () => {
    assert.equal(decodeCursor(12345), null);
  });

  it('returns null for invalid base64', () => {
    assert.equal(decodeCursor('not-valid-base64!!!'), null);
  });

  it('returns null for valid base64 that decodes to non-object', () => {
    // base64url of the string "hello"
    const cursor = Buffer.from('"hello"').toString('base64url');
    assert.equal(decodeCursor(cursor), null);
  });

  it('returns null for valid base64 that decodes to null JSON', () => {
    const cursor = Buffer.from('null').toString('base64url');
    assert.equal(decodeCursor(cursor), null);
  });

  it('successfully decodes a valid cursor', () => {
    const data = { value: 'something', id: '123' };
    const cursor = Buffer.from(JSON.stringify(data)).toString('base64url');
    assert.deepEqual(decodeCursor(cursor), data);
  });
});

// ---------------------------------------------------------------------------
// parsePageParams
// ---------------------------------------------------------------------------

describe('pagination: parsePageParams', () => {
  it('uses default page size when limit is not provided', () => {
    const result = parsePageParams({});
    assert.equal(result.limit, DEFAULT_PAGE_SIZE);
    assert.equal(result.cursor, null);
    assert.equal(result.direction, 'next');
  });

  it('parses limit from query.limit', () => {
    const result = parsePageParams({ limit: '25' });
    assert.equal(result.limit, 25);
  });

  it('parses limit from query.pageSize', () => {
    const result = parsePageParams({ pageSize: '30' });
    assert.equal(result.limit, 30);
  });

  it('clamps limit to MAX_PAGE_SIZE', () => {
    const result = parsePageParams({ limit: '999' });
    assert.equal(result.limit, MAX_PAGE_SIZE);
  });

  it('uses default when limit is negative', () => {
    const result = parsePageParams({ limit: '-5' });
    assert.equal(result.limit, DEFAULT_PAGE_SIZE);
  });

  it('uses default when limit is zero', () => {
    const result = parsePageParams({ limit: '0' });
    assert.equal(result.limit, DEFAULT_PAGE_SIZE);
  });

  it('uses default when limit is NaN', () => {
    const result = parsePageParams({ limit: 'abc' });
    assert.equal(result.limit, DEFAULT_PAGE_SIZE);
  });

  it('reads cursor from query.cursor', () => {
    const result = parsePageParams({ cursor: 'abc123' });
    assert.equal(result.cursor, 'abc123');
  });

  it('reads cursor from query.after as fallback', () => {
    const result = parsePageParams({ after: 'xyz789' });
    assert.equal(result.cursor, 'xyz789');
  });

  it('sets direction to prev when specified', () => {
    const result = parsePageParams({ direction: 'prev' });
    assert.equal(result.direction, 'prev');
  });

  it('defaults direction to next for invalid values', () => {
    const result = parsePageParams({ direction: 'invalid' });
    assert.equal(result.direction, 'next');
  });

  it('respects custom defaultSize option', () => {
    const result = parsePageParams({}, { defaultSize: 10 });
    assert.equal(result.limit, 10);
  });

  it('respects custom maxSize option', () => {
    const result = parsePageParams({ limit: '500' }, { maxSize: 100 });
    assert.equal(result.limit, 100);
  });
});

// ---------------------------------------------------------------------------
// paginateArray
// ---------------------------------------------------------------------------

describe('pagination: paginateArray', () => {
  const items = [
    { id: '1', createdAt: '2024-01-01', name: 'A' },
    { id: '2', createdAt: '2024-01-02', name: 'B' },
    { id: '3', createdAt: '2024-01-03', name: 'C' },
    { id: '4', createdAt: '2024-01-04', name: 'D' },
    { id: '5', createdAt: '2024-01-05', name: 'E' },
  ];

  it('returns first page without cursor', () => {
    const result = paginateArray(items, { limit: 3 });
    assert.equal(result.items.length, 3);
    assert.equal(result.items[0].name, 'A');
    assert.equal(result.items[2].name, 'C');
    assert.equal(result.pagination.hasMore, true);
    assert.ok(result.pagination.nextCursor);
    assert.equal(result.pagination.total, 5);
    assert.equal(result.pagination.pageSize, 3);
  });

  it('returns all items when limit exceeds array size', () => {
    const result = paginateArray(items, { limit: 100 });
    assert.equal(result.items.length, 5);
    assert.equal(result.pagination.hasMore, false);
    assert.equal(result.pagination.nextCursor, null);
  });

  it('paginates from cursor position', () => {
    // First page
    const page1 = paginateArray(items, { limit: 2 });
    assert.equal(page1.items.length, 2);
    assert.equal(page1.pagination.hasMore, true);

    // Second page
    const page2 = paginateArray(items, { limit: 2, cursor: page1.pagination.nextCursor });
    assert.equal(page2.items.length, 2);
    assert.equal(page2.items[0].name, 'C');
    assert.equal(page2.items[1].name, 'D');
  });

  it('returns empty page for invalid cursor pointing past the end', () => {
    const cursor = encodeCursor({ value: '2999-01-01', id: 'zzz' });
    const result = paginateArray(items, { limit: 3, cursor });
    assert.equal(result.items.length, 0);
    assert.equal(result.pagination.hasMore, false);
  });

  it('handles empty items array', () => {
    const result = paginateArray([], { limit: 10 });
    assert.equal(result.items.length, 0);
    assert.equal(result.pagination.hasMore, false);
    assert.equal(result.pagination.nextCursor, null);
    assert.equal(result.pagination.total, 0);
  });

  it('handles limit of 1', () => {
    const result = paginateArray(items, { limit: 1 });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].name, 'A');
    assert.equal(result.pagination.hasMore, true);
  });

  it('supports custom cursorField and idField', () => {
    const customItems = [
      { pk: 'a', ts: 100 },
      { pk: 'b', ts: 200 },
      { pk: 'c', ts: 300 },
    ];
    const result = paginateArray(customItems, {
      limit: 2,
      cursorField: 'ts',
      idField: 'pk',
    });
    assert.equal(result.items.length, 2);
    assert.equal(result.pagination.hasMore, true);
  });
});

// ---------------------------------------------------------------------------
// buildPaginatedResponse
// ---------------------------------------------------------------------------

describe('pagination: buildPaginatedResponse', () => {
  it('wraps data and pagination into an object', () => {
    const data = [{ id: 1 }];
    const pagination = { hasMore: false, nextCursor: null, pageSize: 50, total: 1 };

    const result = buildPaginatedResponse(data, pagination);
    assert.deepEqual(result, { data, pagination });
  });

  it('preserves empty data array', () => {
    const result = buildPaginatedResponse([], { hasMore: false });
    assert.deepEqual(result.data, []);
  });
});
