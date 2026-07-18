/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import http from "node:http";
import { DEFAULT_HOST, IDE_PATH_PREFIX, IDE_TOKEN_QUERY_KEY } from "./config.js";

const IDE_TOKEN_HEADER_KEY = "x-ide-token";
const IDE_TOKEN_COOKIE_KEY = "noobot_ide_token";
const OPENVSCODE_TOKEN_COOKIE_KEY = "vscode-tkn";

function buildProxyHeaders(headers = {}, targetPort = 0, targetHost = DEFAULT_HOST) {
  const nextHeaders = { ...(headers || {}) }; nextHeaders.host = `${targetHost}:${targetPort}`; delete nextHeaders[IDE_TOKEN_HEADER_KEY]; return nextHeaders;
}
function parseCookieHeader(cookieHeader = "") {
  const result = new Map(); for (const chunk of String(cookieHeader || "").split(";")) { const i = chunk.indexOf("="); if (i <= 0) continue; const key = chunk.slice(0, i).trim(); if (key) result.set(key, chunk.slice(i + 1).trim()); } return result;
}
function buildTokenCookieValue(instance = {}) { return `${String(instance?.basePath || "").trim()}:${String(instance?.connectionToken || "").trim()}`; }
function normalizeProxyPath(url = "", queryKeyToStrip = "") {
  try { const parsed = new URL(String(url || "/"), "http://localhost"); if (queryKeyToStrip) parsed.searchParams.delete(queryKeyToStrip); return `${parsed.pathname}${parsed.search}`; }
  catch { const text = String(url || "/"); const parsed = new URL(text.startsWith("/") ? `http://localhost${text}` : `http://localhost/${text}`); if (queryKeyToStrip) parsed.searchParams.delete(queryKeyToStrip); return `${parsed.pathname}${parsed.search}`; }
}
function appendQueryParam(urlPath = "", key = "", value = "") { const parsed = new URL(String(urlPath || "/"), "http://localhost"); parsed.searchParams.set(key, String(value || "")); return `${parsed.pathname}${parsed.search}`; }
function buildOpenVSCodeUpstreamPath(urlPath, instance, result) { return result?.source === "openvscode-cookie" ? String(urlPath || "/") : appendQueryParam(urlPath, IDE_TOKEN_QUERY_KEY, instance?.connectionToken); }

