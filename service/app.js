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
import {
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
  pickLocaleText,
  DEFAULT_LOCALE,
} from "./system-core/i18n/index.js";
import { BACKEND_I18N } from "./system-core/i18n/backend-messages.js";
import {
  getConnectorChannelStore,
  initConnectorChannelStore,
} from "./system-core/connectors/channel-store.js";
import {
  getConnectorHistoryStore,
  initConnectorHistoryStore,
} from "./system-core/connectors/history-store.js";
import {
  decryptPayloadBySessionId,
} from "./system-core/utils/session-crypto.js";

const app = express();
app.use(express.json({ limit: "20mb" }));

function resolveRequestLocale(req = {}, fallbackLocale = DEFAULT_LOCALE) {
  const headerLocale = String(req?.headers?.["x-noobot-locale"] || "").trim();
  if (headerLocale) return normalizeLocale(headerLocale);
  const queryLocale = String(req?.query?.locale || "").trim();
  if (queryLocale) return normalizeLocale(queryLocale);
  const bodyLocale = String(req?.body?.locale || "").trim();
  if (bodyLocale) return normalizeLocale(bodyLocale);
  const acceptLanguage = String(req?.headers?.["accept-language"] || "").trim();
  if (acceptLanguage) return resolveLocaleFromAcceptLanguage(acceptLanguage);
  return normalizeLocale(fallbackLocale);
}

function bt(key = "", locale = DEFAULT_LOCALE) {
  return pickLocaleText({
    locale,
    dict: BACKEND_I18N,
    key,
    fallbackLocale: DEFAULT_LOCALE,
  });
}

app.use((req, _res, next) => {
  req.locale = resolveRequestLocale(req, DEFAULT_LOCALE);
  next();
});

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

function userConfigParamsFilePath(userId = "") {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) throw new Error("userId required");
  return path.join(workspaceRootPath(), normalizedUserId, CONFIG_PARAMS_FILE_NAME);
}

function normalizeConfigParams(input = {}) {
  const rawValues = input?.values && typeof input.values === "object" ? input.values : {};
  const rawDescriptions =
    input?.descriptions && typeof input.descriptions === "object"
      ? input.descriptions
      : {};
  const values = Object.fromEntries(
    Object.entries(rawValues)
      .map(([key, value]) => [String(key || "").trim(), String(value ?? "").trim()])
      .filter(([key]) => Boolean(key)),
  );
  const descriptions = Object.fromEntries(
    Object.entries(rawDescriptions)
      .map(([key, value]) => [String(key || "").trim(), String(value ?? "").trim()])
      .filter(([key]) => Boolean(key)),
  );
  return { values, descriptions };
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

async function readUserConfigParams({ userId = "", createIfMissing = false } = {}) {
  const filePath = userConfigParamsFilePath(userId);
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return normalizeConfigParams(parsed);
  } catch {
    if (!createIfMissing) return normalizeConfigParams({});
    const payload = normalizeConfigParams({});
    await writeUserConfigParams({ userId, input: payload });
    return payload;
  }
}

