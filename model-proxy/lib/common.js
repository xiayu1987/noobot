/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const crypto = require('crypto');

function pad(numberValue, lengthValue = 2) {
  return String(numberValue).padStart(lengthValue, '0');
}

function sha256Text(value = '') {
  return crypto
    .createHash('sha256')
    .update(String(value || ''), 'utf8')
    .digest('hex');
}

function tryParseJson(text = '') {
  try {
    return JSON.parse(String(text || ''));
  } catch {
    return null;
  }
}

function getHeaderValue(headers = {}, candidateKeys = []) {
  if (!headers || typeof headers !== 'object') return '';
  const keys = Array.isArray(candidateKeys) ? candidateKeys : [candidateKeys];
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [String(key || '').trim().toLowerCase(), value])
      .filter(([key]) => Boolean(key)),
  );
  for (const key of keys) {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!normalizedKey) continue;
    const rawHeaderValue = normalizedHeaders[normalizedKey];
    if (Array.isArray(rawHeaderValue)) {
      const value = String(rawHeaderValue[0] || '').trim();
      if (value) return value;
      continue;
    }
    const value = String(rawHeaderValue || '').trim();
    if (value) return value;
  }
  return '';
}

module.exports = {
  getHeaderValue,
  pad,
  sha256Text,
  tryParseJson,
};
