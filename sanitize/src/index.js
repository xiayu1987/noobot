/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import { isIP } from 'node:net';

const SENSITIVE_FIELD_PATTERNS = [
  'password', 'token', 'secret', 'authorization', 'cookie', 'credential',
  'api_key', 'ssh_key', 'connection_string', 'dsn', 'jdbc',
];
const REDACTED_SENSITIVE_FIELD_VALUE = '[Redacted]';

function normalizeSensitiveFieldText(input = '') {
  return String(input || '').trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}
function canonicalSensitiveFieldText(input = '') {
  return normalizeSensitiveFieldText(input).replace(/[_-]+/g, '');
}
const normalizedPatterns = SENSITIVE_FIELD_PATTERNS.map(normalizeSensitiveFieldText);
const canonicalPatterns = SENSITIVE_FIELD_PATTERNS.map(canonicalSensitiveFieldText);
function matchesSensitiveFieldPattern(input = '') {
  const normalized = normalizeSensitiveFieldText(input);
  const canonical = canonicalSensitiveFieldText(input);
  if (!normalized && !canonical) return false;
  return normalizedPatterns.some((pattern, index) =>
    normalized.includes(pattern) || canonical.includes(canonicalPatterns[index]));
}
function sanitizeSensitiveFields(value, depth = 0, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 32;
  const replacement = options.replacement || REDACTED_SENSITIVE_FIELD_VALUE;
  if (depth > maxDepth) return options.maxDepthValue === undefined ? value : options.maxDepthValue;
  if (Array.isArray(value)) return value.map((item) => sanitizeSensitiveFields(item, depth + 1, options));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = matchesSensitiveFieldPattern(key)
      ? replacement
      : sanitizeSensitiveFields(child, depth + 1, options);
  }
  return out;
}
function maskRangePreservingFormat(value = '') {
  return String(value).replace(/[\p{L}\p{N}]/gu, 'x');
}
function isValidCnId(value) {
  if (!/^\d{17}[\dXx]$/.test(value)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = '10X98765432';
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
  return checks[sum % 11] === value[17].toUpperCase();
}
function isValidBankCard(value) {
  const normalized = String(value).replace(/[ -]/g, '');
  if (!/^\d{12,19}$/.test(normalized)) return false;
  let sum = 0;
  let doubled = false;
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    let digit = Number(normalized[i]);
    if (doubled && (digit *= 2) > 9) digit -= 9;
    sum += digit;
    doubled = !doubled;
  }
  return sum % 10 === 0;
}
function isValidInternationalPhone(value) {
  const digits = String(value).replace(/\D/g, '');
  return String(value).trim().startsWith('+') && digits.length >= 8 && digits.length <= 15;
}
function isValidUsSsn(value) {
  const digits = String(value).replace(/-/g, '');
  if (!/^\d{9}$/.test(digits)) return false;
  const area = Number(digits.slice(0, 3));
  return area !== 0 && area !== 666 && area < 900
    && digits.slice(3, 5) !== '00' && digits.slice(5) !== '0000';
}
function isValidIban(value) {
  const compact = String(value).replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const numeric = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
function collectPiiRanges(text) {
  const ranges = [];
  const addMatches = (regex, validator = () => true) => {
    for (const match of text.matchAll(regex)) {
      if (validator(match[0])) ranges.push([match.index, match.index + match[0].length]);
    }
  };
  addMatches(/(?<![\w.+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![\w.-])/giu);
  addMatches(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g);
  // International numbers require an explicit country prefix to avoid masking
  // arbitrary identifiers and source-code numbers.
  addMatches(/(?<![\w+])\+\d(?:[ ()-]*\d){7,14}(?!\d)/g, isValidInternationalPhone);
  addMatches(/(?<!\d)\d{17}[\dXx](?![\dXx])/g, isValidCnId);
  addMatches(/(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g, isValidUsSsn);
  addMatches(/(?<!\d)(?:\d[ -]?){12,19}(?!\d)/g, isValidBankCard);
  addMatches(/(?<![A-Z0-9])[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}(?![A-Z0-9])/gi, isValidIban);
  addMatches(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, (value) => isIP(value) === 4);
  // Let node:net perform the strict validation; the candidate pattern also
  // admits compressed forms such as 2001:db8::1 and ::1.
  addMatches(/(?<![\w:])(?=[A-F0-9:]*:)[A-F0-9:]{2,39}(?![\w:])/gi, (value) => isIP(value) === 6);
  addMatches(/(?<![A-F0-9])(?:[A-F0-9]{2}[:-]){5}[A-F0-9]{2}(?![A-F0-9])/gi);

  // Passport numbers have no safe universal shape. Only mask them when a
  // multilingual passport label supplies strong context.
  const passport = /(?:passport(?:\s+(?:no|number))?|passport[_-]?(?:no|number)|护照(?:号|号码)?|旅券番号)\s*[:=#]?\s*([A-Z0-9][A-Z0-9 -]{5,18}[A-Z0-9])/gi;
  for (const match of text.matchAll(passport)) {
    const candidate = match[1];
    const start = match.index + match[0].lastIndexOf(candidate);
    ranges.push([start, start + candidate.length]);
  }
  return ranges;
}
function shannonEntropy(value = '') {
  if (!value) return 0;
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}
// Deliberately limited to strong prefixes and structured credentials. No global
// "long/high-entropy string" rule: hashes and ordinary source code must survive.
const SECRET_RULES = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{35}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
];
// `Bearer` already provides strong credential context, so do not impose a
// length/entropy threshold. Short development and test tokens are secrets too.
const BEARER_SECRET = /\bBearer\s+([A-Za-z0-9._~+/=-]+)/gi;
const SECRET_ASSIGNMENT = /\b(?:api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key|auth)\b\s*[:=]\s*(['"]?)([^\s'"]{8,})\1/gi;
function collectSecretRanges(text) {
  const value = String(text || '');
  const ranges = [];
  for (const pattern of SECRET_RULES) {
    for (const match of value.matchAll(pattern)) ranges.push([match.index, match.index + match[0].length]);
  }
  for (const match of value.matchAll(BEARER_SECRET)) {
    const start = match.index + match[0].lastIndexOf(match[1]);
    ranges.push([start, start + match[1].length]);
  }
  for (const match of value.matchAll(SECRET_ASSIGNMENT)) {
    const secret = match[2];
    if (secret.length < 20 && shannonEntropy(secret) < 3) continue;
    const start = match.index + match[0].lastIndexOf(secret);
    ranges.push([start, start + secret.length]);
  }
  return ranges;
}
function applyMaskedRanges(text, ranges) {
  const merged = ranges
    .map(([start, end]) => [Math.max(0, start), Math.min(text.length, end)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])
    .reduce((all, range) => {
      const last = all.at(-1);
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else all.push([...range]);
      return all;
    }, []);
  let output = text;
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const [start, end] = merged[index];
    output = output.slice(0, start) + maskRangePreservingFormat(output.slice(start, end)) + output.slice(end);
  }
  return output;
}
function sanitizePersonalInformation(text = '') {
  const value = String(text || '');
  return applyMaskedRanges(value, collectPiiRanges(value));
}
function sanitizeSecrets(text = '') {
  const value = String(text || '');
  return applyMaskedRanges(value, collectSecretRanges(value));
}
function sanitizeText(text = '', options = {}) {
  const value = options.personalInformation === false
    ? String(text || '')
    : sanitizePersonalInformation(text);
  return options.secrets === false ? value : sanitizeSecrets(value);
}
function sanitizeToolResultText(toolResultText = '', options = {}) {
  const text = String(toolResultText || '');
  let fieldSanitized = text;
  try {
    fieldSanitized = JSON.stringify(sanitizeSensitiveFields(JSON.parse(text)));
  } catch {
    // Plain text still receives content-level secret and PII sanitization.
  }
  return sanitizeText(fieldSanitized, options);
}
function sanitizeHeaders(headers = {}, options = {}) {
  return sanitizeSensitiveFields(headers, 0, { replacement: options.replacement || '[REDACTED]' });
}
function sanitizeUrl(rawUrl = '', options = {}) {
  const replacement = options.replacement || '[REDACTED]';
  const value = String(rawUrl || '');
  if (!value || !value.includes('?')) return sanitizePersonalInformation(value);
  try {
    const parsed = new URL(value, 'http://noobot.local');
    for (const key of parsed.searchParams.keys()) {
      if (matchesSensitiveFieldPattern(key)) parsed.searchParams.set(key, replacement);
    }
    const output = /^https?:\/\//i.test(value) ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return sanitizePersonalInformation(output);
  } catch {
    return sanitizePersonalInformation(value);
  }
}

export {
  SENSITIVE_FIELD_PATTERNS, REDACTED_SENSITIVE_FIELD_VALUE,
  normalizeSensitiveFieldText, canonicalSensitiveFieldText, matchesSensitiveFieldPattern,
  sanitizeSensitiveFields, maskRangePreservingFormat, collectPiiRanges, applyMaskedRanges,
  shannonEntropy, SECRET_RULES, collectSecretRanges, sanitizeSecrets, sanitizeText,
  sanitizeToolResultText, sanitizePersonalInformation, sanitizeHeaders, sanitizeUrl,
};