async function writeUserConfigParams({ userId = "", input = {} } = {}) {
  const payload = normalizeConfigParams(input);
  const filePath = userConfigParamsFilePath(userId);
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

async function collectUserConfigTemplateKeys(userId = "") {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return [];
  const userConfigFile = path.join(workspaceRootPath(), normalizedUserId, "config.json");
  const [globalCfgJson, userCfgJson] = await Promise.all([
    readConfigJsonIfExists(path.resolve(process.cwd(), "./config/global.config.json")),
    readConfigJsonIfExists(userConfigFile),
  ]);
  const keys = new Set();
  collectTemplateKeysFromObject(globalCfgJson, keys);
  collectTemplateKeysFromObject(userCfgJson, keys);
  return Array.from(keys).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

async function collectConfigTemplateParamCatalog() {
  const payload = await readWorkspaceConfigParams({ createIfMissing: true });
  const allKeys = Object.keys(payload?.values || {})
    .concat(Object.keys(payload?.descriptions || {}))
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const dedupedKeys = Array.from(new Set(allKeys)).sort((a, b) =>
    a.localeCompare(b),
  );
  const descriptionMap = payload?.descriptions || {};
  return dedupedKeys.map((key) => ({
    key,
    description: String(descriptionMap?.[key] || "").trim(),
  }));
}

function buildConfigParamCatalog({
  keys = [],
  descriptions = {},
  values = {},
  extraKeys = [],
} = {}) {
  const mergedKeys = Array.from(
    new Set(
      [
        ...(Array.isArray(keys) ? keys : []),
        ...Object.keys(descriptions || {}),
        ...Object.keys(values || {}),
        ...(Array.isArray(extraKeys) ? extraKeys : []),
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
  return mergedKeys.map((key) => ({
    key,
    description: String(descriptions?.[key] || "").trim(),
  }));
}

function templateRootPath() {
  return path.resolve(
    process.cwd(),
    String(globalConfigRaw?.workspaceTemplatePath || "../user-template/default-user"),
  );
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
  initConnectorHistoryStore({ workspaceRoot: workspaceRootPath() });
}

await rebuildRuntimeConfig();
initConnectorChannelStore();
initConnectorHistoryStore({ workspaceRoot: workspaceRootPath() });

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
    res.status(401).json({ ok: false, error: bt("auth.missingApiKey", req.locale) });
    return;
  }
  req.auth = authInfo;
  const requestUserId =
    String(req.params?.userId || "").trim() ||
    String(req.body?.userId || "").trim() ||
    String(req.query?.userId || "").trim();
  if (isForbiddenUserScope(authInfo, requestUserId)) {
    res.status(403).json({ ok: false, error: bt("auth.forbiddenUserScope", req.locale) });
    return;
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  const authInfo = req.auth || null;
  if (String(authInfo?.role || "") !== "super_admin") {
    res.status(403).json({ ok: false, error: bt("auth.superAdminRequired", req.locale) });
    return;
  }
  next();
}

function normalizeSelectedConnectors(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const normalizeConnectorName = (value = "") => String(value || "").trim();
  return {
    database: normalizeConnectorName(source?.database),
    terminal: normalizeConnectorName(source?.terminal),
    email: normalizeConnectorName(source?.email),
  };
}

function normalizeRunConfig(input = {}) {
  const allowUserInteractionRaw = input?.allowUserInteraction;
  const allowUserInteraction =
    allowUserInteractionRaw === undefined
      ? true
      : Boolean(allowUserInteractionRaw);
  const locale = normalizeLocale(input?.locale || DEFAULT_LOCALE);
  return {
    allowUserInteraction,
    locale,
    selectedConnectors: normalizeSelectedConnectors(input?.selectedConnectors),
  };
}

function normalizeHistoryConnectorItems(items = [], locale = DEFAULT_LOCALE) {
  return (Array.isArray(items) ? items : []).map((connectorItem) => ({
    connector_name: String(connectorItem?.connector_name || "").trim(),
    connector_type: String(connectorItem?.connector_type || "").trim(),
    connected_at: String(connectorItem?.last_connected_at || "").trim(),
    connection_meta:
      connectorItem?.connection_meta && typeof connectorItem.connection_meta === "object"
        ? connectorItem.connection_meta
        : {},
    status: String(connectorItem?.status || "disconnected").trim() || "disconnected",
    status_code: Number(connectorItem?.status_code ?? 410),
    status_message:
      String(connectorItem?.status_message || "").trim() ||
      bt("status.disconnectedFromHistory", locale),
    checked_at:
      String(connectorItem?.checked_at || connectorItem?.last_connected_at || "").trim(),
    last_connected_at: String(connectorItem?.last_connected_at || "").trim(),
    connect_count: Number(connectorItem?.connect_count || 0),
    connection_defaults:
      connectorItem?.connection_defaults &&
      typeof connectorItem.connection_defaults === "object"
        ? connectorItem.connection_defaults
        : {},
  }));
}

function mergeRuntimeAndHistoryConnectorGroup({
  runtimeConnectors = [],
  historyConnectors = [],
  locale = DEFAULT_LOCALE,
} = {}) {
  const runtimeList = Array.isArray(runtimeConnectors) ? runtimeConnectors : [];
  const historyList = normalizeHistoryConnectorItems(historyConnectors, locale);
  const mergedByName = new Map();
  for (const historyItem of historyList) {
    const connectorName = String(historyItem?.connector_name || "").trim();
    if (!connectorName) continue;
    mergedByName.set(connectorName, historyItem);
  }
  for (const runtimeItem of runtimeList) {
    const connectorName = String(runtimeItem?.connector_name || "").trim();
    if (!connectorName) continue;
    const previousItem = mergedByName.get(connectorName) || {};
    mergedByName.set(connectorName, {
      ...previousItem,
      ...runtimeItem,
      status: String(runtimeItem?.status || "connected").trim() || "connected",
      status_code: Number(runtimeItem?.status_code ?? 0),
      status_message: String(runtimeItem?.status_message || "ok").trim(),
      checked_at:
        String(runtimeItem?.checked_at || runtimeItem?.connected_at || "").trim() ||
        String(previousItem?.checked_at || "").trim(),
      last_connected_at:
        String(runtimeItem?.connected_at || "").trim() ||
        String(previousItem?.last_connected_at || "").trim(),
    });
  }
  return Array.from(mergedByName.values()).sort((leftConnector, rightConnector) => {
    const leftTime = new Date(
      leftConnector?.last_connected_at || leftConnector?.checked_at || 0,
    ).getTime();
    const rightTime = new Date(
      rightConnector?.last_connected_at || rightConnector?.checked_at || 0,
    ).getTime();
    return rightTime - leftTime;
  });
}

app.post("/internal/connect", async (req, res) => {
  try {
    const userId = String(req.body?.userId || "").trim();
    const connectCode = String(req.body?.connectCode || "").trim();
    if (!userId || !connectCode) {
      throw new Error(bt("connect.userIdConnectCodeRequired", req.locale));
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
    if (!matchedUser) throw new Error(bt("connect.codeVerifyFailed", req.locale));

    await bot.ensureUserWorkspace(userId);
    const apiKey = issueApiKey({ userId, role: "user" });
    res.json({ ok: true, role: "user", userId, apiKey });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || bt("connect.failed", req.locale) });
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
    res.status(400).json({ ok: false, error: err.message || bt("common.readUsersFailed", req.locale) });
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
    res.status(400).json({ ok: false, error: err.message || bt("common.saveUsersFailed", req.locale) });
  }
});

function resolveConfigParamScope(req) {
  const scope = String(req.query?.scope || req.body?.scope || "user")
    .trim()
    .toLowerCase();
  return scope === "system" ? "system" : "user";
}

async function readScopedConfigParams({ req, createIfMissing = true } = {}) {
  const scope = resolveConfigParamScope(req);
  if (scope === "system") {
    const payload = await readWorkspaceConfigParams({ createIfMissing });
    return { scope, userId: "", payload };
  }
  const userId = String(req?.auth?.userId || "").trim();
  if (!userId) throw new Error("missing user auth");
  const payload = await readUserConfigParams({ userId, createIfMissing });
  return { scope, userId, payload };
}

async function writeScopedConfigParams({
  req,
  values = undefined,
  descriptions = undefined,
} = {}) {
  const { scope, userId, payload: existing } = await readScopedConfigParams({
    req,
    createIfMissing: true,
  });
  const nextPayload = {
    values:
      values && typeof values === "object" ? values : existing?.values || {},
    descriptions:
      descriptions && typeof descriptions === "object"
        ? descriptions
        : existing?.descriptions || {},
  };
  if (scope === "system") {
    const payload = await writeWorkspaceConfigParams(nextPayload);
    return { scope, userId: "", payload };
  }
  const payload = await writeUserConfigParams({ userId, input: nextPayload });
  return { scope, userId, payload };
}

async function buildScopedConfigParamsResponse({ req, payload = {}, userId = "" } = {}) {
  const scope = resolveConfigParamScope(req);
  const keys =
    scope === "system"
      ? await collectConfigTemplateKeys()
      : await collectUserConfigTemplateKeys(userId);
  const catalog = buildConfigParamCatalog({
    keys,
    descriptions: payload?.descriptions || {},
    values: payload?.values || {},
  });
  return {
    ok: true,
    scope,
    userId: String(userId || "").trim(),
    values: payload.values || {},
    descriptions: payload.descriptions || {},
    keys,
    catalog,
  };
}

app.get("/internal/config-params", async (req, res) => {
  try {
    const scope = resolveConfigParamScope(req);
    if (scope === "system" && String(req?.auth?.role || "") !== "super_admin") {
      res.status(403).json({
        ok: false,
        error: bt("common.superAdminRequiredForSystemParams", req.locale),
      });
      return;
    }
    const { payload, userId } = await readScopedConfigParams({
      req,
      createIfMissing: true,
    });
    res.json(await buildScopedConfigParamsResponse({ req, payload, userId }));
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.readConfigParamsFailed", req.locale),
    });
  }
});

app.put("/internal/config-params", async (req, res) => {
  try {
    const scope = resolveConfigParamScope(req);
    if (scope === "system" && String(req?.auth?.role || "") !== "super_admin") {
      res.status(403).json({
        ok: false,
        error: bt("common.superAdminRequiredForSystemParams", req.locale),
      });
      return;
    }
    const incoming = req.body || {};
    const { payload, userId } = await writeScopedConfigParams({
      req,
      values:
        incoming?.values && typeof incoming.values === "object" ? incoming.values : undefined,
      descriptions:
        incoming?.descriptions && typeof incoming.descriptions === "object"
          ? incoming.descriptions
          : undefined,
    });
    if (scope === "system") await rebuildRuntimeConfig();
    res.json(await buildScopedConfigParamsResponse({ req, payload, userId }));
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.saveConfigParamsFailed", req.locale),
    });
  }
});

