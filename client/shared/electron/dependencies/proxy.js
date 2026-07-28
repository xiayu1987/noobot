/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeDependencyProxyUrl(proxyUrl = "") {
  const value = String(proxyUrl || "").trim();
  if (!value) return "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Proxy address must be a valid URL, for example http://127.0.0.1:7890 or socks5://127.0.0.1:7890.");
  }
  const protocol = parsed.protocol.toLowerCase();
  if (!["http:", "https:", "socks4:", "socks5:"].includes(protocol)) {
    throw new Error("Proxy address must start with http://, https://, socks4:// or socks5://.");
  }
  if (!parsed.hostname || !parsed.port) throw new Error("Proxy address must include host and port, for example http://127.0.0.1:7890.");
  return parsed.toString();
}

export function maskDependencyProxyUrl(proxyUrl = "") {
  const value = String(proxyUrl || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? "***" : "";
      parsed.password = parsed.password ? "***" : "";
    }
    return parsed.toString();
  } catch {
    return value.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://***:***@");
  }
}

export function getDependencyProxyEnv(proxyUrl = "") {
  const normalized = normalizeDependencyProxyUrl(proxyUrl);
  if (!normalized) return {};
  return {
    HTTP_PROXY: normalized,
    HTTPS_PROXY: normalized,
    ALL_PROXY: normalized,
    http_proxy: normalized,
    https_proxy: normalized,
    all_proxy: normalized,
  };
}

export function getCurlProxyArgs(proxyUrl = "") {
  const normalized = normalizeDependencyProxyUrl(proxyUrl);
  return normalized ? ["--proxy", normalized] : [];
}

export async function validateDependencyProxy({ proxyUrl = "", runProcess, timeoutMs = 15000 } = {}) {
  const normalized = normalizeDependencyProxyUrl(proxyUrl);
  if (!normalized) return { ok: true, proxyUrl: "", maskedProxyUrl: "" };
  if (typeof runProcess !== "function") throw new Error("Proxy validation is unavailable.");
  const maskedProxyUrl = maskDependencyProxyUrl(normalized);
  const targetUrl = "https://github.com/";
  let result;
  if (process.platform === "win32") {
    result = await runProcess("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${targetUrl}' -Method Head -Proxy '${normalized.replace(/'/g, "''")}' -TimeoutSec 12 | Out-Null`,
    ], { timeoutMs, env: getDependencyProxyEnv(normalized) });
  } else {
    result = await runProcess("curl", ["-I", "-L", "--fail", "--silent", "--show-error", "--connect-timeout", "10", ...getCurlProxyArgs(normalized), targetUrl], { timeoutMs, env: getDependencyProxyEnv(normalized) });
  }
  if (!result.ok) {
    const detail = String(result.stderr || result.stdout || result.error || "").trim().slice(0, 500);
    return { ok: false, proxyUrl: normalized, maskedProxyUrl, error: detail || "Proxy validation failed." };
  }
  return { ok: true, proxyUrl: normalized, maskedProxyUrl };
}
