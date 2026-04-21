/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { BotManager } from "./system-core/bot-manage/index.js";
import { loadGlobalConfig, resolveConfigSecrets } from "./system-core/config/index.js";
import { WebSocketServer } from "ws";
import { normalizeSseLogEvent } from "./system-core/event/index.js";
import { safeJoin } from "./system-core/utils/fs-safe.js";

const app = express();
app.use(express.json({ limit: "20mb" }));

const globalConfigRaw = await loadGlobalConfig();
const CONFIG_PARAMS_FILE_NAME = "config-params.json";
let configParamsCache = {};
let globalConfig = globalConfigRaw;
let bot = null;
const apiKeyStore = new Map();
let apiKeyTtlMs = Number(globalConfig?.auth?.apiKeyTtlMs || 24 * 60 * 60 * 1000);
const defaultWorkspaceUsersConfig = {
  users: [
    {
      userId: "xiayu",
      connectCode: "change-your-connect-code",
    },
  ],
};

function workspaceRootPath() {
  return path.resolve(process.cwd(), String(globalConfig?.workspaceRoot || "../workspaces"));
}

function workspaceConfigParamsFilePath() {
  return path.join(workspaceRootPath(), CONFIG_PARAMS_FILE_NAME);
}

function normalizeConfigParams(input = {}) {
  const rawValues = input?.values && typeof input.values === "object" ? input.values : {};
  const values = Object.fromEntries(
    Object.entries(rawValues)
      .map(([key, value]) => [String(key || "").trim(), String(value ?? "").trim()])
      .filter(([key]) => Boolean(key)),
  );
  return { values };
}

async function readWorkspaceConfigParams({ createIfMissing = false } = {}) {
  const filePath = workspaceConfigParamsFilePath();
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return normalizeConfigParams(parsed);
  } catch {
    if (!createIfMissing) return normalizeConfigParams({});
    const payload = normalizeConfigParams({});
    await writeWorkspaceConfigParams(payload);
    return payload;
  }
}

