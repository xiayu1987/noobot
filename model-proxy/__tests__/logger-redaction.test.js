/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeHeaders, sanitizeUrl } from '../src/logger.js';

test('sanitizeHeaders redacts request and response credentials case-insensitively', () => {
  const sanitized = sanitizeHeaders({
    Authorization: 'Bearer secret',
    'x-api-key': 'api-secret',
    cookie: 'session=secret',
    'set-cookie': ['session=secret; HttpOnly'],
    'content-type': 'application/json',
    'x-request-id': 'request-1',
  });

  assert.deepEqual(sanitized, {
    Authorization: '[REDACTED]',
    'x-api-key': '[REDACTED]',
    cookie: '[REDACTED]',
    'set-cookie': '[REDACTED]',
    'content-type': 'application/json',
    'x-request-id': 'request-1',
  });
});

test('sanitizeUrl redacts sensitive query values and preserves ordinary diagnostics', () => {
  assert.equal(
    sanitizeUrl('/v1/chat/completions?api_key=secret&trace=enabled&token=hidden'),
    '/v1/chat/completions?api_key=%5BREDACTED%5D&trace=enabled&token=%5BREDACTED%5D',
  );
  assert.equal(sanitizeUrl('/v1/chat/completions'), '/v1/chat/completions');
});
