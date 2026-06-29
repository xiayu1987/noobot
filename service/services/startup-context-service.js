/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";

const STARTUP_CONTEXT_ARG = "--startup-context";
const SCHEMA_VERSION = 1;

function normalizePath(value = "") {
  const text = String(value || "").trim();
  return text ? path.resolve(text) : "";
}

function resolveDefaultBackendRoot(cwd = process.cwd()) {
  const normalizedCwd = normalizePath(cwd) || process.cwd();
  if (path.basename(normalizedCwd) === "service") return path.dirname(normalizedCwd);
  return normalizedCwd;
}

function pickArgValue(argv = [], name = "") {
  const items = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < items.length; index += 1) {
    const item = String(items[index] || "");
    if (item === name) return String(items[index + 1] || "").trim();
    if (item.startsWith(`${name}=`)) return item.slice(name.length + 1).trim();
  }
  return "";
}

export function resolveStartupContextPath(argv = process.argv) {
  return normalizePath(pickArgValue(argv, STARTUP_CONTEXT_ARG));
}

export function normalizeStartupContext(input = {}, { cwd = process.cwd() } = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const paths = raw.paths && typeof raw.paths === "object" ? raw.paths : {};
  const service = raw.service && typeof raw.service === "object" ? raw.service : {};
  const runtime = raw.runtime && typeof raw.runtime === "object" ? raw.runtime : {};
  const app = raw.app && typeof raw.app === "object" ? raw.app : {};
  const backendRoot = normalizePath(paths.backendRoot || resolveDefaultBackendRoot(cwd));
  return {
    schemaVersion: Number(raw.schemaVersion || SCHEMA_VERSION),
    app: {
      name: String(app.name || "Noobot"),
      platform: String(app.platform || (process.env.NOOBOT_DESKTOP === "1" ? "desktop" : "web")),
      channel: String(app.channel || process.platform),
      packaged: Boolean(app.packaged),
    },
    paths: {
      backendRoot,
      frontendRoot: normalizePath(paths.frontendRoot),
      pluginRootDir: normalizePath(paths.pluginRootDir || path.join(backendRoot, "plugin")),
      userDataDir: normalizePath(paths.userDataDir),
      configDir: normalizePath(paths.configDir || process.env.NOOBOT_CONFIG_DIR),
      dataDir: normalizePath(paths.dataDir || process.env.NOOBOT_DATA_DIR),
      logDir: normalizePath(paths.logDir || process.env.NOOBOT_LOG_DIR),
      workspaceRoot: normalizePath(paths.workspaceRoot || process.env.NOOBOT_WORKSPACE_ROOT),
      workspaceTemplatePath: normalizePath(paths.workspaceTemplatePath || process.env.NOOBOT_WORKSPACE_TEMPLATE_PATH),
      globalConfigPath: normalizePath(paths.globalConfigPath || process.env.NOOBOT_GLOBAL_CONFIG_PATH),
    },
    service: {
      port: Number(service.port || process.env.PORT || 3000),
      origin: String(service.origin || ""),
    },
    runtime: {
      node: String(runtime.node || process.version),
      cwd: normalizePath(runtime.cwd || cwd),
      execPath: normalizePath(runtime.execPath || process.execPath),
      resourcesPath: normalizePath(runtime.resourcesPath),
    },
    createdAt: String(raw.createdAt || new Date().toISOString()),
  };
}

export function createDefaultStartupContext({ cwd = process.cwd() } = {}) {
  return normalizeStartupContext({
    app: { platform: process.env.NOOBOT_DESKTOP === "1" ? "desktop" : "web", channel: process.platform, packaged: false },
    paths: { backendRoot: resolveDefaultBackendRoot(cwd) },
  }, { cwd });
}

export async function loadStartupContext({ argv = process.argv, cwd = process.cwd() } = {}) {
  const startupContextPath = resolveStartupContextPath(argv);
  if (!startupContextPath) return createDefaultStartupContext({ cwd });
  const content = await fs.readFile(startupContextPath, "utf8");
  const parsed = JSON.parse(content);
  return normalizeStartupContext(parsed, { cwd });
}

export function safeStartupContextForLog(context = {}) {
  const normalized = normalizeStartupContext(context);
  return {
    schemaVersion: normalized.schemaVersion,
    app: normalized.app,
    paths: normalized.paths,
    service: normalized.service,
    runtime: normalized.runtime,
    createdAt: normalized.createdAt,
  };
}