async function writeWorkspaceConfigParams(input = {}) {
  const payload = normalizeConfigParams(input);
  const filePath = workspaceConfigParamsFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

function collectTemplateKeysFromObject(input, collector = new Set()) {
  if (typeof input === "string") {
    const pattern = /\$\{([A-Z0-9_]+)\}/gi;
    let match = pattern.exec(input);
    while (match) {
      collector.add(String(match[1] || "").trim());
      match = pattern.exec(input);
    }
    return collector;
  }
  if (Array.isArray(input)) {
    for (const item of input) collectTemplateKeysFromObject(item, collector);
    return collector;
  }
  if (input && typeof input === "object") {
    for (const value of Object.values(input)) {
      collectTemplateKeysFromObject(value, collector);
    }
  }
  return collector;
}

async function readConfigJsonIfExists(filePath = "") {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

async function collectConfigTemplateKeys() {
  const globalConfigFile = path.resolve(process.cwd(), "./config/global.config.json");
  const templateConfigFile = path.resolve(
    process.cwd(),
    String(globalConfigRaw?.workspaceTemplatePath || "../user-template/default-user"),
    "config.json",
  );
  const [globalCfgJson, templateCfgJson] = await Promise.all([
    readConfigJsonIfExists(globalConfigFile),
    readConfigJsonIfExists(templateConfigFile),
  ]);
  const keys = new Set();
  collectTemplateKeysFromObject(globalCfgJson, keys);
  collectTemplateKeysFromObject(templateCfgJson, keys);
  return Array.from(keys).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

async function rebuildRuntimeConfig() {
  const paramsPayload = await readWorkspaceConfigParams({ createIfMissing: true });
  configParamsCache = paramsPayload.values || {};
  globalConfig = resolveConfigSecrets(globalConfigRaw, {
    configParams: configParamsCache,
  });
  globalConfig.configParams = { ...configParamsCache };
  apiKeyTtlMs = Number(globalConfig?.auth?.apiKeyTtlMs || 24 * 60 * 60 * 1000);
  bot = new BotManager(globalConfig);
}

await rebuildRuntimeConfig();

async function readWorkspaceUsers() {
  const usersConfig = await readWorkspaceUsersConfig();
  const src = Array.isArray(usersConfig?.users) ? usersConfig.users : [];
  return src
    .map((item) => ({
      userId: String(item?.userId || "").trim(),
      connectCode: String(item?.connectCode || item?.code || "").trim(),
    }))
    .filter((item) => item.userId && item.connectCode);
}

function normalizeWorkspaceUsersConfig(input) {
  const src = Array.isArray(input)
    ? input
    : Array.isArray(input?.users)
      ? input.users
      : [];
  const users = src
    .map((item) => ({
      userId: String(item?.userId || "").trim(),
      connectCode: String(item?.connectCode || item?.code || "").trim(),
    }))
    .filter((item) => item.userId && item.connectCode);
  return { users };
}

function workspaceUsersFilePath() {
  const filePath = path.join(workspaceRootPath(), "user.json");
  return filePath;
}

async function readWorkspaceUsersConfig({ createIfMissing = false } = {}) {
  const filePath = workspaceUsersFilePath();
  let parsed = null;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    if (createIfMissing) {
      const payload = normalizeWorkspaceUsersConfig(defaultWorkspaceUsersConfig);
      await writeWorkspaceUsersConfig(payload);
      return payload;
    }
    return normalizeWorkspaceUsersConfig([]);
  }
  return normalizeWorkspaceUsersConfig(parsed);
}

async function writeWorkspaceUsersConfig(configPayload = {}) {
  const filePath = workspaceUsersFilePath();
  const payload = normalizeWorkspaceUsersConfig(configPayload);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
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

function resolveAuthByApiKey(req) {
  const headerApiKey = String(req.headers["x-api-key"] || "").trim();
  const bearer = String(req.headers.authorization || "").trim();
  const bearerApiKey = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : "";
  let queryApiKey = String(req.query?.apikey || "").trim();
  if (!queryApiKey && req.url) {
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
  const expired = Date.now() - Number(authInfo.issuedAt || 0) > apiKeyTtlMs;
  if (expired) {
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
    res.status(401).json({ ok: false, error: "missing or invalid apiKey" });
    return;
  }
  req.auth = authInfo;
  const requestUserId =
    String(req.params?.userId || "").trim() ||
    String(req.body?.userId || "").trim() ||
    String(req.query?.userId || "").trim();
  if (isForbiddenUserScope(authInfo, requestUserId)) {
    res.status(403).json({ ok: false, error: "forbidden user scope" });
    return;
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  const authInfo = req.auth || null;
  if (String(authInfo?.role || "") !== "super_admin") {
    res.status(403).json({ ok: false, error: "super admin required" });
    return;
  }
  next();
}

function normalizeRunConfig(input = {}) {
  const allowUserInteractionRaw = input?.allowUserInteraction;
  const allowUserInteraction =
    allowUserInteractionRaw === undefined
      ? true
      : Boolean(allowUserInteractionRaw);
  return {
    allowUserInteraction,
  };
}

app.post("/internal/connect", async (req, res) => {
  try {
    const userId = String(req.body?.userId || "").trim();
    const connectCode = String(req.body?.connectCode || "").trim();
    if (!userId || !connectCode) {
      throw new Error("userId/connectCode required");
    }

    const superAdmin = globalConfig?.superAdmin || {};
    const superAdminUserId = String(superAdmin?.userId || "").trim();
    const superAdminCode = String(superAdmin?.connectCode || "").trim();
    if (
      superAdminUserId &&
      superAdminCode &&
      userId === superAdminUserId &&
      connectCode === superAdminCode
    ) {
      await bot.ensureUserWorkspace(userId);
      const apiKey = issueApiKey({ userId, role: "super_admin" });
      res.json({ ok: true, role: "super_admin", userId, apiKey });
      return;
    }

    const users = await readWorkspaceUsers();
    const matchedUser = users.find(
      (item) => item.userId === userId && item.connectCode === connectCode,
    );
    if (!matchedUser) throw new Error("连接码验证失败");

    await bot.ensureUserWorkspace(userId);
    const apiKey = issueApiKey({ userId, role: "user" });
    res.json({ ok: true, role: "user", userId, apiKey });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || "connect failed" });
  }
});

app.use((req, res, next) => {
  if (req.path === "/health" || req.path === "/internal/connect") {
    next();
    return;
  }
  requireApiKey(req, res, next);
});

app.get("/internal/admin/users", requireSuperAdmin, async (req, res) => {
  try {
    const payload = await readWorkspaceUsersConfig({ createIfMissing: true });
    res.json({ ok: true, ...payload });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || "read users failed" });
  }
});

app.put("/internal/admin/users", requireSuperAdmin, async (req, res) => {
  try {
    const normalized = normalizeWorkspaceUsersConfig(req.body || {});
    if (!normalized.users.length) {
      throw new Error("at least one user is required");
    }
    const duplicateUserId = normalized.users.find(
      (item, index) =>
        normalized.users.findIndex((subItem) => subItem.userId === item.userId) !== index,
    );
    if (duplicateUserId) {
      throw new Error(`duplicate userId: ${duplicateUserId.userId}`);
    }
    const payload = await writeWorkspaceUsersConfig(normalized);
    res.json({ ok: true, ...payload });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || "save users failed" });
  }
});