app.get("/internal/config-params/catalog", async (req, res) => {
  try {
    const scope = resolveConfigParamScope(req);
    let payload = normalizeConfigParams({});
    if (scope === "system") {
      payload = await readWorkspaceConfigParams({ createIfMissing: true });
    } else {
      const userId = String(req?.auth?.userId || "").trim();
      payload = await readUserConfigParams({ userId, createIfMissing: true });
    }
    const keys =
      scope === "system"
        ? await collectConfigTemplateKeys()
        : await collectUserConfigTemplateKeys(String(req?.auth?.userId || "").trim());
    const catalog = buildConfigParamCatalog({
      keys,
      descriptions: payload?.descriptions || {},
      values: payload?.values || {},
    });
    res.json({ ok: true, scope, catalog });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.loadConfigParamsCatalogFailed", req.locale),
    });
  }
});

app.get("/internal/admin/config-params", requireSuperAdmin, async (req, res) => {
  try {
    req.query = { ...(req.query || {}), scope: "system" };
    const { payload } = await readScopedConfigParams({ req, createIfMissing: true });
    res.json(await buildScopedConfigParamsResponse({ req, payload }));
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.readConfigParamsFailed", req.locale),
    });
  }
});

app.put("/internal/admin/config-params", requireSuperAdmin, async (req, res) => {
  try {
    req.query = { ...(req.query || {}), scope: "system" };
    const incoming = req.body || {};
    const { payload } = await writeScopedConfigParams({
      req,
      values: incoming?.values,
      descriptions: incoming?.descriptions,
    });
    await rebuildRuntimeConfig();
    res.json(await buildScopedConfigParamsResponse({ req, payload }));
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.saveConfigParamsFailed", req.locale),
    });
  }
});

