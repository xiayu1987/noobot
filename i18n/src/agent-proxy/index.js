/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

export function resolveLocaleFromRequest(request = null) {
  try {
    const requestUrl = new URL(request?.url || "", "http://localhost");
    const explicitLocale = text(requestUrl.searchParams.get("locale"));
    if (explicitLocale) return explicitLocale;
  } catch {
    void 0;
  }
  const acceptLanguage = text(request?.headers?.["accept-language"]);
  if (!acceptLanguage) return "";
  return acceptLanguage.split(",")[0]?.trim() || "";
}

const EN_US_MESSAGES = Object.freeze({
  RECONNECT_FAILED: () => "agentProxy reconnect failed",
  ROUTE_FAILED: () => "agentProxy websocket route failed",
  INVALID_JSON_PAYLOAD: () => "agentProxy invalid json payload",
  INVALID_AGENT_COMMAND: () => "agentProxy invalid agent command",
  UNSUPPORTED_ACTION: ({ action }) => `agentProxy unsupported action: ${action}`,
  PERMISSION_DENIED: ({ action }) => `agentProxy permission denied for action: ${action}`,
  UPSTREAM_UNAVAILABLE: () => "agentProxy upstream is unavailable",
  UNAUTHENTICATED: () => "agentProxy connection is not authenticated",
  UPSTREAM_URL_EMPTY: () => "agentProxy upstream url is empty",
  FAILED_TO_SEND_PAYLOAD: () => "agentProxy failed to send payload",
  UPSTREAM_WEBSOCKET_ERROR: () => "agentProxy upstream websocket error",
  INVALID_UPSTREAM_EVENT: () => "agentProxy invalid upstream event",
  CLIENT_IP_NOT_ALLOWED: () => "agentProxy client ip not allowed",
  ORIGIN_NOT_ALLOWED: () => "agentProxy origin not allowed",
  INVALID_REQUEST_URL: () => "agentProxy invalid request url",
  UPSTREAM_HTTP_ERROR: () => "agentProxy upstream http error",
  REQUEST_BODY_TOO_LARGE: () => "agentProxy request body too large",
  REQUEST_BODY_READ_FAILED: () => "agentProxy failed to read request body",
  INVALID_UPSTREAM_BASE_URL: () => "agentProxy invalid upstream base url",
  CONNECT_INTERCEPT_FAILED: () => "agentProxy connect intercept failed",
  CONNECT_INTERCEPT_ERROR: () => "agentProxy connect intercept error",
});

const ZH_CN_MESSAGES = Object.freeze({
  RECONNECT_FAILED: () => "agentProxy 重连失败",
  ROUTE_FAILED: () => "agentProxy websocket 路由失败",
  INVALID_JSON_PAYLOAD: () => "agentProxy JSON 载荷无效",
  INVALID_AGENT_COMMAND: () => "agentProxy 命令无效",
  UNSUPPORTED_ACTION: ({ action }) => `agentProxy 不支持的操作: ${action}`,
  PERMISSION_DENIED: ({ action }) => `agentProxy 操作无权限: ${action}`,
  UPSTREAM_UNAVAILABLE: () => "agentProxy 上游不可用",
  UNAUTHENTICATED: () => "agentProxy 连接未认证",
  UPSTREAM_URL_EMPTY: () => "agentProxy 上游 URL 为空",
  FAILED_TO_SEND_PAYLOAD: () => "agentProxy 发送载荷失败",
  UPSTREAM_WEBSOCKET_ERROR: () => "agentProxy 上游 websocket 错误",
  INVALID_UPSTREAM_EVENT: () => "agentProxy 上游事件无效",
  CLIENT_IP_NOT_ALLOWED: () => "agentProxy 客户端 IP 不允许",
  ORIGIN_NOT_ALLOWED: () => "agentProxy Origin 不允许",
  INVALID_REQUEST_URL: () => "agentProxy 请求 URL 无效",
  UPSTREAM_HTTP_ERROR: () => "agentProxy 上游 HTTP 错误",
  REQUEST_BODY_TOO_LARGE: () => "agentProxy 请求体过大",
  REQUEST_BODY_READ_FAILED: () => "agentProxy 读取请求体失败",
  INVALID_UPSTREAM_BASE_URL: () => "agentProxy 上游 base URL 无效",
  CONNECT_INTERCEPT_FAILED: () => "agentProxy connect 拦截失败",
  CONNECT_INTERCEPT_ERROR: () => "agentProxy connect 拦截异常",
});

export const AGENT_PROXY_MESSAGE_CODES = Object.freeze(Object.keys(EN_US_MESSAGES));

export function localizeAgentProxyError(code, locale, params = {}) {
  const messages = text(locale).toLowerCase().startsWith("zh") ? ZH_CN_MESSAGES : EN_US_MESSAGES;
  const render = messages[code];
  if (!render) throw new TypeError(`unknown agent proxy error code: ${code}`);
  return render(params);
}
