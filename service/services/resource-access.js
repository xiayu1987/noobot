/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { RESOURCE_ACCESS_TOKEN_QUERY, WORKSPACE_FILE_ROUTE } from "@noobot/shared/resource-access";

const RESOURCE_TARGET_PATH = new RegExp(
  `^/internal/(?:attachment/[^/]+/[^/]+|workspace/[^/]+/${WORKSPACE_FILE_ROUTE.PREVIEW}|admin/workspace-all/${WORKSPACE_FILE_ROUTE.PREVIEW})$`,
  "u",
);

function resourceTarget(value) {
  if (typeof value !== "string" || !value.startsWith("/internal/"))
    throw Object.assign(new TypeError("Invalid resource access target"), { statusCode: 400 });
  const url = new URL(value, "http://resource.invalid");
  if (
    url.origin !== "http://resource.invalid" ||
    !RESOURCE_TARGET_PATH.test(url.pathname) ||
    url.hash ||
    url.searchParams.has("apikey") ||
    url.searchParams.has(RESOURCE_ACCESS_TOKEN_QUERY)
  )
    throw Object.assign(new TypeError("Invalid resource access target"), { statusCode: 400 });
  url.searchParams.sort();
  return `${url.pathname}${url.search}`;
}

export function createResourceAccessService(resolveSession) {
  const secret = randomBytes(32);
  const sign = (payload) => createHmac("sha256", secret).update(payload).digest();
  function issue(auth, target) {
    const expiresAt = Date.now() + TIME_THRESHOLDS.service.resourceAccessTtlMs;
    const payload = Buffer.from(
      JSON.stringify({
        sessionId: auth.sessionId,
        target: resourceTarget(target),
        expiresAt,
      }),
    ).toString("base64url");
    return { token: `${payload}.${sign(payload).toString("base64url")}`, expiresAt };
  }
  function resolve(req) {
    if (!["GET", "HEAD"].includes(req.method)) return null;
    const url = new URL(req.url, "http://resource.invalid");
    const token = url.searchParams.get(RESOURCE_ACCESS_TOKEN_QUERY);
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payload, encodedSignature] = parts;
    const signature = Buffer.from(encodedSignature, "base64url");
    const expected = sign(payload);
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
    const ticket = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    url.searchParams.delete(RESOURCE_ACCESS_TOKEN_QUERY);
    url.searchParams.sort();
    if (Date.now() >= ticket.expiresAt || `${url.pathname}${url.search}` !== ticket.target)
      return null;
    return resolveSession(ticket.sessionId);
  }
  return { issue, resolve };
}