app.get("/internal/admin/template/tree", requireSuperAdmin, async (req, res) => {
  try {
    const root = templateRootPath();
    await mkdir(root, { recursive: true });
    const tree = await buildWorkspaceTree(root);
    res.json({ ok: true, root, tree });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.loadTemplateTreeFailed", req.locale),
    });
  }
});

app.get("/internal/admin/template/file", requireSuperAdmin, async (req, res) => {
  try {
    const relPath = String(req.query.path || "");
    if (!relPath) throw new Error(bt("common.pathRequired", req.locale));
    const root = templateRootPath();
    const absPath = safeJoin(root, relPath);
    await access(absPath);
    const st = await stat(absPath);
    if (!st.isFile()) throw new Error(bt("common.pathIsNotFile", req.locale));
    const buf = await readFile(absPath);
    const isText = !buf.includes(0);
    const content = isText ? buf.toString("utf8") : "";
    res.json({ ok: true, path: relPath, isText, size: st.size, content });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.readTemplateFileFailed", req.locale),
    });
  }
});

app.put("/internal/admin/template/file", requireSuperAdmin, async (req, res) => {
  try {
    const relPath = String(req.body?.path || "");
    const content = String(req.body?.content || "");
    if (!relPath) throw new Error(bt("common.pathRequired", req.locale));
    const root = templateRootPath();
    const absPath = safeJoin(root, relPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, content, "utf8");
    res.json({ ok: true, path: relPath });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.saveTemplateFileFailed", req.locale),
    });
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
      throw new Error(bt("common.userSessionMessageRequired", req.locale));
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
    const normalizedSessionId = String(sessionId || "").trim();
    const rootSessionId = await bot.session.getRootSessionId({
      userId,
      sessionId: normalizedSessionId,
    });
    let releasedConnectors = {
      released: false,
      sessionId: String(rootSessionId || "").trim(),
      releasedCounts: { databases: 0, terminals: 0, emails: 0, total: 0 },
    };
    const shouldReleaseRootConnectors =
      normalizedSessionId && rootSessionId && normalizedSessionId === rootSessionId;
    if (shouldReleaseRootConnectors) {
      const connectorChannelStore = getConnectorChannelStore();
      if (
        connectorChannelStore &&
        typeof connectorChannelStore.releaseSessionConnectors === "function"
      ) {
        releasedConnectors = connectorChannelStore.releaseSessionConnectors(
          rootSessionId,
        );
      }
    }
    const result = await bot.session.deleteSessionBranch({
      userId,
      sessionId,
    });
    let deletedConnectorHistory = false;
    if (shouldReleaseRootConnectors) {
      const connectorHistoryStore = getConnectorHistoryStore();
      if (
        connectorHistoryStore &&
        typeof connectorHistoryStore.deleteSessionHistory === "function"
      ) {
        deletedConnectorHistory = await connectorHistoryStore.deleteSessionHistory({
          userId,
          sessionId: rootSessionId,
        });
      }
    }
    res.json({
      ok: true,
      ...result,
      releasedConnectors,
      deletedConnectorHistory,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.deleteSessionFailed", req.locale),
    });
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

app.get("/internal/connectors/:userId/:sessionId", async (req, res) => {
  try {
    const { userId, sessionId } = req.params;
    const rootSessionId = await bot.session.getRootSessionId({ userId, sessionId });
    const connectorChannelStore = getConnectorChannelStore();
    const connectorHistoryStore = getConnectorHistoryStore();
    const inspectedConnectors = await connectorChannelStore.inspectSessionConnectors({
      sessionId: rootSessionId,
      timeoutMs: 6000,
    });
    const historyConnectors =
      connectorHistoryStore &&
      typeof connectorHistoryStore.listSessionConnectors === "function"
        ? await connectorHistoryStore.listSessionConnectors({
            userId,
            sessionId: rootSessionId,
          })
        : { database: [], terminal: [], email: [] };
    const mergedDatabases = mergeRuntimeAndHistoryConnectorGroup({
      runtimeConnectors: inspectedConnectors?.connectors?.databases || [],
      historyConnectors: historyConnectors?.database || [],
      locale: req.locale,
    });
    const mergedTerminals = mergeRuntimeAndHistoryConnectorGroup({
      runtimeConnectors: inspectedConnectors?.connectors?.terminals || [],
      historyConnectors: historyConnectors?.terminal || [],
      locale: req.locale,
    });
    const mergedEmails = mergeRuntimeAndHistoryConnectorGroup({
      runtimeConnectors: inspectedConnectors?.connectors?.emails || [],
      historyConnectors: historyConnectors?.email || [],
      locale: req.locale,
    });
    const allMergedConnectors = [
      ...mergedDatabases,
      ...mergedTerminals,
      ...mergedEmails,
    ];
    const selectedConnectors = await bot.session.getRootSessionSelectedConnectors({
      userId,
      sessionId: rootSessionId || sessionId,
    });
    res.json({
      ok: true,
      userId,
      sessionId,
      rootSessionId,
      connectors: {
        databases: mergedDatabases,
        terminals: mergedTerminals,
        emails: mergedEmails,
      },
      summary: {
        total_count: allMergedConnectors.length,
        connected_count: allMergedConnectors.filter(
          (connectorItem) => String(connectorItem?.status || "") === "connected",
        ).length,
        error_count: allMergedConnectors.filter(
          (connectorItem) => String(connectorItem?.status || "") === "error",
        ).length,
        unknown_count: allMergedConnectors.filter(
          (connectorItem) => String(connectorItem?.status || "") === "unknown",
        ).length,
      },
      selectedConnectors,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.getConnectorsFailed", req.locale),
    });
  }
});

app.put("/internal/connectors/:userId/:sessionId/selection", async (req, res) => {
  try {
    const { userId, sessionId } = req.params;
    const selectedConnectors = normalizeSelectedConnectors(
      req.body?.selectedConnectors,
    );
    const rootSessionId = await bot.session.getRootSessionId({ userId, sessionId });
    const savedSelectedConnectors = await bot.session.setRootSessionSelectedConnectors({
      userId,
      sessionId: rootSessionId || sessionId,
      selectedConnectors,
    });
    res.json({
      ok: true,
      userId,
      sessionId,
      rootSessionId,
      selectedConnectors: savedSelectedConnectors,
    });
  } catch (err) {
    res
      .status(400)
      .json({
        ok: false,
        error: err.message || bt("common.saveSelectedConnectorsFailed", req.locale),
      });
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
    .filter((dirEntry) => !dirEntry.name.startsWith("."))
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
    const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
    const basePath = await bot.resetUserWorkspace(userId, { sections });
    res.json({
      ok: true,
      userId,
      root: basePath,
      sections,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.resetWorkspaceFailed", req.locale),
    });
  }
});

app.post("/internal/workspace/sync/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const basePath = await bot.syncUserWorkspace(userId);
    res.json({ ok: true, userId, root: basePath });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.syncWorkspaceFailed", req.locale),
    });
  }
});

