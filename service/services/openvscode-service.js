/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { BUILTIN_THRESHOLDS, normalizeTimeMs, resolveTimeMs } from "#agent/config";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const DEFAULT_COMMAND = "openvscode-server";
const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_START_TIMEOUT_MS = BUILTIN_THRESHOLDS.openvscode.startTimeoutMs;
const DEFAULT_IDLE_TIMEOUT_MS = BUILTIN_THRESHOLDS.openvscode.idleTimeoutMs;
const DEFAULT_CLEANUP_INTERVAL_MS = TIME_THRESHOLDS.openvscode.cleanupIntervalMs;
const DEFAULT_SHUTDOWN_GRACE_MS = TIME_THRESHOLDS.openvscode.shutdownGraceMs;
const DEFAULT_TOUCH_PERSIST_INTERVAL_MS = TIME_THRESHOLDS.openvscode.touchPersistIntervalMs;
const IDE_PATH_PREFIX = "/ide";
const IDE_TOKEN_QUERY_KEY = "tkn";
const IDE_TOKEN_HEADER_KEY = "x-ide-token";
const IDE_TOKEN_COOKIE_KEY = "noobot_ide_token";
const OPENVSCODE_TOKEN_COOKIE_KEY = "vscode-tkn";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeUserId(userId = "") {
  return String(userId || "").trim();
}

