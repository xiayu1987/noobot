/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { AGENT_PROXY_ERROR } from "./constants.js";

function isZhLocale(locale = "") {
  const normalized = String(locale || "").trim().toLowerCase();
  return normalized.startsWith("zh");
}

export function resolveLocaleFromRequest(request = null) {
  try {
    const requestUrl = new URL(request?.url || "", "http://localhost");
    const explicitLocale = String(requestUrl.searchParams.get("locale") || "").trim();
    if (explicitLocale) return explicitLocale;
  } catch {
    // ignore
  }
  const acceptLanguage = String(request?.headers?.["accept-language"] || "").trim();
  if (!acceptLanguage) return "";
  return acceptLanguage.split(",")[0]?.trim() || "";
}

const ZH_CN_MAP = new Map([
  [AGENT_PROXY_ERROR.DEFAULT, "agentProxy 错误"],
  [AGENT_PROXY_ERROR.INVALID_JSON_PAYLOAD, "agentProxy JSON 载荷无效"],
  [AGENT_PROXY_ERROR.CHANNEL_NOT_FOUND_FOR_STOP, "agentProxy 未找到用于 stop 的 channel"],
  [AGENT_PROXY_ERROR.CHANNEL_NOT_FOUND_FOR_INTERACTION, "agentProxy 未找到用于 interaction 的 channel"],
  [AGENT_PROXY_ERROR.CHANNEL_NOT_FOUND_FOR_JOIN, "agentProxy 未找到用于 join 的 channel"],
  [AGENT_PROXY_ERROR.UPSTREAM_NOT_RUNNING, "agentProxy 上游未运行"],
  [AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE, "agentProxy 上游不可用"],
  [AGENT_PROXY_ERROR.REQUIRES_APIKEY, "agentProxy 需要 apikey"],
  [AGENT_PROXY_ERROR.REQUIRES_USERID_SESSIONID, "agentProxy 需要 userId 和 sessionId"],
  [AGENT_PROXY_ERROR.UPSTREAM_URL_EMPTY, "agentProxy 上游 URL 为空"],
  [AGENT_PROXY_ERROR.FAILED_TO_SEND_PAYLOAD, "agentProxy 发送载荷失败"],
  [AGENT_PROXY_ERROR.INVALID_UPSTREAM_EVENT, "agentProxy 上游事件无效"],
  [AGENT_PROXY_ERROR.INVALID_REQUEST_URL, "agentProxy 请求 URL 无效"],
  [AGENT_PROXY_ERROR.UPSTREAM_HTTP_ERROR, "agentProxy 上游 HTTP 错误"],
  [AGENT_PROXY_ERROR.REQUEST_BODY_TOO_LARGE, "agentProxy 请求体过大"],
  [AGENT_PROXY_ERROR.INVALID_UPSTREAM_BASE_URL, "agentProxy 上游 base URL 无效"],
  [AGENT_PROXY_ERROR.CONNECT_INTERCEPT_FAILED, "agentProxy connect 拦截失败"],
  [AGENT_PROXY_ERROR.CONNECT_INTERCEPT_ERROR, "agentProxy connect 拦截异常"],
  [AGENT_PROXY_ERROR.CLIENT_IP_NOT_ALLOWED, "agentProxy 客户端 IP 不允许"],
  [AGENT_PROXY_ERROR.ORIGIN_NOT_ALLOWED, "agentProxy Origin 不允许"],
  [AGENT_PROXY_ERROR.MISSING_APIKEY, "agentProxy 缺少 apikey"],
]);

export function localizeAgentProxyMessage(message = "", locale = "") {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage || !isZhLocale(locale)) return normalizedMessage;

  const unsupportedPrefix = "agentProxy unsupported action: ";
  if (normalizedMessage.startsWith(unsupportedPrefix)) {
    return `agentProxy 不支持的操作: ${normalizedMessage.slice(unsupportedPrefix.length)}`;
  }

  const permissionPrefix = "agentProxy permission denied for action: ";
  if (normalizedMessage.startsWith(permissionPrefix)) {
    return `agentProxy 操作无权限: ${normalizedMessage.slice(permissionPrefix.length)}`;
  }

  return ZH_CN_MAP.get(normalizedMessage) || normalizedMessage;
}
