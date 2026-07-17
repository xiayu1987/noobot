/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sanitizeSensitiveFields } from '@noobot/sanitize';

export function safeSegment(value = 'unknown') {
  return String(value || 'unknown').trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'unknown';
}

export function sanitizeValue(value, depth = 0) {
  if (value instanceof Error) return serializeError(value);
  return sanitizeSensitiveFields(value, depth, { maxDepth: 8, maxDepthValue: '[MaxDepth]' });
}

export function serializeError(error) {
  if (!error) return undefined;
  if (typeof error === 'string') return { message: error };
  return sanitizeValue({ name: error.name, message: error.message, code: error.code, stack: error.stack });
}
