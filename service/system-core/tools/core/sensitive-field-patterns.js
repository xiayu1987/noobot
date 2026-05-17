/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const SENSITIVE_FIELD_PATTERNS = [
  "password",
  "token",
  "api_key",
  "ssh_key",
  "connection_string",
  "dsn",
  "jdbc",
];

function normalizeSensitiveFieldText(input = "") {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function canonicalSensitiveFieldText(input = "") {
  return normalizeSensitiveFieldText(input).replace(/[_-]+/g, "");
}

const NORMALIZED_SENSITIVE_FIELD_PATTERNS = SENSITIVE_FIELD_PATTERNS.map((pattern) =>
  normalizeSensitiveFieldText(pattern),
);
const CANONICAL_SENSITIVE_FIELD_PATTERNS = SENSITIVE_FIELD_PATTERNS.map((pattern) =>
  canonicalSensitiveFieldText(pattern),
);

function matchesSensitiveFieldPattern(input = "") {
  const normalizedInput = normalizeSensitiveFieldText(input);
  const canonicalInput = canonicalSensitiveFieldText(input);
  if (!normalizedInput && !canonicalInput) return false;
  return NORMALIZED_SENSITIVE_FIELD_PATTERNS.some((pattern, index) => {
    const canonicalPattern = CANONICAL_SENSITIVE_FIELD_PATTERNS[index] || "";
    return (
      normalizedInput.includes(pattern) ||
      canonicalInput.includes(canonicalPattern)
    );
  });
}

export {
  SENSITIVE_FIELD_PATTERNS,
  normalizeSensitiveFieldText,
  canonicalSensitiveFieldText,
  matchesSensitiveFieldPattern,
};
