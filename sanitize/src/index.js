/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import commonjs from './index.cjs';

export const {
  SENSITIVE_FIELD_PATTERNS,
  REDACTED_SENSITIVE_FIELD_VALUE,
  normalizeSensitiveFieldText,
  canonicalSensitiveFieldText,
  matchesSensitiveFieldPattern,
  sanitizeSensitiveFields,
  maskRangePreservingFormat,
  collectPiiRanges,
  applyMaskedRanges,
  shannonEntropy,
  SECRET_RULES,
  collectSecretRanges,
  sanitizeSecrets,
  sanitizeText,
  sanitizePersonalInformation,
  sanitizeHeaders,
  sanitizeUrl,
} = commonjs;

export function sanitizeToolResultText(toolResultText = '', options = {}) {
  const text = String(toolResultText || '');
  let fieldSanitized = text;
  try {
    fieldSanitized = JSON.stringify(sanitizeSensitiveFields(JSON.parse(text)));
  } catch {
    // Text output still receives content-level secret and PII sanitization.
  }
  return sanitizeText(fieldSanitized, options);
}

export default {
  ...commonjs,
  sanitizeSecrets,
  sanitizeText,
  sanitizeToolResultText,
};
