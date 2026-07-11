/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../utils/path-resolver.js";
import { readdir, readFile, access } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

const MANIFEST_FILE_NAME = "manifest.json";
const DEFAULT_REQUIRED_API_VERSION = "1";
const runtimeCache = new Map();

const pluginManifestSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
  pluginKey: z.string().trim().optional().default(""),
  capabilities: z.array(z.string().trim()).optional().default([]),
  description: z.string().trim().optional().default(""),
  permissions: z.array(z.string().trim()).optional().default([]),
  runtimeOptions: z.record(z.unknown()).optional().default({}),
  apiVersion: z.string().trim().min(1).default(DEFAULT_REQUIRED_API_VERSION),
  entry: z.string().trim().min(1),
  enabledByDefault: z.boolean().optional().default(true),
});

function toSafeErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || "unknown error");
}

async function readJsonFileSafe(filePath = "") {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content);
}

function normalizePluginIdList(pluginIds = []) {
  return Array.from(
    new Set(
      (Array.isArray(pluginIds) ? pluginIds : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function normalizeLoadOptions({
  pluginRootDir = "",
  pluginIds = [],
  requiredApiVersion = DEFAULT_REQUIRED_API_VERSION,
} = {}) {
  const normalizedPluginRootDir = path.resolve(
    String(pluginRootDir || "").trim() || resolveDefaultPluginRootDir(),
  );
  const normalizedPluginIds = normalizePluginIdList(pluginIds);
  const normalizedRequiredApiVersion =
    String(requiredApiVersion || "").trim() || DEFAULT_REQUIRED_API_VERSION;
  return {
    pluginRootDir: normalizedPluginRootDir,
    pluginIds: normalizedPluginIds,
    requiredApiVersion: normalizedRequiredApiVersion,
  };
}

function buildRuntimeCacheKey(options = {}) {
  const normalized = normalizeLoadOptions(options);
  return JSON.stringify(normalized);
}

function ensurePathInsideRoot(rootDir = "", candidatePath = "") {
  const resolvedRoot = path.resolve(String(rootDir || "").trim());
  const resolvedCandidate = path.resolve(String(candidatePath || "").trim());
  const relativePath = path.relative(resolvedRoot, resolvedCandidate);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

export function resolveDefaultPluginRootDirFromLoaderDir(loaderDir = "") {
  const normalizedLoaderDir = path.resolve(String(loaderDir || "").trim());
  const directBackendPluginDir = path.resolve(normalizedLoaderDir, "../../../../plugin");
  const packagedAgentPluginDir = path.resolve(normalizedLoaderDir, "../../../../../plugin");
  return normalizedLoaderDir.includes(`${path.sep}node_modules${path.sep}`)
    ? packagedAgentPluginDir
    : directBackendPluginDir;
}

export function resolveDefaultPluginRootDir() {
  const loaderDir = path.dirname(fileURLToPath(import.meta.url));
  return resolveDefaultPluginRootDirFromLoaderDir(loaderDir);
}

export async function discoverNoobotPluginManifests({
  pluginRootDir = "",
} = {}) {
  const resolvedRoot = path.resolve(String(pluginRootDir || "").trim() || resolveDefaultPluginRootDir());
  let rootEntries = [];
  try {
    rootEntries = await readdir(resolvedRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const discovered = [];
  for (const rootEntry of rootEntries) {
    if (!rootEntry?.isDirectory?.()) continue;
    const dirName = String(rootEntry.name || "").trim();
    if (!dirName) continue;
    const pluginDir = path.join(resolvedRoot, dirName);
    const manifestPath = path.join(pluginDir, MANIFEST_FILE_NAME);
    try {
      await access(manifestPath);
    } catch {
      continue;
    }
    discovered.push({
      directoryName: dirName,
      pluginDir,
      manifestPath,
    });
  }
  return discovered.sort((a, b) =>
    String(a?.directoryName || "").localeCompare(String(b?.directoryName || "")),
  );
}

export async function loadNoobotPlugins({
  pluginRootDir = "",
  pluginIds = [],
  requiredApiVersion = DEFAULT_REQUIRED_API_VERSION,
} = {}) {
  const normalized = normalizeLoadOptions({
    pluginRootDir,
    pluginIds,
    requiredApiVersion,
  });
  const includeSet = new Set(normalized.pluginIds);
  const targetApiVersion = normalized.requiredApiVersion;
  const discovered = await discoverNoobotPluginManifests({
    pluginRootDir: normalized.pluginRootDir,
  });
  const registry = new Map();
  const skipped = [];
  const errors = [];
  const seenPluginIds = new Set();
  for (const discoveredItem of discovered) {
    const {
      pluginDir = "",
      manifestPath = "",
      directoryName = "",
    } = discoveredItem || {};
    try {
      const rawManifest = await readJsonFileSafe(manifestPath);
      const manifest = pluginManifestSchema.parse(rawManifest || {});
      const pluginId = String(manifest?.id || "").trim() || directoryName;
      if (includeSet.size && !includeSet.has(pluginId)) {
        skipped.push({
          pluginId,
          pluginDir,
          manifestPath,
          reason: "not_in_include_set",
        });
        continue;
      }
      if (manifest.enabledByDefault !== true) {
        skipped.push({
          pluginId,
          pluginDir,
          manifestPath,
          reason: "disabled_by_manifest",
        });
        continue;
      }
      if (seenPluginIds.has(pluginId)) {
        errors.push({
          pluginId,
          pluginDir,
          manifestPath,
          stage: "validate_unique_id",
          message: `duplicate plugin id: ${pluginId}`,
        });
        continue;
      }
      seenPluginIds.add(pluginId);
      if (String(manifest?.apiVersion || "").trim() !== targetApiVersion) {
        errors.push({
          pluginId,
          pluginDir,
          manifestPath,
          stage: "validate_api_version",
          message: `unsupported apiVersion: ${String(manifest?.apiVersion || "")}`,
        });
        continue;
      }
      const entryPath = path.resolve(pluginDir, String(manifest?.entry || "").trim());
      if (!ensurePathInsideRoot(pluginDir, entryPath)) {
        errors.push({
          pluginId,
          pluginDir,
          manifestPath,
          stage: "validate_entry_path",
          message: `entry path escapes plugin root: ${String(manifest?.entry || "")}`,
        });
        continue;
      }
      try {
        await access(entryPath);
      } catch {
        errors.push({
          pluginId,
          pluginDir,
          manifestPath,
          stage: "validate_entry_exists",
          message: `entry file not found: ${entryPath}`,
        });
        continue;
      }
      const moduleNamespace = await import(pathToFileURL(entryPath).href);
      const registerNoobotPlugin =
        typeof moduleNamespace?.registerNoobotPlugin === "function"
          ? moduleNamespace.registerNoobotPlugin
          : null;
      if (typeof registerNoobotPlugin !== "function") {
        errors.push({
          pluginId,
          pluginDir,
          manifestPath,
          stage: "resolve_register",
          message: "registerNoobotPlugin export not found",
        });
        continue;
      }
      registry.set(pluginId, {
        pluginId,
        pluginDir,
        manifestPath,
        manifest: {
          ...manifest,
          id: pluginId,
          pluginKey: String(manifest.pluginKey || "").trim(),
          capabilities: Array.isArray(manifest.capabilities)
            ? manifest.capabilities
                .map((item) => String(item || "").trim())
                .filter(Boolean)
            : [],
          permissions: Array.isArray(manifest.permissions)
            ? manifest.permissions.map((item) => String(item || "").trim()).filter(Boolean)
            : [],
          runtimeOptions:
            manifest?.runtimeOptions &&
            typeof manifest.runtimeOptions === "object" &&
            !Array.isArray(manifest.runtimeOptions)
              ? { ...manifest.runtimeOptions }
              : {},
        },
        entryPath,
        moduleNamespace,
        registerNoobotPlugin,
      });
    } catch (error) {
      errors.push({
        pluginId: directoryName,
        pluginDir,
        manifestPath,
        stage: "load",
        message: toSafeErrorMessage(error),
      });
    }
  }
  return {
    pluginRootDir: normalized.pluginRootDir,
    requiredApiVersion: targetApiVersion,
    pluginIds: normalized.pluginIds,
    discoveredCount: discovered.length,
    loadedCount: registry.size,
    skippedCount: skipped.length,
    skipped,
    registry,
    errors,
    loadedAt: new Date().toISOString(),
  };
}

export async function getNoobotPluginRuntime(options = {}) {
  const key = buildRuntimeCacheKey(options);
  if (!runtimeCache.has(key)) {
    runtimeCache.set(key, loadNoobotPlugins(options));
  }
  return runtimeCache.get(key);
}

export async function refreshNoobotPluginRuntime(options = {}) {
  const key = buildRuntimeCacheKey(options);
  const refreshed = loadNoobotPlugins(options);
  runtimeCache.set(key, refreshed);
  return refreshed;
}

export function clearNoobotPluginRuntimeCache(options = null) {
  if (!options) {
    runtimeCache.clear();
    return;
  }
  runtimeCache.delete(buildRuntimeCacheKey(options));
}

export function resolvePluginRegisterFromLoaded(
  loadedPlugins = null,
  pluginId = "",
  fallbackRegister = null,
) {
  const normalizedPluginId = String(pluginId || "").trim();
  const registerFn =
    loadedPlugins?.registry instanceof Map
      ? loadedPlugins.registry.get(normalizedPluginId)?.registerNoobotPlugin
      : null;
  if (typeof registerFn === "function") return registerFn;
  return typeof fallbackRegister === "function" ? fallbackRegister : null;
}

export function listLoadedNoobotPluginEntries(loadedPlugins = null) {
  return loadedPlugins?.registry instanceof Map
    ? Array.from(loadedPlugins.registry.values())
    : [];
}

export function resolveLoadedNoobotPluginsByCapability(
  loadedPlugins = null,
  capability = "",
) {
  const normalizedCapability = String(capability || "").trim();
  if (!normalizedCapability) return [];
  return listLoadedNoobotPluginEntries(loadedPlugins).filter((item = {}) =>
    Array.isArray(item?.manifest?.capabilities) &&
    item.manifest.capabilities.includes(normalizedCapability),
  );
}

export function resolvePluginRegisterByPluginKey(
  loadedPlugins = null,
  pluginKey = "",
  fallbackRegister = null,
) {
  const normalizedPluginKey = String(pluginKey || "").trim();
  if (!normalizedPluginKey) {
    return typeof fallbackRegister === "function" ? fallbackRegister : null;
  }
  const matched = listLoadedNoobotPluginEntries(loadedPlugins).find(
    (item = {}) => String(item?.manifest?.pluginKey || "").trim() === normalizedPluginKey,
  );
  const registerFn = typeof matched?.registerNoobotPlugin === "function" ? matched.registerNoobotPlugin : null;
  if (typeof registerFn === "function") return registerFn;
  return typeof fallbackRegister === "function" ? fallbackRegister : null;
}

export function resolveFirstLoadedNoobotPluginByCapability(
  loadedPlugins = null,
  capability = "",
) {
  const matched = resolveLoadedNoobotPluginsByCapability(loadedPlugins, capability);
  return matched.length ? matched[0] : null;
}

export function resolvePluginRegisterByCapability(
  loadedPlugins = null,
  capability = "",
  fallbackRegister = null,
) {
  const matched = resolveFirstLoadedNoobotPluginByCapability(loadedPlugins, capability);
  const registerFn = typeof matched?.registerNoobotPlugin === "function" ? matched.registerNoobotPlugin : null;
  if (typeof registerFn === "function") return registerFn;
  return typeof fallbackRegister === "function" ? fallbackRegister : null;
}

export function buildNoobotPluginDiagnostics(loadedPlugins = null) {
  const registryEntries =
    loadedPlugins?.registry instanceof Map
      ? Array.from(loadedPlugins.registry.values())
      : [];
  const loaded = registryEntries.map((item = {}) => ({
    id: String(item?.manifest?.id || item?.pluginId || "").trim(),
    name: String(item?.manifest?.name || "").trim(),
    version: String(item?.manifest?.version || "").trim(),
    pluginKey: String(item?.manifest?.pluginKey || "").trim(),
    capabilities: Array.isArray(item?.manifest?.capabilities)
      ? item.manifest.capabilities.map((capability) => String(capability || "").trim()).filter(Boolean)
      : [],
    description: String(item?.manifest?.description || "").trim(),
    apiVersion: String(item?.manifest?.apiVersion || "").trim(),
    permissions: Array.isArray(item?.manifest?.permissions)
      ? item.manifest.permissions.map((permission) => String(permission || "").trim()).filter(Boolean)
      : [],
    entry: String(item?.manifest?.entry || "").trim(),
    entryPath: String(item?.entryPath || "").trim(),
    pluginDir: String(item?.pluginDir || "").trim(),
    manifestPath: String(item?.manifestPath || "").trim(),
  }));
  const errors = (Array.isArray(loadedPlugins?.errors) ? loadedPlugins.errors : []).map(
    (errorItem = {}) => ({
      pluginId: String(errorItem?.pluginId || "").trim(),
      stage: String(errorItem?.stage || "").trim(),
      message: String(errorItem?.message || "").trim(),
      pluginDir: String(errorItem?.pluginDir || "").trim(),
      manifestPath: String(errorItem?.manifestPath || "").trim(),
    }),
  );
  const skipped = (Array.isArray(loadedPlugins?.skipped) ? loadedPlugins.skipped : []).map(
    (item = {}) => ({
      pluginId: String(item?.pluginId || "").trim(),
      reason: String(item?.reason || "").trim(),
      pluginDir: String(item?.pluginDir || "").trim(),
      manifestPath: String(item?.manifestPath || "").trim(),
    }),
  );
  return {
    pluginRootDir: String(loadedPlugins?.pluginRootDir || "").trim(),
    requiredApiVersion: String(loadedPlugins?.requiredApiVersion || DEFAULT_REQUIRED_API_VERSION).trim(),
    pluginIds: normalizePluginIdList(loadedPlugins?.pluginIds || []),
    discoveredCount: Number(loadedPlugins?.discoveredCount || 0),
    loadedCount: Number(loadedPlugins?.loadedCount || loaded.length),
    skippedCount: Number(loadedPlugins?.skippedCount || skipped.length),
    loaded,
    skipped,
    errors,
    loadedAt: String(loadedPlugins?.loadedAt || "").trim(),
  };
}
