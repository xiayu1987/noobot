/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import "dotenv/config";
import express from "express";
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
import { loadGlobalConfig } from "./system-core/config/index.js";
import { normalizeSseLogEvent, sseWrite } from "./system-core/event/index.js";
import { safeJoin } from "./system-core/utils/fs-safe.js";

const app = express();
app.use(express.json({ limit: "20mb" }));

const globalConfig = loadGlobalConfig();
const bot = new BotManager(globalConfig);
const apiKeyStore = new Map();
const apiKeyTtlMs = Number(globalConfig?.auth?.apiKeyTtlMs || 24 * 60 * 60 * 1000);
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
  const queryApiKey = String(req.query?.apikey || "").trim();
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
  if (
    requestUserId &&
    authInfo.role !== "super_admin" &&
    String(authInfo.userId || "") !== requestUserId
  ) {
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
      bot.ensureUserWorkspace(userId);
      const apiKey = issueApiKey({ userId, role: "super_admin" });
      res.json({ ok: true, role: "super_admin", userId, apiKey });
      return;
    }

    const users = await readWorkspaceUsers();
    const matchedUser = users.find(
      (item) => item.userId === userId && item.connectCode === connectCode,
    );
    if (!matchedUser) throw new Error("连接码验证失败");

    bot.ensureUserWorkspace(userId);
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

async function handleChat(req, res) {
  try {
    const { userId, sessionId, parentSessionId = "", message, attachments = [] } = req.body;
    if (!userId || !sessionId || !message)
      throw new Error("userId/sessionId/message required");
    const result = await bot.runSession({
      userId,
      sessionId,
      parentSessionId,
      caller: "user",
      message,
      attachments,
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
    const basePath = bot.ensureUserWorkspace(userId);
    const tree = await buildWorkspaceTree(basePath);
    res.json({ ok: true, userId, root: basePath, tree });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/internal/workspace/file/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const relPath = String(req.query.path || "");
    if (!relPath) throw new Error("path required");
    const basePath = bot.ensureUserWorkspace(userId);
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
    const basePath = bot.ensureUserWorkspace(userId);
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
    const basePath = bot.ensureUserWorkspace(userId);
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

app.post("/chat/sse", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    const { userId, sessionId, parentSessionId = "", message, attachments = [] } = req.body || {};
    if (!userId || !sessionId || !message)
      throw new Error("userId/sessionId/message required");

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
            sseWrite(res, normalized.event, normalized.data);
            return;
          }
          sseWrite(res, "delta", { text: String(data.text || "") });
          return;
        }
        const normalized = normalizeSseLogEvent(evt);
        sseWrite(res, normalized.event, normalized.data);
      },
    };

    const result = await bot.runSession({
      userId,
      sessionId,
      parentSessionId,
      caller: "user",
      message,
      attachments,
      eventListener,
    });

    sseWrite(res, "done", {
      sessionId: result.sessionId,
      answer: result.answer,
      dialogProcessId: result.dialogProcessId || "",
      messages: result.messages || [],
      traces: result.traces || [],
      executionLogs: result.executionLogs || [],
    });
  } catch (err) {
    sseWrite(res, "error", { error: err.message || "unknown error" });
  } finally {
    res.end();
  }
});

app.get("/health", (_, res) => res.json({ ok: true }));

const port = process.env.PORT || 10061;
app.listen(port, () => {
  console.log(`Agent server running on :${port}`);
});
