/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const HTTP_ADMISSION_POLICY = Object.freeze({
  connection: Object.freeze({ limit: 10, windowMs: 60000 }),
  mutation: Object.freeze({ limit: 120, windowMs: 60000 }),
  read: Object.freeze({ limit: 600, windowMs: 60000 }),
});

function requestClass(req = {}) {
  if (req.path === "/health") return "exempt";
  if (req.path === "/internal/connect") return "connection";
  return ["GET", "HEAD", "OPTIONS"].includes(String(req.method || "GET").toUpperCase())
    ? "read"
    : "mutation";
}

function networkIdentity(req = {}) {
  return String(req.socket?.remoteAddress || req.ip || "unknown").trim() || "unknown";
}

export function createHttpAdmission({
  resolveAuthByApiKey = () => null,
  policies = HTTP_ADMISSION_POLICY,
  now = () => Date.now(),
} = {}) {
  const windows = new Map();

  function identityFor(req, category) {
    if (category === "connection") return `network:${networkIdentity(req)}`;
    const auth = resolveAuthByApiKey(req);
    if (auth) req.auth = auth;
    const userId = String(auth?.userId || "").trim();
    return userId ? `user:${userId}` : `network:${networkIdentity(req)}`;
  }

  function middleware(req, res, next) {
    const category = requestClass(req);
    if (category === "exempt") {
      next();
      return;
    }
    const policy = policies[category];
    if (!policy) throw new Error(`HTTP admission policy is missing for ${category}`);
    const timestamp = now();
    const key = `${category}:${identityFor(req, category)}`;
    let window = windows.get(key);
    if (!window || timestamp - window.startedAt >= policy.windowMs) {
      window = { count: 0, startedAt: timestamp };
      windows.set(key, window);
    }
    window.count += 1;
    if (window.count <= policy.limit) {
      next();
      return;
    }
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((policy.windowMs - (timestamp - window.startedAt)) / 1000),
    );
    res.set("Retry-After", String(retryAfterSeconds));
    res.status(429).json({ ok: false, error: "rate_limit_exceeded", retryAfterSeconds });
  }

  return Object.freeze({ middleware });
}
