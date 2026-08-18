/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { access, readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  contributionsForSurface,
  manifestContributesToSurface,
  parsePluginManifest,
  PLUGIN_PROTOCOL_VERSION,
  PLUGIN_SURFACE,
  requirePluginSurface,
} from "@noobot/plugin-protocol";

export * from "./core.js";
export * from "./contributions.js";

const MANIFEST_FILE_NAME = "manifest.json";
const runtimeCache = new Map();

function normalizePluginIds(pluginIds = []) {
  return Array.from(new Set(
    (Array.isArray(pluginIds) ? pluginIds : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right));
}

function normalizeLoadOptions({ pluginRootDir = "", pluginIds = [], surface = PLUGIN_SURFACE.AGENT } = {}) {
  return Object.freeze({
    pluginRootDir: path.resolve(String(pluginRootDir || "").trim() || resolveDefaultPluginRootDir()),
    pluginIds: normalizePluginIds(pluginIds),
    surface: requirePluginSurface(surface),
  });
}

function runtimeCacheKey(options = {}) {
  return JSON.stringify(normalizeLoadOptions(options));
}

function pathIsInside(rootDir = "", candidatePath = "") {
  const relative = path.relative(path.resolve(rootDir), path.resolve(candidatePath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

export function resolveDefaultPluginRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../plugin");
}

export async function discoverNoobotPluginManifests({ pluginRootDir = "" } = {}) {
  const root = path.resolve(String(pluginRootDir || "").trim() || resolveDefaultPluginRootDir());
  let directoryEntries;
  try {
    directoryEntries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const manifests = [];
  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isDirectory()) continue;
    const pluginDir = path.join(root, directoryEntry.name);
    const manifestPath = path.join(pluginDir, MANIFEST_FILE_NAME);
    try {
      await access(manifestPath);
      manifests.push({ directoryName: directoryEntry.name, pluginDir, manifestPath });
    } catch {
    }
  }
  return manifests.sort((left, right) => left.directoryName.localeCompare(right.directoryName));
}

export async function loadNoobotPlugins(options = {}) {
  const normalized = normalizeLoadOptions(options);
  const include = new Set(normalized.pluginIds);
  const discovered = await discoverNoobotPluginManifests({ pluginRootDir: normalized.pluginRootDir });
  const registry = new Map();
  const skipped = [];
  const errors = [];
  const lifecycleEvents = discovered.map((item) => Object.freeze({
    event: "plugin.discovered",
    pluginId: item.directoryName,
    surface: normalized.surface,
  }));

  for (const item of discovered) {
    try {
      const manifest = parsePluginManifest(JSON.parse(await readFile(item.manifestPath, "utf8")));
      lifecycleEvents.push(Object.freeze({
        event: "plugin.manifest_validated",
        pluginId: manifest.id,
        pluginVersion: manifest.version,
        protocolVersion: manifest.protocolVersion,
        surface: normalized.surface,
      }));
      if (include.size && !include.has(manifest.id)) {
        skipped.push({ pluginId: manifest.id, reason: "not_selected", ...item });
        continue;
      }
      if (!manifest.enabledByDefault && !include.has(manifest.id)) {
        skipped.push({ pluginId: manifest.id, reason: "not_enabled", ...item });
        continue;
      }
      if (!manifestContributesToSurface(manifest, normalized.surface)) {
        skipped.push({ pluginId: manifest.id, reason: `no_${normalized.surface}_contributions`, ...item });
        continue;
      }
      if (registry.has(manifest.id)) throw new Error(`duplicate plugin id: ${manifest.id}`);
      const entryRelativePath = manifest.entries[normalized.surface];
      const entryPath = path.resolve(item.pluginDir, entryRelativePath);
      if (!pathIsInside(item.pluginDir, entryPath)) {
        throw new Error(`entry path escapes plugin root: ${entryRelativePath}`);
      }
      await access(entryPath);
      const moduleNamespace = await import(pathToFileURL(entryPath).href);
      if (typeof moduleNamespace.activate !== "function") {
        throw new Error(`plugin surface entry must export activate: ${manifest.id}/${normalized.surface}`);
      }
      lifecycleEvents.push(Object.freeze({
        event: "plugin.module_loaded",
        pluginId: manifest.id,
        pluginVersion: manifest.version,
        protocolVersion: manifest.protocolVersion,
        surface: normalized.surface,
      }));
      registry.set(manifest.id, Object.freeze({
        pluginId: manifest.id,
        pluginDir: item.pluginDir,
        manifestPath: item.manifestPath,
        manifest,
        surface: normalized.surface,
        entryPath,
        activate: moduleNamespace.activate,
      }));
    } catch (error) {
      lifecycleEvents.push(Object.freeze({
        event: "plugin.failed",
        pluginId: item.directoryName,
        surface: normalized.surface,
        errorCode: "PLUGIN_LOAD_FAILED",
        message: errorMessage(error),
      }));
      errors.push({
        pluginId: item.directoryName,
        stage: "load",
        message: errorMessage(error),
        pluginDir: item.pluginDir,
        manifestPath: item.manifestPath,
      });
    }
  }

  return Object.freeze({
    protocolVersion: PLUGIN_PROTOCOL_VERSION,
    pluginRootDir: normalized.pluginRootDir,
    surface: normalized.surface,
    pluginIds: normalized.pluginIds,
    discoveredCount: discovered.length,
    loadedCount: registry.size,
    skippedCount: skipped.length,
    skipped: Object.freeze(skipped),
    registry,
    errors: Object.freeze(errors),
    lifecycleEvents: Object.freeze(lifecycleEvents),
    loadedAt: new Date().toISOString(),
  });
}

export async function getNoobotPluginRuntime(options = {}) {
  const key = runtimeCacheKey(options);
  if (!runtimeCache.has(key)) runtimeCache.set(key, loadNoobotPlugins(options));
  return runtimeCache.get(key);
}

export async function refreshNoobotPluginRuntime(options = {}) {
  const key = runtimeCacheKey(options);
  const runtime = loadNoobotPlugins(options);
  runtimeCache.set(key, runtime);
  return runtime;
}

export function clearNoobotPluginRuntimeCache() {
  runtimeCache.clear();
}

export function listLoadedNoobotPluginEntries(runtime = null) {
  return runtime?.registry instanceof Map ? Array.from(runtime.registry.values()) : [];
}

export function resolveLoadedNoobotPlugin(runtime = null, pluginId = "") {
  const normalized = String(pluginId || "").trim();
  return normalized && runtime?.registry instanceof Map ? runtime.registry.get(normalized) || null : null;
}

export function listPluginsContributingHook(runtime = null, point = "") {
  const normalized = String(point || "").trim();
  return listLoadedNoobotPluginEntries(runtime).filter((entry) =>
    (contributionsForSurface(entry.manifest, entry.surface)?.hooks?.registers || []).some((item) => item.point === normalized),
  );
}

export function resolvePluginExecutionIntent(runtime = null, pluginId = "") {
  const plugin = resolveLoadedNoobotPlugin(runtime, pluginId);
  const declaration = plugin?.manifest?.contributes?.agent?.executionIntent;
  if (!declaration) return null;
  return Object.freeze({ ...declaration, pluginId: plugin.pluginId });
}

export function buildNoobotPluginDiagnostics(runtime = null) {
  return Object.freeze({
    protocolVersion: PLUGIN_PROTOCOL_VERSION,
    pluginRootDir: String(runtime?.pluginRootDir || ""),
    surface: String(runtime?.surface || ""),
    discoveredCount: Number(runtime?.discoveredCount || 0),
    loadedCount: Number(runtime?.loadedCount || 0),
    pluginIds: listLoadedNoobotPluginEntries(runtime).map((entry) => entry.pluginId),
    skippedCount: Number(runtime?.skippedCount || 0),
    loaded: listLoadedNoobotPluginEntries(runtime).map((entry) => ({
      id: entry.pluginId,
      name: entry.manifest.name,
      version: entry.manifest.version,
      protocolVersion: entry.manifest.protocolVersion,
      entries: { ...entry.manifest.entries },
      surface: entry.surface,
    })),
    errors: Array.isArray(runtime?.errors) ? runtime.errors.map((item) => ({ ...item })) : [],
    skipped: Array.isArray(runtime?.skipped) ? runtime.skipped.map((item) => ({ ...item })) : [],
  });
}