export function createOpenVSCodeProxy({ resolveInstanceFromUrl, touchInstance } = {}) {
  function resolveTokenFromRequest(req = {}, instance = {}) {
    const expectedToken = String(instance?.connectionToken || "").trim();
    if (!expectedToken) {
      return { ok: false, source: "none", queryTokenValid: false };
    }
    let parsedUrl = null;
    try {
      parsedUrl = new URL(String(req?.url || req?.originalUrl || "/"), "http://localhost");
    } catch {
      return { ok: false, source: "none", queryTokenValid: false };
    }
    const queryToken = String(parsedUrl.searchParams.get(IDE_TOKEN_QUERY_KEY) || "").trim();
    const headerToken = String(req?.headers?.[IDE_TOKEN_HEADER_KEY] || "").trim();
    const cookieTokenValue = String(
      parseCookieHeader(req?.headers?.cookie || "").get(IDE_TOKEN_COOKIE_KEY) || "",
    ).trim();
    const openVSCodeCookieToken = String(
      parseCookieHeader(req?.headers?.cookie || "").get(OPENVSCODE_TOKEN_COOKIE_KEY) || "",
    ).trim();
    const cookieExpectedValue = buildTokenCookieValue(instance);
    const queryTokenValid = queryToken && queryToken === expectedToken;
    if (queryTokenValid) return { ok: true, source: "query", queryTokenValid };
    if (headerToken && headerToken === expectedToken) {
      return { ok: true, source: "header", queryTokenValid };
    }
    if (openVSCodeCookieToken && openVSCodeCookieToken === expectedToken) {
      return { ok: true, source: "openvscode-cookie", queryTokenValid };
    }
    if (cookieTokenValue && cookieTokenValue === cookieExpectedValue) {
      return { ok: true, source: "cookie", queryTokenValid };
    }
    return { ok: false, source: "none", queryTokenValid };
  }

  function writeForbiddenResponse(res) {
    if (!res || res.headersSent) return;
    res.status(403).json({ ok: false, error: "OpenVSCode access denied" });
  }

  function writeUpgradeForbidden(socket) {
    if (!socket || !socket.writable) {
      socket?.destroy?.();
      return;
    }
    socket.write(
      "HTTP/1.1 403 Forbidden\r\n" +
      "Connection: close\r\n" +
      "Content-Type: text/plain\r\n" +
      "Content-Length: 20\r\n\r\n" +
      "OpenVSCode forbidden",
    );
    socket.destroy();
  }

  function canHandleRequest(url = "") {
    try { return new URL(url || "/", "http://localhost").pathname.startsWith(`${IDE_PATH_PREFIX}/`); }
    catch { return String(url || "").startsWith(`${IDE_PATH_PREFIX}/`); }
  }

  async function proxyHttp(req, res) {
    const instance = await resolveInstanceFromUrl(req.originalUrl || req.url || "");
    if (!instance) {
      res.status(404).json({ ok: false, error: "OpenVSCode Server instance not found" });
      return;
    }
    const tokenCheckResult = resolveTokenFromRequest(req, instance);
    if (!tokenCheckResult.ok) {
      writeForbiddenResponse(res);
      return;
    }
    touchInstance(instance);
    const sanitizedTargetPath = normalizeProxyPath(req.originalUrl || req.url || "/", IDE_TOKEN_QUERY_KEY);
    if (
      req.method === "GET" &&
      tokenCheckResult.queryTokenValid
    ) {
      const cookiePath = `${IDE_PATH_PREFIX}/${instance.basePath}`;
      res.setHeader(
        "Set-Cookie",
        `${IDE_TOKEN_COOKIE_KEY}=${buildTokenCookieValue(instance)}; Path=${cookiePath}; HttpOnly; SameSite=Lax`,
      );
      const redirectTarget = sanitizedTargetPath || `${cookiePath}`;
      res.status(302).setHeader("Location", redirectTarget);
      res.end();
      return;
    }
    const upstreamPath = buildOpenVSCodeUpstreamPath(
      sanitizedTargetPath,
      instance,
      tokenCheckResult,
    );
    const upstreamRequest = http.request(
      {
        host: instance.host || DEFAULT_HOST,
        port: instance.port,
        method: req.method,
        path: upstreamPath,
        headers: buildProxyHeaders(req.headers, instance.port, instance.host || DEFAULT_HOST),
      },
      (upstreamResponse) => {
        res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers || {});
        upstreamResponse.pipe(res);
      },
    );
    upstreamRequest.on("error", (error) => {
      if (!res.headersSent) {
        res.status(502).json({ ok: false, error: error?.message || "OpenVSCode proxy failed" });
      } else {
        res.destroy(error);
      }
    });
    req.pipe(upstreamRequest);
  }

  async function proxyUpgrade(req, socket, head) {
    const instance = await resolveInstanceFromUrl(req.url || "");
    if (!instance) {
      socket.destroy();
      return true;
    }
    const tokenCheckResult = resolveTokenFromRequest(req, instance);
    if (!tokenCheckResult.ok) {
      writeUpgradeForbidden(socket);
      return true;
    }
    touchInstance(instance);
    const sanitizedTargetPath = normalizeProxyPath(req.url || "/", IDE_TOKEN_QUERY_KEY);
    const upstreamPath = buildOpenVSCodeUpstreamPath(
      sanitizedTargetPath,
      instance,
      tokenCheckResult,
    );
    const upstreamRequest = http.request({
      host: instance.host || DEFAULT_HOST,
      port: instance.port,
      method: req.method || "GET",
      path: upstreamPath,
      headers: {
        ...(req.headers || {}),
        host: `${instance.host || DEFAULT_HOST}:${instance.port}`,
      },
    });
    upstreamRequest.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      socket.write(
        `HTTP/1.1 ${upstreamResponse.statusCode || 101} ${upstreamResponse.statusMessage || "Switching Protocols"}\r\n` +
          Object.entries(upstreamResponse.headers || {})
            .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
            .join("\r\n") +
          "\r\n\r\n",
      );
      if (upstreamHead?.length) socket.write(upstreamHead);
      const touchOnData = () => touchInstance(instance);
      socket.on("data", touchOnData);
      upstreamSocket.on("data", touchOnData);
      const cleanupTouchListeners = () => {
        socket.off?.("data", touchOnData);
        upstreamSocket.off?.("data", touchOnData);
      };
      socket.once("close", cleanupTouchListeners);
      upstreamSocket.once("close", cleanupTouchListeners);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstreamRequest.on("error", () => socket.destroy());
    upstreamRequest.end(head);
    return true;
  }

  return { proxyHttp, proxyUpgrade, canHandleRequest };
}