app.get("/internal/admin/config-params", requireSuperAdmin, async (req, res) => {
  try {
    const [payload, keys] = await Promise.all([
      readWorkspaceConfigParams({ createIfMissing: true }),
      collectConfigTemplateKeys(),
    ]);
    res.json({
      ok: true,
      values: payload.values || {},
      keys,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || "read config params failed" });
  }
});

app.put("/internal/admin/config-params", requireSuperAdmin, async (req, res) => {
  try {
    const payload = await writeWorkspaceConfigParams(req.body || {});
    await rebuildRuntimeConfig();
    const keys = await collectConfigTemplateKeys();
    res.json({
      ok: true,
      values: payload.values || {},
      keys,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || "save config params failed" });
  }
});

async function handleChat(req, res) {
  try {
    const {
      userId,
      sessionId,
      parentSessionId = "",
      parentDialogProcessId = "",
      message,
      attachments = [],
      config = {},
    } = req.body;
    if (!userId || !sessionId || !message)
      throw new Error("userId/sessionId/message required");
    const result = await bot.runSession({
      userId,
      sessionId,
      parentSessionId,
      parentDialogProcessId,
      caller: "user",
      message,
      attachments,
      runConfig: normalizeRunConfig(config),
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
}

app.get("/internal/session/:userId/:sessionId", async (req, res) => {
  try {
    const { userId, sessionId } = req.params;
    const result = await bot.session.getSessionData({
      userId,
      sessionId,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete("/internal/session/:userId/:sessionId", async (req, res) => {
  try {
    const { userId, sessionId } = req.params;
    const result = await bot.session.deleteSessionBranch({
      userId,
      sessionId,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || "delete session failed" });
  }
});

app.get("/internal/sessions/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const sessions = await bot.session.getAllSessionsData({ userId });
    res.json({ ok: true, userId, sessions });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

async function buildWorkspaceTree(
  rootPath,
  currentPath = "",
  depth = 0,
  maxDepth = 12,
) {
  if (depth > maxDepth) return [];
  const abs = currentPath ? safeJoin(rootPath, currentPath) : rootPath;
  const entries = (await readdir(abs, { withFileTypes: true }))
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  const nodes = [];
  for (const entry of entries) {
    const relPath = currentPath
      ? path.posix.join(currentPath, entry.name)
      : entry.name;
    const node = {
      label: entry.name,
      path: relPath,
      type: entry.isDirectory() ? "dir" : "file",
    };
    if (entry.isDirectory()) {
      node.children = await buildWorkspaceTree(
        rootPath,
        relPath,
        depth + 1,
        maxDepth,
      );
    }
    nodes.push(node);
  }
  return nodes;
}

app.get("/internal/workspace/tree/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const basePath = await bot.ensureUserWorkspace(userId);
    const tree = await buildWorkspaceTree(basePath);
    res.json({ ok: true, userId, root: basePath, tree });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/internal/workspace/reset/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const basePath = await bot.resetUserWorkspace(userId);
    res.json({ ok: true, userId, root: basePath });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || "reset workspace failed" });
  }
});

app.get("/internal/workspace/file/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const relPath = String(req.query.path || "");
    if (!relPath) throw new Error("path required");
    const basePath = await bot.ensureUserWorkspace(userId);
    const absPath = safeJoin(basePath, relPath);
    try {
      await access(absPath);
    } catch {
      throw new Error("file not found");
    }
    const st = await stat(absPath);
    if (!st.isFile()) throw new Error("path is not a file");
    const buf = await readFile(absPath);
    const isText = !buf.includes(0);
    const content = isText ? buf.toString("utf8") : "";
    res.json({ ok: true, path: relPath, isText, size: st.size, content });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.put("/internal/workspace/file/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const relPath = String(req.body?.path || "");
    const content = String(req.body?.content || "");
    if (!relPath) throw new Error("path required");
    const basePath = await bot.ensureUserWorkspace(userId);
    const absPath = safeJoin(basePath, relPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, content, "utf8");
    res.json({ ok: true, path: relPath });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/internal/workspace/download/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const relPath = String(req.query.path || "");
    if (!relPath) throw new Error("path required");
    const basePath = await bot.ensureUserWorkspace(userId);
    const absPath = safeJoin(basePath, relPath);
    try {
      await access(absPath);
    } catch {
      throw new Error("file not found");
    }
    const st = await stat(absPath);
    if (!st.isFile()) throw new Error("path is not a file");
    res.download(absPath, path.basename(relPath));
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/internal/attachment/:userId/:attachmentId", async (req, res) => {
  try {
    const { userId, attachmentId } = req.params;
    const attachment = await bot.getAttachmentById({ userId, attachmentId });
    if (!attachment) throw new Error("attachment not found");

    res.setHeader(
      "Content-Type",
      attachment.mimeType || "application/octet-stream",
    );
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(attachment.name || attachmentId)}"`,
    );
    res.sendFile(attachment.absolutePath);
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message || "not found" });
  }
});

app.post("/chat", handleChat);

app.get("/health", (_, res) => res.json({ ok: true }));

const server = createServer(app);
const wsServer = new WebSocketServer({ noServer: true });

function sendUpgradeError(socket, statusCode = 401, message = "Unauthorized") {
  if (!socket.writable) return;
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
  socket.destroy();
}

server.on("upgrade", (request, socket, head) => {
  let pathname = "";
  try {
    pathname = new URL(request.url || "", "http://localhost").pathname;
  } catch {
    sendUpgradeError(socket, 400, "Bad Request");
    return;
  }

  if (pathname !== "/chat/ws") {
    socket.destroy();
    return;
  }

  const authInfo = resolveAuthByApiKey(request);
  if (!authInfo) {
    sendUpgradeError(socket, 401, "missing or invalid apiKey");
    return;
  }
  request.auth = authInfo;

  wsServer.handleUpgrade(request, socket, head, (ws) => {
    wsServer.emit("connection", ws, request);
  });
});

wsServer.on("connection", (ws, request) => {
  const authInfo = request?.auth || null;
  let running = false;
  let currentAbortController = null;
  const pendingInteractionRequests = new Map();

  const sendEvent = (event, data = {}) => {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({ event, data }));
    } catch {
      // ignore socket send errors
    }
  };

  const rejectAllPendingInteractions = (error) => {
    for (const [, item] of pendingInteractionRequests.entries()) {
      try {
        item?.reject?.(error);
      } catch {
        // ignore reject failures
      }
      clearTimeout(item?.timer);
    }
    pendingInteractionRequests.clear();
  };

  const userInteractionBridge = {
    requestUserInteraction: ({ content = "", fields = [], dialogProcessId = "" } = {}) =>
      new Promise((resolve, reject) => {
        const requestId = randomBytes(12).toString("hex");
        const timeoutMs = 10 * 60 * 1000;
        const timer = setTimeout(() => {
          pendingInteractionRequests.delete(requestId);
          reject(new Error("user interaction timeout"));
        }, timeoutMs);

        pendingInteractionRequests.set(requestId, {
          resolve,
          reject,
          timer,
        });

        sendEvent("interaction_request", {
          requestId,
          content: String(content || ""),
          fields: Array.isArray(fields) ? fields : [],
          dialogProcessId: String(dialogProcessId || ""),
        });
      }),
  };

  ws.on("message", async (rawMessage) => {
    let abortSignal = null;
    try {
      const payload = JSON.parse(String(rawMessage || "{}"));
      const action = String(payload?.action || "").trim().toLowerCase();
      if (action === "interaction_response") {
        const requestId = String(payload?.requestId || "").trim();
        const requestItem = pendingInteractionRequests.get(requestId);
        if (!requestItem) {
          sendEvent("error", { error: "interaction request not found" });
          return;
        }
        pendingInteractionRequests.delete(requestId);
        clearTimeout(requestItem.timer);
        requestItem.resolve(payload?.response ?? {});
        return;
      }
      if (action === "stop") {
        if (running && currentAbortController) {
          currentAbortController.abort();
        }
        rejectAllPendingInteractions(new Error("dialog stopped by user"));
        return;
      }
      if (running) {
        sendEvent("error", { error: "session already running on this websocket" });
        return;
      }
      running = true;
      currentAbortController = new AbortController();
      abortSignal = currentAbortController.signal;

      const {
        userId,
        sessionId,
        parentSessionId = "",
        parentDialogProcessId = "",
        message,
        attachments = [],
        config = {},
      } = payload || {};

      if (!userId || !sessionId || !message) {
        throw new Error("userId/sessionId/message required");
      }
      if (isForbiddenUserScope(authInfo, userId)) {
        throw new Error("forbidden user scope");
      }

      const eventListener = {
        onEvent: (evt) => {
          const event = evt?.event || "thinking";
          const data = evt?.data || {};
          if (event === "llm_delta") {
            if (data?.subAgentCall) {
              const normalized = normalizeSseLogEvent({
                ...evt,
                event: "subagent_llm_delta",
                data: {
                  ...data,
                  category: "system",
                  type: "subagent_delta",
                  event: "subagent_delta",
                  text: String(data.text || ""),
                },
              });
              sendEvent(normalized.event, normalized.data);
              return;
            }
            sendEvent("delta", { text: String(data.text || "") });
            return;
          }
          const normalized = normalizeSseLogEvent(evt);
          sendEvent(normalized.event, normalized.data);
        },
      };

      const result = await bot.runSession({
        userId,
        sessionId,
        parentSessionId,
        parentDialogProcessId,
        caller: "user",
        message,
        attachments,
        eventListener,
        abortSignal,
        userInteractionBridge,
        runConfig: normalizeRunConfig(config),
      });

      if (abortSignal?.aborted) {
        sendEvent("stopped", { message: "dialog stopped by user" });
        ws.close(1000, "stopped");
        return;
      }

      sendEvent("done", {
        sessionId: result.sessionId,
        answer: result.answer,
        dialogProcessId: result.dialogProcessId || "",
        messages: result.messages || [],
        traces: result.traces || [],
        executionLogs: result.executionLogs || [],
      });
      ws.close(1000, "done");
    } catch (err) {
      if (abortSignal?.aborted) {
        sendEvent("stopped", { message: "dialog stopped by user" });
        ws.close(1000, "stopped");
        return;
      }
      sendEvent("error", { error: err.message || "unknown error" });
      ws.close(1011, "error");
    } finally {
      running = false;
      currentAbortController = null;
    }
  });

  ws.on("close", () => {
    if (currentAbortController) {
      currentAbortController.abort();
    }
    rejectAllPendingInteractions(new Error("websocket closed"));
  });
});

const port = process.env.PORT || 10061;
server.listen(port, () => {
  console.log(`Agent server running on :${port}`);
});
