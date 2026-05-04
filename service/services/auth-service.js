/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomBytes } from "node:crypto";

const DEFAULT_API_KEY_TTL_MS = 24 * 60 * 60 * 1000;

export function createAuthService({
  initialApiKeyTtlMs = DEFAULT_API_KEY_TTL_MS,
  translateText,
} = {}) {
  const apiKeyStore = new Map();
  let apiKeyTtlMs = Number(initialApiKeyTtlMs || DEFAULT_API_KEY_TTL_MS);

  function setApiKeyTtlMs(nextApiKeyTtlMs = DEFAULT_API_KEY_TTL_MS) {
    apiKeyTtlMs = Number(nextApiKeyTtlMs || DEFAULT_API_KEY_TTL_MS);
  }

  function issueApiKey({ userId, role = "user" }) {
    const apiKey = randomBytes(24).toString("hex");
    apiKeyStore.set(apiKey, {
      userId: String(userId || "").trim(),
      role: role === "super_admin" ? "super_admin" : "user",
      issuedAt: Date.now(),
    });
    return apiKey;
  }

  function resolveAuthByApiKey(req = {}) {
    const headerApiKey = String(req?.headers?.["x-api-key"] || "").trim();
    const bearer = String(req?.headers?.authorization || "").trim();
    const bearerApiKey = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : "";
    let queryApiKey = String(req?.query?.apikey || "").trim();
    if (!queryApiKey && req?.url) {
      try {
        queryApiKey = String(
          new URL(req.url, "http://localhost").searchParams.get("apikey") || "",
        ).trim();
      } catch {
        queryApiKey = "";
      }
    }
    const apiKey = headerApiKey || bearerApiKey || queryApiKey;
    if (!apiKey) return null;
    const authInfo = apiKeyStore.get(apiKey);
    if (!authInfo) return null;
    const isExpired = Date.now() - Number(authInfo.issuedAt || 0) > apiKeyTtlMs;
    if (isExpired) {
      apiKeyStore.delete(apiKey);
      return null;
    }
    return authInfo;
  }

  function isForbiddenUserScope(authInfo, requestUserId = "") {
    const normalizedRequestUserId = String(requestUserId || "").trim();
    if (!normalizedRequestUserId) return false;
    if (authInfo?.role === "super_admin") return false;
    return String(authInfo?.userId || "") !== normalizedRequestUserId;
  }

  function requireApiKey(req, res, next) {
    const authInfo = resolveAuthByApiKey(req);
    if (!authInfo) {
      res
        .status(401)
        .json({ ok: false, error: translateText("auth.missingApiKey", req.locale) });
      return;
    }
    req.auth = authInfo;
    const requestUserId =
      String(req.params?.userId || "").trim() ||
      String(req.body?.userId || "").trim() ||
      String(req.query?.userId || "").trim();
    if (isForbiddenUserScope(authInfo, requestUserId)) {
      res.status(403).json({
        ok: false,
        error: translateText("auth.forbiddenUserScope", req.locale),
      });
      return;
    }
    next();
  }

  function requireSuperAdmin(req, res, next) {
    const authInfo = req.auth || null;
    if (String(authInfo?.role || "") !== "super_admin") {
      res.status(403).json({
        ok: false,
        error: translateText("auth.superAdminRequired", req.locale),
      });
      return;
    }
    next();
  }

  return {
    setApiKeyTtlMs,
    issueApiKey,
    resolveAuthByApiKey,
    isForbiddenUserScope,
    requireApiKey,
    requireSuperAdmin,
  };
}
