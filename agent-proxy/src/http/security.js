/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { timingSafeEqual } from "node:crypto";
import { text } from "@noobot/shared/value";

function normalizeProxyAddress(input = "") {
  const value = text(input).toLowerCase();
  const mappedPrefix = "::ffff:";
  if (value.startsWith(mappedPrefix) && value.includes(".")) {
    return value.slice(mappedPrefix.length);
  }
  return value;
}

function isTrustedProxy(address = "", trustedProxies = []) {
  if (!Array.isArray(trustedProxies) || !trustedProxies.length) return false;
  const normalizedAddress = normalizeProxyAddress(address);
  return trustedProxies.some((rule) =>
    matchTrustedRule(normalizedAddress, normalizeProxyAddress(rule)),
  );
}

function parseForwardedFor(headerValue = "") {
  return String(headerValue || "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
}

export function getClientIp(request = null, trustedProxies = []) {
  const remoteAddress = text(request?.socket?.remoteAddress);
  if (!isTrustedProxy(remoteAddress, trustedProxies)) return remoteAddress;
  const hops = parseForwardedFor(request?.headers?.["x-forwarded-for"]);
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    if (!isTrustedProxy(hops[index], trustedProxies)) return hops[index];
  }
  return hops[0] || remoteAddress;
}

function matchTrustedRule(value = "", rule = "") {
  const normalizedValue = text(value);
  const normalizedRule = text(rule);
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
  const normalizedOrigin = text(origin);
  if (!normalizedOrigin) return false;
  return trustedOrigins.some((rule) => matchTrustedRule(normalizedOrigin, rule));
}

export function isLoopbackAddress(input = "") {
  const value = text(input).toLowerCase();
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
      const normalizedKey = text(key) || "anonymous";
      const bucket = buckets.get(normalizedKey);
      if (!bucket || now - bucket.windowStart > windowMs) {
        buckets.set(normalizedKey, { windowStart: now, count: 1 });
        return { ok: true, retryAfterSec: 0 };
      }
      bucket.count += 1;
      if (bucket.count <= maxRequests) {
        return { ok: true, retryAfterSec: 0 };
      }
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - bucket.windowStart)) / 1000));
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
    return text(value[0]);
  }
  return text(value);
}

export function resolveHeaderValue(request = null, headerName = "") {
  const normalizedHeaderName = text(headerName).toLowerCase();
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
