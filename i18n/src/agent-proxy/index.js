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
  ["agentProxy error", "agentProxy 错误"],
  ["agentProxy invalid json payload", "agentProxy JSON 载荷无效"],
  ["agentProxy channel not found for stop", "agentProxy 未找到用于 stop 的 channel"],
  [
    "agentProxy channel not found for interaction",
    "agentProxy 未找到用于 interaction 的 channel",
  ],
  ["agentProxy channel not found for join", "agentProxy 未找到用于 join 的 channel"],
  ["agentProxy upstream not running", "agentProxy 上游未运行"],
  ["agentProxy upstream is unavailable", "agentProxy 上游不可用"],
  ["agentProxy requires apikey", "agentProxy 需要 apikey"],
  ["agentProxy requires userId and sessionId", "agentProxy 需要 userId 和 sessionId"],
  ["agentProxy upstream url is empty", "agentProxy 上游 URL 为空"],
  ["agentProxy failed to send payload", "agentProxy 发送载荷失败"],
  ["agentProxy invalid upstream event", "agentProxy 上游事件无效"],
  ["agentProxy invalid request url", "agentProxy 请求 URL 无效"],
  ["agentProxy upstream http error", "agentProxy 上游 HTTP 错误"],
  ["agentProxy request body too large", "agentProxy 请求体过大"],
  ["agentProxy invalid upstream base url", "agentProxy 上游 base URL 无效"],
  ["agentProxy connect intercept failed", "agentProxy connect 拦截失败"],
  ["agentProxy connect intercept error", "agentProxy connect 拦截异常"],
  ["agentProxy client ip not allowed", "agentProxy 客户端 IP 不允许"],
  ["agentProxy origin not allowed", "agentProxy Origin 不允许"],
  ["agentProxy missing apikey", "agentProxy 缺少 apikey"],
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