app.post("/internal/admin/workspace-all/sync", requireSuperAdmin, async (req, res) => {
  try {
    const root = workspaceRootPath();
    await mkdir(root, { recursive: true });
    const entries = await readdir(root, { withFileTypes: true });
    const userDirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => String(entry.name || "").trim())
      .filter(Boolean);
    const superAdminUserId = String(globalConfig?.superAdmin?.userId || "").trim();
    if (superAdminUserId && !userDirs.includes(superAdminUserId)) {
      userDirs.push(superAdminUserId);
    }
    const syncedUsers = [];
    for (const userId of userDirs) {
      try {
        await bot.syncUserWorkspace(userId);
        syncedUsers.push(userId);
      } catch {
        // ignore single-user sync error, continue syncing others
      }
    }
    res.json({
      ok: true,
      syncedUsers,
      total: userDirs.length,
      success: syncedUsers.length,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.syncAllWorkspaceFailed", req.locale),
    });
  }
});

app.post("/internal/admin/workspace-all/reset", requireSuperAdmin, async (req, res) => {
  try {
    const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
    const root = workspaceRootPath();
    await mkdir(root, { recursive: true });
    const entries = await readdir(root, { withFileTypes: true });
    const userDirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => String(entry.name || "").trim())
      .filter(Boolean);
    const superAdminUserId = String(globalConfig?.superAdmin?.userId || "").trim();
    if (superAdminUserId && !userDirs.includes(superAdminUserId)) {
      userDirs.push(superAdminUserId);
    }
    const resetUsers = [];
    for (const userId of userDirs) {
      try {
        await bot.resetUserWorkspace(userId, { sections });
        resetUsers.push(userId);
      } catch {
        // ignore single-user failure and continue
      }
    }
    res.json({
      ok: true,
      resetUsers,
      total: userDirs.length,
      success: resetUsers.length,
      sections,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.resetAllWorkspaceFailed", req.locale),
    });
  }
});

