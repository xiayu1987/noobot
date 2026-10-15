/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTimeMs } from "#agent/config";
import { isSuperAdminRole, SUPER_ADMIN_ROLE } from "#agent/utils";
import { randomBytes } from "node:crypto";
import { HTTP_STATUS } from "#agent/constants";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { text } from "@noobot/shared/value";

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
      userId: text(userId),
      role: isSuperAdminRole(role) ? SUPER_ADMIN_ROLE : "user",
      issuedAt: Date.now(),
    });
    return apiKey;
  }

  function resolveAuthByApiKey(req = {}) {
    const headerApiKey = text(req?.headers?.["x-api-key"]);
    const bearer = text(req?.headers?.authorization);
    const bearerApiKey = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : "";
    let queryApiKey = text(req?.query?.apikey);
    if (!queryApiKey && req?.url) {
      try {
        queryApiKey = text(new URL(req.url, "http://localhost").searchParams.get("apikey"));
      } catch (error) {
        void writeRuntimeEvent({
          scope: "system",
          source: "service",
          channel: RUNTIME_EVENT_CHANNELS.DIRECT,
          category: RUNTIME_EVENT_CATEGORIES.SECURITY,
          level: "warn",
          event: "service.auth.extractApiKey.urlParse.failed",
          data: {
            urlPathPreview: String(req?.url || "")
              .split("?")[0]
              .slice(0, 200),
            urlLength: String(req?.url || "").length,
          },
          error,
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
    const normalizedRequestUserId = text(requestUserId);
    if (!normalizedRequestUserId) return false;
    if (isSuperAdminRole(authInfo?.role)) return false;
    return String(authInfo?.userId || "") !== normalizedRequestUserId;
  }

  function requireApiKey(req, res, next) {
    const authInfo = req.auth || resolveAuthByApiKey(req);
    if (!authInfo) {
      res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ ok: false, error: translateText("auth.missingApiKey", req.locale) });
      return;
    }
    req.auth = authInfo;
    const requestUserId =
      text(req.params?.userId) || text(req.body?.userId) || text(req.query?.userId);
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
