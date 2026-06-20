// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * SQL helpers for the Postgres migration runner.
 *
 * Postgres' simple-query protocol wraps a multi-statement string in an
 * implicit transaction, which makes `CREATE/DROP INDEX CONCURRENTLY` fail
 * ("cannot run inside a transaction block"). Several Festie migrations
 * (029, 032, 033, 035, 037, 038, 039, 040) use CONCURRENTLY by design. To
 * apply those through the runner we must send each statement separately so
 * each runs in its own implicit transaction. That requires splitting the
 * script into top-level statements WITHOUT being fooled by semicolons inside
 * string literals, dollar-quoted blocks (`$$ ... $$` / `$tag$ ... $tag$`),
 * or comments. These two pure functions do exactly that and nothing else, so
 * they can be unit-tested without a database.
 */

/** Strip line comments and block comments (best-effort, for boolean detection). */
export function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** True if the script uses CREATE/DROP INDEX CONCURRENTLY (ignoring comments). */
export function usesConcurrently(sql: string): boolean {
  return /\bCONCURRENTLY\b/i.test(stripSqlComments(sql));
}

/**
 * Split a SQL script into individual top-level statements. Semicolons inside
 * single-quoted strings, dollar-quoted blocks, line comments, and block
 * comments do NOT terminate a statement. Returns trimmed, non-empty
 * statements with their terminating semicolon removed.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buf = '';
  let i = 0;
  const n = sql.length;
  let inSingle = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  while (i < n) {
    const ch = sql[i]!;
    const next = i + 1 < n ? sql[i + 1]! : '';

    if (inLineComment) {
      buf += ch;
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (ch === '*' && next === '/') {
        buf += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }
    if (inSingle) {
      buf += ch;
      if (ch === "'") {
        if (next === "'") {
          // Escaped quote ('') — consume both, stay in string.
          buf += next;
          i += 2;
          continue;
        }
        inSingle = false;
      }
      i++;
      continue;
    }
    if (dollarTag !== null) {
      if (ch === '$' && sql.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    // Not currently inside a string / comment / dollar-quote.
    if (ch === '-' && next === '-') {
      inLineComment = true;
      buf += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      buf += ch + next;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      buf += ch;
      i++;
      continue;
    }
    if (ch === '$') {
      // Opening dollar-quote tag: `$$` or `$identifier$`.
      const m = /^\$\$|^\$[A-Za-z_]\w*\$/.exec(sql.slice(i));
      if (m) {
        dollarTag = m[0];
        buf += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (ch === ';') {
      const trimmed = buf.trim();
      if (trimmed) statements.push(trimmed);
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }

  const tail = buf.trim();
  if (tail) statements.push(tail);
  return statements;
}