app.get("/internal/workspace/file/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const relPath = String(req.query.path || "");
    if (!relPath) throw new Error(bt("common.pathRequired", req.locale));
    const basePath = await bot.ensureUserWorkspace(userId);
    const absPath = safeJoin(basePath, relPath);
    try {
      await access(absPath);
    } catch {
      throw new Error(bt("common.fileNotFound", req.locale));
    }
    const st = await stat(absPath);
    if (!st.isFile()) throw new Error(bt("common.pathIsNotFile", req.locale));
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
    if (!relPath) throw new Error(bt("common.pathRequired", req.locale));
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
    if (!relPath) throw new Error(bt("common.pathRequired", req.locale));
    const basePath = await bot.ensureUserWorkspace(userId);
    const absPath = safeJoin(basePath, relPath);
    try {
      await access(absPath);
    } catch {
      throw new Error(bt("common.fileNotFound", req.locale));
    }
    const st = await stat(absPath);
    if (!st.isFile()) throw new Error(bt("common.pathIsNotFile", req.locale));
    res.download(absPath, path.basename(relPath));
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/internal/admin/workspace-all/tree", requireSuperAdmin, async (req, res) => {
  try {
    const root = workspaceRootPath();
    await mkdir(root, { recursive: true });
    const tree = await buildWorkspaceTree(root);
    res.json({ ok: true, root, tree });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.loadWorkspaceTreeFailed", req.locale),
    });
  }
});