function normalizeBasePath(basePath = "") {
  return String(basePath || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function resolveManagedOpenVSCodeCommand() {
  const candidates = [
    path.resolve(CURRENT_DIR, "../vendor/openvscode-server/bin/openvscode-server"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function parsePositiveNumber(value, fallback, min = 0) {
  return normalizeTimeMs(value, {
    fallback,
    min,
    allowZero: min <= 0,
  });
}

function resolveOpenVSCodeTimeMs({
  envName = "",
  source = {},
  key = "",
  legacyKey = "",
  fallback = 0,
  min = 0,
} = {}) {
  const envRaw = process.env[String(envName || "").trim()];
  if (envRaw !== undefined) {
    return parsePositiveNumber(envRaw, fallback, min);
  }
  return resolveTimeMs(source, {
    key,
    legacyKeys: legacyKey ? [legacyKey] : [],
    sourceTag: "service.openvscode",
    warnLegacy: true,
    fallback,
    min,
    allowZero: min <= 0,
  });
}

function getOpenVSCodeConfig(globalConfig = {}) {
  const source = isPlainObject(globalConfig?.openVSCode)
    ? globalConfig.openVSCode
    : isPlainObject(globalConfig?.openvscode)
      ? globalConfig.openvscode
      : {};
  const envArgs = String(process.env.OPENVSCODE_SERVER_EXTRA_ARGS || "").trim();
  const configuredCommand = String(
    process.env.OPENVSCODE_SERVER_COMMAND || source.command || "",
  ).trim();
  return {
    command: configuredCommand || resolveManagedOpenVSCodeCommand() || DEFAULT_COMMAND,
    host: String(process.env.OPENVSCODE_SERVER_HOST || source.host || DEFAULT_HOST).trim() || DEFAULT_HOST,
    startTimeoutMs: DEFAULT_START_TIMEOUT_MS,
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    cleanupIntervalMs: resolveOpenVSCodeTimeMs({
      envName: "OPENVSCODE_SERVER_CLEANUP_INTERVAL_MS",
      source,
      key: "cleanupIntervalMs",
      legacyKey: "cleanup_interval_ms",
      fallback: DEFAULT_CLEANUP_INTERVAL_MS,
      min: 1000,
    }),
    shutdownGraceMs: resolveOpenVSCodeTimeMs({
      envName: "OPENVSCODE_SERVER_SHUTDOWN_GRACE_MS",
      source,
      key: "shutdownGraceMs",
      legacyKey: "shutdown_grace_ms",
      fallback: DEFAULT_SHUTDOWN_GRACE_MS,
      min: 0,
    }),
    extraArgs: Array.isArray(source.extraArgs)
      ? source.extraArgs.map((item) => String(item || "").trim()).filter(Boolean)
      : envArgs
        ? envArgs.split(" ").map((item) => item.trim()).filter(Boolean)
        : [],
  };
}

async function readJsonFileSafe(filePath = "") {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(String(raw || "{}"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid = 0) {
  const normalizedPid = Number(pid || 0);
  if (!normalizedPid) return false;
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch {
    return false;
  }
}

function isPortOpen({
  host = DEFAULT_HOST,
  port = 0,
  timeoutMs = TIME_THRESHOLDS.openvscode.portProbeTimeoutMs,
} = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port || 0) });
    const finish = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(Boolean(ok));
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function allocatePort(host = DEFAULT_HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref?.();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = Number(address?.port || 0);
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function buildProxyHeaders(headers = {}, targetPort = 0, targetHost = DEFAULT_HOST) {
  const nextHeaders = { ...(headers || {}) };
  nextHeaders.host = `${targetHost}:${targetPort}`;
  delete nextHeaders[IDE_TOKEN_HEADER_KEY];
  return nextHeaders;
}

function parseCookieHeader(cookieHeader = "") {
  const result = new Map();
  const chunks = String(cookieHeader || "").split(";");
  for (const chunk of chunks) {
    const separatorIndex = chunk.indexOf("=");
    if (separatorIndex <= 0) continue;
    const rawKey = chunk.slice(0, separatorIndex).trim();
    if (!rawKey) continue;
    const rawValue = chunk.slice(separatorIndex + 1).trim();
    result.set(rawKey, rawValue);
  }
  return result;
}

function buildTokenCookieValue(instance = {}) {
  return `${String(instance?.basePath || "").trim()}:${String(instance?.connectionToken || "").trim()}`;
}

function normalizeProxyPath(url = "", queryKeyToStrip = "") {
  try {
    const parsedUrl = new URL(String(url || "/"), "http://localhost");
    if (queryKeyToStrip) parsedUrl.searchParams.delete(queryKeyToStrip);
    return `${parsedUrl.pathname}${parsedUrl.search}`;
  } catch {
    const text = String(url || "/");
    if (!queryKeyToStrip) return text;
    const parsedUrl = new URL(text.startsWith("/") ? `http://localhost${text}` : `http://localhost/${text}`);
    parsedUrl.searchParams.delete(queryKeyToStrip);
    return `${parsedUrl.pathname}${parsedUrl.search}`;
  }
}

function appendQueryParam(urlPath = "", key = "", value = "") {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return String(urlPath || "/");
  const parsedUrl = new URL(String(urlPath || "/"), "http://localhost");
  parsedUrl.searchParams.set(normalizedKey, String(value || ""));
  return `${parsedUrl.pathname}${parsedUrl.search}`;
}

function buildOpenVSCodeUpstreamPath(urlPath = "", instance = {}, tokenCheckResult = {}) {
  if (tokenCheckResult?.source === "openvscode-cookie") {
    return String(urlPath || "/");
  }
  return appendQueryParam(
    urlPath,
    IDE_TOKEN_QUERY_KEY,
    String(instance?.connectionToken || ""),
  );
}

export function createOpenVSCodeService({
  getGlobalConfig = () => ({}),
  ensureUserWorkspace = async () => "",
  workspaceRootPath = () => "",
} = {}) {
  const instancesByUser = new Map();
  const instancesByBasePath = new Map();
  let cleanupTimer = null;
  let restorePromise = null;

  async function ensureWorkspace(userId = "") {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) throw new Error("userId required");
    const workspacePath = await ensureUserWorkspace(normalizedUserId);
    if (!workspacePath) throw new Error("workspace path unavailable");
    await mkdir(workspacePath, { recursive: true });
    return workspacePath;
  }

  function getRuntimeDir(workspacePath = "") {
    return path.join(workspacePath, ".noobot");
  }

  function getMetaPath(workspacePath = "") {
    return path.join(getRuntimeDir(workspacePath), "openvscode-server.json");
  }

  async function persistInstance(instance = {}) {
    const runtimeDir = getRuntimeDir(instance.workspacePath);
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(getMetaPath(instance.workspacePath), JSON.stringify(instance, null, 2), "utf8");
  }

  async function removePersistedInstance(instance = {}) {
    if (!instance?.workspacePath) return;
    try {
      await rm(getMetaPath(instance.workspacePath), { force: true });
    } catch {
      // ignore metadata cleanup errors
    }
  }

  function touchInstance(instance = {}, { persist = false } = {}) {
    if (!instance || typeof instance !== "object") return;
    const nowMs = Date.now();
    instance.lastAccessAtMs = nowMs;
    instance.lastAccessAt = new Date(nowMs).toISOString();
    if (
      persist ||
      nowMs - Number(instance.lastAccessPersistedAtMs || 0) >= DEFAULT_TOUCH_PERSIST_INTERVAL_MS
    ) {
      instance.lastAccessPersistedAtMs = nowMs;
      persistInstance(instance).catch(() => {});
    }
  }

  async function loadPersistedInstance(userId = "", workspacePath = "") {
    const parsed = await readJsonFileSafe(getMetaPath(workspacePath));
    if (!parsed) return null;
    const normalizedBasePath = normalizeBasePath(parsed.basePath);
    const port = Number(parsed.port || 0);
    if (!normalizedBasePath || !port) return null;
    return {
      ...parsed,
      userId: normalizeUserId(parsed.userId || userId),
      workspacePath,
      basePath: normalizedBasePath,
      port,
      pid: Number(parsed.pid || 0),
      lastAccessAt: String(parsed.lastAccessAt || parsed.startedAt || new Date().toISOString()),
      lastAccessAtMs: Number(parsed.lastAccessAtMs || Date.parse(parsed.lastAccessAt || parsed.startedAt || "") || Date.now()),
      lastAccessPersistedAtMs: Number(parsed.lastAccessPersistedAtMs || 0),
    };
  }

  async function isInstanceReachable(instance = {}) {
    if (!instance?.port) return false;
    const processOk = instance.pid ? isProcessAlive(instance.pid) : true;
    if (!processOk) return false;
    return isPortOpen({ host: instance.host || DEFAULT_HOST, port: instance.port });
  }

  function rememberInstance(instance = {}) {
    if (!instance?.userId || !instance?.basePath) return;
    instancesByUser.set(instance.userId, instance);
    instancesByBasePath.set(instance.basePath, instance);
  }

  async function restorePersistedInstances() {
    const workspaceRoot =
      typeof workspaceRootPath === "function" ? String(workspaceRootPath() || "").trim() : "";
    if (!workspaceRoot) return { restored: 0 };
    let restored = 0;
    let entries = [];
    try {
      await mkdir(workspaceRoot, { recursive: true });
      entries = await readdir(workspaceRoot, { withFileTypes: true });
    } catch {
      return { restored: 0 };
    }
    for (const entry of entries) {
      if (!entry?.isDirectory?.() || String(entry.name || "").startsWith(".")) continue;
      const userId = String(entry.name || "").trim();
      const workspacePath = path.join(workspaceRoot, userId);
      const instance = await loadPersistedInstance(userId, workspacePath);
      if (!instance) continue;
      if (
        await isInstanceReachable(instance) &&
        isInstanceForWorkspace(instance, workspacePath) &&
        isInstanceTokenCompatible(instance)
      ) {
        rememberInstance(instance);
        restored += 1;
        continue;
      }
      await removePersistedInstance(instance);
    }
    return { restored };
  }

  function ensureRestoreStarted() {
    if (!restorePromise) {
      restorePromise = restorePersistedInstances().catch(() => ({ restored: 0 }));
    }
    return restorePromise;
  }

  function forgetInstance(instance = {}) {
    if (instance?.userId) instancesByUser.delete(instance.userId);
    if (instance?.basePath) instancesByBasePath.delete(instance.basePath);
  }

  function stopInstanceBestEffort(instance = {}, { forceAfterMs = DEFAULT_SHUTDOWN_GRACE_MS } = {}) {
    if (!instance?.pid) return;
    const pid = Number(instance.pid);
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
    if (Number(forceAfterMs || 0) > 0) {
      const forceTimer = setTimeout(() => {
        if (!isProcessAlive(pid)) return;
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // ignore force-kill errors
        }
      }, Number(forceAfterMs || 0));
      forceTimer.unref?.();
    }
  }

  function isInstanceTokenCompatible(instance = {}) {
    const connectionToken = String(instance?.connectionToken || "").trim();
    if (!connectionToken) return false;
    const args = Array.isArray(instance?.args)
      ? instance.args.map((item) => String(item || ""))
      : [];
    const tokenIndex = args.indexOf("--connection-token");
    return tokenIndex >= 0 && String(args[tokenIndex + 1] || "").trim() === connectionToken;
  }

  function isInstanceForWorkspace(instance = {}, workspacePath = "") {
    const normalizedWorkspacePath = path.resolve(String(workspacePath || ""));
    const defaultFolder = String(instance?.defaultFolder || "").trim();
    if (defaultFolder && path.resolve(defaultFolder) === normalizedWorkspacePath) return true;
    const args = Array.isArray(instance?.args) ? instance.args.map((item) => String(item || "")) : [];
    const defaultFolderIndex = args.indexOf("--default-folder");
    return defaultFolderIndex >= 0 && path.resolve(args[defaultFolderIndex + 1] || "") === normalizedWorkspacePath;
  }

  async function resolveExistingInstance(userId = "", workspacePath = "") {
    const normalizedUserId = normalizeUserId(userId);
    const memoryInstance = instancesByUser.get(normalizedUserId);
    if (memoryInstance && await isInstanceReachable(memoryInstance)) {
      if (
        isInstanceForWorkspace(memoryInstance, workspacePath) &&
        isInstanceTokenCompatible(memoryInstance)
      ) {
        return memoryInstance;
      }
      stopInstanceBestEffort(memoryInstance, { forceAfterMs: getOpenVSCodeConfig(getGlobalConfig()).shutdownGraceMs });
      removePersistedInstance(memoryInstance).catch(() => {});
    }
    if (memoryInstance) forgetInstance(memoryInstance);

    const persistedInstance = await loadPersistedInstance(normalizedUserId, workspacePath);
    if (persistedInstance && await isInstanceReachable(persistedInstance)) {
      if (
        isInstanceForWorkspace(persistedInstance, workspacePath) &&
        isInstanceTokenCompatible(persistedInstance)
      ) {
        rememberInstance(persistedInstance);
        return persistedInstance;
      }
      stopInstanceBestEffort(persistedInstance, { forceAfterMs: getOpenVSCodeConfig(getGlobalConfig()).shutdownGraceMs });
      removePersistedInstance(persistedInstance).catch(() => {});
    }
    return null;
  }

  async function waitForInstance(instance = {}, timeoutMs = DEFAULT_START_TIMEOUT_MS, getSpawnError = () => null) {
    const deadline = Date.now() + Number(timeoutMs || DEFAULT_START_TIMEOUT_MS);
    while (Date.now() < deadline) {
      const spawnError = typeof getSpawnError === "function" ? getSpawnError() : null;
      if (spawnError) throw spawnError;
      if (await isPortOpen({
        host: instance.host || DEFAULT_HOST,
        port: instance.port,
        timeoutMs: TIME_THRESHOLDS.openvscode.waitProbeTimeoutMs,
      })) return true;
      if (instance.pid && !isProcessAlive(instance.pid)) return false;
      await sleep(TIME_THRESHOLDS.openvscode.waitProbeTimeoutMs);
    }
    return false;
  }

  async function startInstance(userId = "", workspacePath = "") {
    const openVSCodeConfig = getOpenVSCodeConfig(getGlobalConfig());
    const port = await allocatePort(openVSCodeConfig.host || DEFAULT_HOST);
    const basePath = `u-${randomBytes(18).toString("hex")}`;
    const serverBasePath = `${IDE_PATH_PREFIX}/${basePath}`;
    const runtimeDir = getRuntimeDir(workspacePath);
    const userDataDir = path.join(runtimeDir, "openvscode-user-data");
    const serverDataDir = path.join(runtimeDir, "openvscode-server-data");
    const extensionsDir = path.join(runtimeDir, "openvscode-extensions");
    const connectionToken = randomBytes(24).toString("hex");
    await mkdir(runtimeDir, { recursive: true });
    await mkdir(userDataDir, { recursive: true });
    await mkdir(serverDataDir, { recursive: true });
    await mkdir(extensionsDir, { recursive: true });
    const stdoutFd = openSync(path.join(runtimeDir, "openvscode-server.log"), "a");
    const stderrFd = openSync(path.join(runtimeDir, "openvscode-server.error.log"), "a");
    const args = [
      "--host",
      openVSCodeConfig.host || DEFAULT_HOST,
      "--port",
      String(port),
      "--server-base-path",
      serverBasePath,
      "--connection-token",
      connectionToken,
      "--accept-server-license-terms",
      "--default-folder",
      workspacePath,
      "--user-data-dir",
      userDataDir,
      "--server-data-dir",
      serverDataDir,
      "--extensions-dir",
      extensionsDir,
      ...openVSCodeConfig.extraArgs,
    ];
    let spawnError = null;
    const child = spawn(openVSCodeConfig.command, args, {
      cwd: workspacePath,
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
      env: { ...process.env },
    });
    child.once("error", (error) => {
      spawnError = error;
    });
    child.unref?.();
    const instance = {
      userId: normalizeUserId(userId),
      pid: Number(child.pid || 0),
      port,
      host: openVSCodeConfig.host || DEFAULT_HOST,
      basePath,
      urlPath: `${serverBasePath}/`,
      workspacePath,
      defaultFolder: workspacePath,
      userDataDir,
      serverDataDir,
      extensionsDir,
      connectionToken,
      command: openVSCodeConfig.command,
      args,
      startedAt: new Date().toISOString(),
      lastAccessAt: new Date().toISOString(),
      lastAccessAtMs: Date.now(),
      lastAccessPersistedAtMs: Date.now(),
    };
    rememberInstance(instance);
    await persistInstance(instance);
    try {
      const ready = await waitForInstance(instance, openVSCodeConfig.startTimeoutMs, () => spawnError);
      if (!ready) {
        throw new Error("OpenVSCode Server start timeout or exited early");
      }
    } catch (error) {
      forgetInstance(instance);
      const message = error?.code === "ENOENT"
        ? `OpenVSCode Server binary not found: ${openVSCodeConfig.command}. Run "npm --prefix service run install:openvscode-server" or set OPENVSCODE_SERVER_COMMAND.`
        : error?.message || "OpenVSCode Server start failed";
      throw new Error(message);
    }
    return instance;
  }

  async function openForUser(userId = "") {
    const normalizedUserId = normalizeUserId(userId);
    const workspacePath = await ensureWorkspace(normalizedUserId);
    const existingInstance = await resolveExistingInstance(normalizedUserId, workspacePath);
    if (existingInstance) {
      const openVSCodeConfig = getOpenVSCodeConfig(getGlobalConfig());
      stopInstanceBestEffort(existingInstance, {
        forceAfterMs: openVSCodeConfig.shutdownGraceMs,
      });
      forgetInstance(existingInstance);
      await removePersistedInstance(existingInstance);
    }
    const instance = await startInstance(normalizedUserId, workspacePath);
    touchInstance(instance, { persist: true });
    return {
      ok: true,
      userId: normalizedUserId,
      reused: false,
      restarted: Boolean(existingInstance),
      url: `${instance.urlPath || `${IDE_PATH_PREFIX}/${instance.basePath}/`}?${IDE_TOKEN_QUERY_KEY}=${encodeURIComponent(instance.connectionToken)}`,
      basePath: instance.basePath,
      port: instance.port,
      pid: instance.pid,
    };
  }

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

  async function resolveInstanceFromUrl(url = "") {
    let pathname = "";
    try {
      pathname = new URL(url || "/", "http://localhost").pathname;
    } catch {
      pathname = String(url || "").split("?")[0] || "";
    }
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] !== "ide" || !parts[1]) return null;
    const basePath = normalizeBasePath(parts[1]);
    if (!instancesByBasePath.has(basePath)) {
      await ensureRestoreStarted();
    }
    return instancesByBasePath.get(basePath) || null;
  }

  function canHandleRequest(url = "") {
    try {
      return new URL(url || "/", "http://localhost").pathname.startsWith(`${IDE_PATH_PREFIX}/`);
    } catch {
      return String(url || "").startsWith(`${IDE_PATH_PREFIX}/`);
    }
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

  function stopAllInstancesBestEffort() {
    const openVSCodeConfig = getOpenVSCodeConfig(getGlobalConfig());
    for (const instance of Array.from(instancesByUser.values())) {
      stopInstanceBestEffort(instance, { forceAfterMs: openVSCodeConfig.shutdownGraceMs });
      forgetInstance(instance);
      removePersistedInstance(instance).catch(() => {});
    }
  }

  async function cleanupIdleInstances({ force = false } = {}) {
    const openVSCodeConfig = getOpenVSCodeConfig(getGlobalConfig());
    const idleTimeoutMs = Number(openVSCodeConfig.idleTimeoutMs || 0);
    if (!force && idleTimeoutMs <= 0) return { stopped: 0, total: instancesByUser.size };
    const nowMs = Date.now();
    let stopped = 0;
    for (const instance of Array.from(instancesByUser.values())) {
      const reachable = await isInstanceReachable(instance);
      const lastAccessAtMs = Number(
        instance.lastAccessAtMs ||
          Date.parse(instance.lastAccessAt || instance.startedAt || "") ||
          0,
      );
      const idleMs = nowMs - lastAccessAtMs;
      const shouldStop = force || !reachable || idleMs >= idleTimeoutMs;
      if (!shouldStop) continue;
      stopInstanceBestEffort(instance, { forceAfterMs: openVSCodeConfig.shutdownGraceMs });
      forgetInstance(instance);
      await removePersistedInstance(instance);
      stopped += 1;
    }
    return { stopped, total: instancesByUser.size };
  }

  function startLifecycleManager() {
    if (cleanupTimer) return;
    const openVSCodeConfig = getOpenVSCodeConfig(getGlobalConfig());
    cleanupTimer = setInterval(() => {
      cleanupIdleInstances().catch(() => {});
    }, openVSCodeConfig.cleanupIntervalMs || DEFAULT_CLEANUP_INTERVAL_MS);
    cleanupTimer.unref?.();
  }

  function stopLifecycleManager({ stopInstances = false } = {}) {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
    if (stopInstances) {
      stopAllInstancesBestEffort();
    }
  }

  return {
    openForUser,
    proxyHttp,
    proxyUpgrade,
    canHandleRequest,
    resolveInstanceFromUrl,
    cleanupIdleInstances,
    startLifecycleManager,
    stopLifecycleManager,
  };
}
