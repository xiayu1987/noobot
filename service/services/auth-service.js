/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logError } from "#agent/tracking";
import { normalizeTimeMs } from "#agent/config";
import { isSuperAdminRole, SUPER_ADMIN_ROLE } from "#agent/utils";
import { randomBytes } from "node:crypto";
import { HTTP_STATUS } from "#agent/constants";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const DEFAULT_API_KEY_TTL_MS = TIME_THRESHOLDS.service.apiKeyTtlMs;

export function createAuthService({
  initialApiKeyTtlMs = DEFAULT_API_KEY_TTL_MS,
  translateText,
} = {}) {
  const apiKeyStore = new Map();
  let apiKeyTtlMs = normalizeTimeMs(initialApiKeyTtlMs, {
    fallback: DEFAULT_API_KEY_TTL_MS,
    min: 1000,
  });

  function setApiKeyTtlMs(nextApiKeyTtlMs = DEFAULT_API_KEY_TTL_MS) {
    apiKeyTtlMs = normalizeTimeMs(nextApiKeyTtlMs, {
      fallback: DEFAULT_API_KEY_TTL_MS,
      min: 1000,
    });
  }

  function issueApiKey({ userId, role = "user" }) {
    const apiKey = randomBytes(24).toString("hex");
    apiKeyStore.set(apiKey, {
      userId: String(userId || "").trim(),
      role: isSuperAdminRole(role) ? SUPER_ADMIN_ROLE : "user",
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
      } catch (error) {
        logError("[auth-service] extractApiKey query URL parse failed", {
          url: String(req?.url || "").slice(0, 200),
          error: error?.message || String(error),
        });
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
    if (isSuperAdminRole(authInfo?.role)) return false;
    return String(authInfo?.userId || "") !== normalizedRequestUserId;
  }

  function requireApiKey(req, res, next) {
    const authInfo = resolveAuthByApiKey(req);
    if (!authInfo) {
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ ok: false, error: translateText("auth.missingApiKey", req.locale) });
      return;
    }
    req.auth = authInfo;
    const requestUserId =
      String(req.params?.userId || "").trim() ||
      String(req.body?.userId || "").trim() ||
      String(req.query?.userId || "").trim();
    if (isForbiddenUserScope(authInfo, requestUserId)) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        ok: false,
        error: translateText("auth.forbiddenUserScope", req.locale),
      });
      return;
    }
    next();
  }

  function requireSuperAdmin(req, res, next) {
    const authInfo = req.auth || null;
    if (!isSuperAdminRole(authInfo?.role)) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
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