app.get("/internal/admin/workspace-all/file", requireSuperAdmin, async (req, res) => {
  try {
    const relPath = String(req.query.path || "");
    if (!relPath) throw new Error(bt("common.pathRequired", req.locale));
    const root = workspaceRootPath();
    const absPath = safeJoin(root, relPath);
    await access(absPath);
    const st = await stat(absPath);
    if (!st.isFile()) throw new Error(bt("common.pathIsNotFile", req.locale));
    const buf = await readFile(absPath);
    const isText = !buf.includes(0);
    const content = isText ? buf.toString("utf8") : "";
    res.json({ ok: true, path: relPath, isText, size: st.size, content });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.readWorkspaceFileFailed", req.locale),
    });
  }
});

app.put("/internal/admin/workspace-all/file", requireSuperAdmin, async (req, res) => {
  try {
    const relPath = String(req.body?.path || "");
    const content = String(req.body?.content || "");
    if (!relPath) throw new Error(bt("common.pathRequired", req.locale));
    const root = workspaceRootPath();
    const absPath = safeJoin(root, relPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, content, "utf8");
    res.json({ ok: true, path: relPath });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.saveWorkspaceFileFailed", req.locale),
    });
  }
});

app.get("/internal/admin/workspace-all/download", requireSuperAdmin, async (req, res) => {
  try {
    const relPath = String(req.query.path || "");
    if (!relPath) throw new Error(bt("common.pathRequired", req.locale));
    const root = workspaceRootPath();
    const absPath = safeJoin(root, relPath);
    await access(absPath);
    const st = await stat(absPath);
    if (!st.isFile()) throw new Error(bt("common.pathIsNotFile", req.locale));
    res.download(absPath, path.basename(relPath));
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || bt("common.downloadWorkspaceFileFailed", req.locale),
    });
  }
});

