export function safeSegment(value = 'unknown') {
  return String(value || 'unknown').trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'unknown';
}

const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|cookie|apikey|api_key|credential/i;

export function sanitizeValue(value, depth = 0) {
  if (depth > 8) return '[MaxDepth]';
  if (value == null) return value;
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[Redacted]' : sanitizeValue(child, depth + 1);
    }
    return out;
  }
  return value;
}

export function serializeError(error) {
  if (!error) return undefined;
  if (typeof error === 'string') return { message: error };
  return sanitizeValue({ name: error.name, message: error.message, code: error.code, stack: error.stack });
}
