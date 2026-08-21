/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ipKeyGenerator } from "express-rate-limit";

export const HTTP_ADMISSION_POLICY = Object.freeze({
  connection: Object.freeze({ limit: 120, windowMs: 60000 }),
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

export function createHttpAdmissionOptions({
  resolveAuthByApiKey = () => null,
  policies = HTTP_ADMISSION_POLICY,
} = {}) {
  const windowDurations = new Set(Object.values(policies).map((policy) => policy.windowMs));
  if (windowDurations.size !== 1) {
    throw new Error("HTTP admission classes must use one shared fixed-window duration");
  }

  function identityFor(req, category) {
    const address = String(req.ip || req.socket?.remoteAddress || "unknown").trim();
    const networkIdentity = address === "unknown" ? address : ipKeyGenerator(address);
    if (category === "connection") return `network:${networkIdentity}`;
    const auth = resolveAuthByApiKey(req);
    if (auth) req.auth = auth;
    const userId = String(auth?.userId || "").trim();
    return userId ? `user:${userId}` : `network:${networkIdentity}`;
  }

  return Object.freeze({
    windowMs: [...windowDurations][0],
    limit(req) {
      const category = requestClass(req);
      const policy = policies[category];
      if (!policy) throw new Error(`HTTP admission policy is missing for ${category}`);
      return policy.limit;
    },
    keyGenerator(req) {
      const category = requestClass(req);
      return `${category}:${identityFor(req, category)}`;
    },
    skip: (req) => requestClass(req) === "exempt",
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(req, res) {
      const retryAfterSeconds = Number(res.getHeader("Retry-After") || 1);
      res.status(429).json({ ok: false, error: "rate_limit_exceeded", retryAfterSeconds });
    },
  });
}