app.get("/internal/attachment/:userId/:attachmentId", async (req, res) => {
  try {
    const { userId, attachmentId } = req.params;
    const sessionId = String(req.query?.sessionId || "").trim();
    const attachmentSource = String(req.query?.attachmentSource || "").trim();
    const attachment = await bot.getAttachmentById({
      userId,
      attachmentId,
      sessionId,
      attachmentSource,
    });
    if (!attachment) throw new Error(bt("common.attachmentNotFound", req.locale));

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
    res.status(404).json({ ok: false, error: err.message || bt("common.notFound", req.locale) });
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
  const requestLocale = resolveRequestLocale(request, DEFAULT_LOCALE);
  let pathname = "";
  try {
    pathname = new URL(request.url || "", "http://localhost").pathname;
  } catch {
    sendUpgradeError(socket, 400, bt("ws.badRequest", requestLocale));
    return;
  }

  if (pathname !== "/chat/ws") {
    socket.destroy();
    return;
  }

  const authInfo = resolveAuthByApiKey(request);
  if (!authInfo) {
    sendUpgradeError(socket, 401, bt("auth.missingApiKey", requestLocale));
    return;
  }
  request.auth = authInfo;
  request.locale = requestLocale;

  wsServer.handleUpgrade(request, socket, head, (ws) => {
    wsServer.emit("connection", ws, request);
  });
});

wsServer.on("connection", (ws, request) => {
  const authInfo = request?.auth || null;
  let currentLocale = normalizeLocale(request?.locale || DEFAULT_LOCALE);
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
    requestUserInteraction: ({
      content = "",
      fields = [],
      dialogProcessId = "",
      requireEncryption = false,
      sessionId = "",
      toolName = "",
      needConnectionInfo = false,
      connectorName = "",
      connectorType = "",
      interactionType = "",
      interactionData = {},
    } = {}) =>
      new Promise((resolve, reject) => {
        const requestId = randomBytes(12).toString("hex");
        const timeoutMs = 10 * 60 * 1000;
        const timer = setTimeout(() => {
          pendingInteractionRequests.delete(requestId);
          reject(new Error(bt("ws.userInteractionTimeout", currentLocale)));
        }, timeoutMs);

        pendingInteractionRequests.set(requestId, {
          resolve,
          reject,
          timer,
          requireEncryption: Boolean(requireEncryption),
          sessionId: String(sessionId || "").trim(),
        });

        sendEvent("interaction_request", {
          requestId,
          content: String(content || ""),
          fields: Array.isArray(fields) ? fields : [],
          dialogProcessId: String(dialogProcessId || ""),
          requireEncryption: Boolean(requireEncryption),
          sessionId: String(sessionId || "").trim(),
          toolName: String(toolName || "").trim(),
          needConnectionInfo: Boolean(needConnectionInfo),
          connectorName: String(connectorName || "").trim(),
          connectorType: String(connectorType || "").trim(),
          interactionType: String(interactionType || "").trim(),
          interactionData:
            interactionData && typeof interactionData === "object"
              ? interactionData
              : {},
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
          sendEvent("error", { error: bt("ws.interactionNotFound", currentLocale) });
          return;
        }
        pendingInteractionRequests.delete(requestId);
        clearTimeout(requestItem.timer);
        let normalizedResponse = payload?.response ?? {};
        if (requestItem?.requireEncryption) {
          const encryptedPayload = normalizedResponse?.payload;
          const encryptedFlag = normalizedResponse?.encrypted === true;
          const sid = String(requestItem?.sessionId || "").trim();
          if (!encryptedFlag || !String(encryptedPayload || "").trim() || !sid) {
            throw new Error(bt("ws.interactionEncryptedRequired", currentLocale));
          }
          normalizedResponse = decryptPayloadBySessionId(
            String(encryptedPayload || ""),
            sid,
          );
        }
        requestItem.resolve(normalizedResponse);
        return;
      }
      if (action === "stop") {
        if (running && currentAbortController) {
          currentAbortController.abort();
        }
        rejectAllPendingInteractions(new Error(bt("ws.dialogStoppedByUser", currentLocale)));
        sendEvent("stopped", { message: bt("ws.dialogStoppedByUser", currentLocale) });
        ws.close(1000, "stopped");
        return;
      }
      if (running) {
        sendEvent("error", { error: bt("ws.sessionAlreadyRunning", currentLocale) });
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
      currentLocale = normalizeLocale(config?.locale || currentLocale);

      if (!userId || !sessionId || !message) {
        throw new Error(bt("ws.userSessionMessageRequired", currentLocale));
      }
      if (isForbiddenUserScope(authInfo, userId)) {
        throw new Error(bt("auth.forbiddenUserScope", currentLocale));
      }

      const eventListener = {
        onEvent: (evt) => {
          const event = evt?.event || "thinking";
          const data = evt?.data || {};
          if (event === "llm_delta") {
            const currentEventSessionId = String(data?.sessionId || "").trim();
            const currentSubAgentSessionId = String(
              data?.subAgentSessionId || "",
            ).trim();
            const rootSessionId = String(sessionId || "").trim();
            const isSubTaskDelta =
              data?.subAgentCall ||
              (currentSubAgentSessionId &&
                currentSubAgentSessionId !== rootSessionId) ||
              (currentEventSessionId &&
                currentEventSessionId !== rootSessionId);
            if (isSubTaskDelta) {
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
        sendEvent("stopped", { message: bt("ws.dialogStoppedByUser", currentLocale) });
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
        sendEvent("stopped", { message: bt("ws.dialogStoppedByUser", currentLocale) });
        ws.close(1000, "stopped");
        return;
      }
      sendEvent("error", { error: err.message || bt("ws.unknownError", currentLocale) });
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
    rejectAllPendingInteractions(new Error(bt("ws.socketClosed", currentLocale)));
  });
});

const port = process.env.PORT || 10061;
server.listen(port, () => {
  console.log(`Agent server running on :${port}`);
});
