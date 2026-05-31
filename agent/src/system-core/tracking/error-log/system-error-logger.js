/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * SystemErrorLogger - high-level facade for system error logging.
 * Auto-resolves basePath via workspaceService.
 */
import { appendSystemErrorLog } from "./system-error-log.js";
import path from "node:path";
import { logError } from "../console/logger.js";

function resolveErrorStatus(error = {}) {
  const rawStatus =
    error?.status ??
    error?.statusCode ??
    error?.error?.status ??
    error?.response?.status ??
    error?.cause?.status ??
    error?.cause?.statusCode ??
    error?.cause?.error?.status;
  const status = Number(rawStatus);
  return Number.isFinite(status) && status > 0 ? status : undefined;
}

function resolveHeaderValue(headers = null, name = "") {
  if (!headers || !name) return undefined;
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return undefined;
  if (typeof headers?.get === "function") {
    return (
      headers.get(normalizedName) ||
      headers.get(normalizedName.toLowerCase()) ||
      undefined
    );
  }
  return (
    headers?.[normalizedName] ??
    headers?.[normalizedName.toLowerCase()] ??
    undefined
  );
}

function resolveErrorRequestId(error = {}) {
  return (
    error?.request_id ??
    error?.requestId ??
    error?.requestID ??
    resolveHeaderValue(error?.headers, "x-request-id") ??
    resolveHeaderValue(error?.response?.headers, "x-request-id") ??
    resolveHeaderValue(error?.cause?.headers, "x-request-id") ??
    resolveHeaderValue(error?.cause?.response?.headers, "x-request-id") ??
    undefined
  );
}

function resolveErrorCode(error = {}) {
  return (
    error?.code ??
    error?.error?.code ??
    error?.cause?.code ??
    error?.cause?.error?.code ??
    undefined
  );
}

function resolveErrorType(error = {}) {
  return (
    error?.type ??
    error?.error?.type ??
    error?.cause?.type ??
    error?.cause?.error?.type ??
    undefined
  );
}

function buildDefaultErrorExtra(error = null) {
  if (!error || typeof error !== "object") return {};
  const status = resolveErrorStatus(error);
  const code = resolveErrorCode(error);
  const type = resolveErrorType(error);
  const requestId = resolveErrorRequestId(error);
  const extra = {};
  if (status !== undefined) extra.status = status;
  if (code !== undefined && code !== null && `${code}`.trim()) extra.code = code;
  if (type !== undefined && type !== null && `${type}`.trim()) extra.type = type;
  if (requestId !== undefined && requestId !== null && `${requestId}`.trim()) {
    extra.requestId = requestId;
  }
  return extra;
}

export class SystemErrorLogger {
  constructor({ globalConfig = {}, workspaceService = null } = {}) {
    this.globalConfig = globalConfig;
    this.workspaceService = workspaceService;
  }

  async log({
    userId = "",
    sessionId = "",
    parentSessionId = "",
    source = "bot-manage",
    event = "system_error",
    error = null,
    extra = {},
    } = {}) {
    try {
      const normalizedUserId = String(userId || "").trim();
      const normalizedExtra =
        extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {};
      const defaultErrorExtra = buildDefaultErrorExtra(error);
      const mergedExtra = {
        ...defaultErrorExtra,
        ...normalizedExtra,
      };
      const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
      const basePath = normalizedUserId
        ? await this.workspaceService.ensureUserWorkspace(normalizedUserId)
        : path.resolve(workspaceRoot || ".");
      await appendSystemErrorLog({
        basePath,
        workspaceRoot,
        userId: normalizedUserId,
        sessionId,
        parentSessionId,
        source,
        event,
        message: error?.message || String(error || ""),
        stack: error?.stack || "",
        extra: mergedExtra,
      });
    } catch (error) {
      logError("[system_error][log_write_failed]", {
        error: error?.message || String(error),
      });
    }
  }
}
