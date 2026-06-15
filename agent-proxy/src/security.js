/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { timingSafeEqual } from "node:crypto";

export function getClientIp(request = null) {
  const xff = String(request?.headers?.["x-forwarded-for"] || "").trim();
  if (xff) {
    const firstForwardedIp = xff.split(",")[0];
    return String(firstForwardedIp || "").trim();
  }
  return String(request?.socket?.remoteAddress || "").trim();
}

export function matchTrustedRule(value = "", rule = "") {
  const normalizedValue = String(value || "").trim();
  const normalizedRule = String(rule || "").trim();
  if (!normalizedValue || !normalizedRule) return false;
  if (normalizedRule === "*") return true;
  if (normalizedRule.endsWith("*")) {
    return normalizedValue.startsWith(normalizedRule.slice(0, -1));
  }
  return normalizedValue === normalizedRule;
}

export function isIpTrusted(clientIp = "", trustedIps = []) {
  if (!Array.isArray(trustedIps) || !trustedIps.length) return true;
  return trustedIps.some((rule) => matchTrustedRule(clientIp, rule));
}

export function isOriginTrusted(origin = "", trustedOrigins = []) {
  if (!Array.isArray(trustedOrigins) || !trustedOrigins.length) return true;
  const normalizedOrigin = String(origin || "").trim();
  if (!normalizedOrigin) return false;
  return trustedOrigins.some((rule) => matchTrustedRule(normalizedOrigin, rule));
}

export function isLoopbackAddress(input = "") {
  const value = String(input || "").trim().toLowerCase();
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(value);
}

export function buildSecurityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cache-control": "no-store",
  };
}

export function createFixedWindowRateLimiter({ windowMs = 60000, maxRequests = 100 } = {}) {
  const buckets = new Map();

  return {
    check(key = "anonymous") {
      const now = Date.now();
      const normalizedKey = String(key || "anonymous").trim() || "anonymous";
      const bucket = buckets.get(normalizedKey);
      if (!bucket || now - bucket.windowStart > windowMs) {
        buckets.set(normalizedKey, { windowStart: now, count: 1 });
        return { ok: true, retryAfterSec: 0 };
      }
      bucket.count += 1;
      if (bucket.count <= maxRequests) {
        return { ok: true, retryAfterSec: 0 };
      }
      const retryAfterSec = Math.max(
        1,
        Math.ceil((windowMs - (now - bucket.windowStart)) / 1000),
      );
      return { ok: false, retryAfterSec };
    },
    cleanup(maxIdleMs = windowMs * 2) {
      const now = Date.now();
      for (const [key, bucket] of buckets.entries()) {
        if (now - Number(bucket?.windowStart || 0) > maxIdleMs) {
          buckets.delete(key);
        }
      }
    },
  };
}

function normalizeHeaderValue(value = "") {
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }
  return String(value || "").trim();
}

export function resolveHeaderValue(request = null, headerName = "") {
  const normalizedHeaderName = String(headerName || "").trim().toLowerCase();
  if (!normalizedHeaderName) return "";
  return normalizeHeaderValue(request?.headers?.[normalizedHeaderName]);
}

export function secureEquals(left = "", right = "") {
  const leftValue = String(left || "");
  const rightValue = String(right || "");
  const leftBuffer = Buffer.from(leftValue, "utf8");
  const rightBuffer = Buffer.from(rightValue, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  if (!leftBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
