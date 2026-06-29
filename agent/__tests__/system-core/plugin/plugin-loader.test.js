import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdir, writeFile, rm } from "node:fs/promises";
import {
  buildNoobotPluginDiagnostics,
  clearNoobotPluginRuntimeCache,
  discoverNoobotPluginManifests,
  getNoobotPluginRuntime,
  loadNoobotPlugins,
  refreshNoobotPluginRuntime,
  resolveDefaultPluginRootDir,
  resolveDefaultPluginRootDirFromLoaderDir,
  resolveFirstLoadedNoobotPluginByCapability,
  resolveLoadedNoobotPluginsByCapability,
  resolvePluginRegisterByCapability,
  resolvePluginRegisterByPluginKey,
  resolvePluginRegisterFromLoaded,
} from "../../../src/system-core/plugin/plugin-loader.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

function createTempRoot(prefix = "noobot-plugin-loader-") {
  return path.join(os.tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

test("plugin loader discovers manifest and loads register function", async () => {
  const tempRoot = createTempRoot();
  const pluginDir = path.join(tempRoot, "demo-plugin");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    path.join(pluginDir, "manifest.json"),
    `${JSON.stringify(
      {
        id: "demo",
        pluginKey: "demo",
        name: "demo-plugin",
        version: "1.0.0",
        apiVersion: "1",
        capabilities: ["test.demo"],
        entry: "src/index.js",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await mkdir(path.join(pluginDir, "src"), { recursive: true });
  await writeFile(
    path.join(pluginDir, "src/index.js"),
    "export function registerNoobotPlugin(api = {}, options = {}) { return { ok: true, api, options }; }\n",
    "utf8",
  );

  try {
    const discovered = await discoverNoobotPluginManifests({
      pluginRootDir: tempRoot,
    });
    assert.equal(discovered.length, 1);
    const loaded = await loadNoobotPlugins({
      pluginRootDir: tempRoot,
      pluginIds: ["demo"],
    });
    assert.equal(loaded.loadedCount, 1);
    assert.equal(typeof loaded.registry.get("demo")?.registerNoobotPlugin, "function");
    const resolved = resolvePluginRegisterFromLoaded(loaded, "demo", null);
    assert.equal(typeof resolved, "function");
    const resolvedByKey = resolvePluginRegisterByPluginKey(loaded, "demo", null);
    assert.equal(typeof resolvedByKey, "function");
    const byCapability = resolveLoadedNoobotPluginsByCapability(loaded, "test.demo");
    assert.equal(byCapability.length, 1);
    const firstByCapability = resolveFirstLoadedNoobotPluginByCapability(loaded, "test.demo");
    assert.equal(String(firstByCapability?.manifest?.id || ""), "demo");
    const registerByCapability = resolvePluginRegisterByCapability(loaded, "test.demo", null);
    assert.equal(typeof registerByCapability, "function");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("default plugin root points to repository plugin directory in source runtime", () => {
  assert.equal(resolveDefaultPluginRootDir(), path.join(REPO_ROOT, "plugin"));
});

test("default plugin root points outside node_modules when agent is packaged as dependency", () => {
  const packagedLoaderDir = path.join(
    REPO_ROOT,
    "client/windows/dist/win-unpacked/resources/backend/node_modules/noobot-agent/src/system-core/plugin",
  );
  assert.equal(
    resolveDefaultPluginRootDirFromLoaderDir(packagedLoaderDir),
    path.join(REPO_ROOT, "client/windows/dist/win-unpacked/resources/backend/plugin"),
  );
});

test("plugin loader falls back to static register when dynamic plugin is missing", async () => {
  const fallbackRegister = () => "fallback";
  const resolved = resolvePluginRegisterFromLoaded(
    { registry: new Map() },
    "missing",
    fallbackRegister,
  );
  assert.equal(resolved, fallbackRegister);
});

test("plugin loader detects duplicate id and entry escape path", async () => {
  const tempRoot = createTempRoot("noobot-plugin-loader-validate-");
  const pluginA = path.join(tempRoot, "plugin-a");
  const pluginB = path.join(tempRoot, "plugin-b");
  const pluginC = path.join(tempRoot, "plugin-c");
  await mkdir(path.join(pluginA, "src"), { recursive: true });
  await mkdir(path.join(pluginB, "src"), { recursive: true });
  await mkdir(path.join(pluginC, "src"), { recursive: true });
  await writeFile(
    path.join(pluginA, "manifest.json"),
    JSON.stringify({ id: "dup", name: "A", version: "1.0.0", apiVersion: "1", entry: "src/index.js" }),
    "utf8",
  );
  await writeFile(
    path.join(pluginB, "manifest.json"),
    JSON.stringify({ id: "dup", name: "B", version: "1.0.0", apiVersion: "1", entry: "src/index.js" }),
    "utf8",
  );
  await writeFile(
    path.join(pluginC, "manifest.json"),
    JSON.stringify({
      id: "escape",
      name: "escape",
      version: "1.0.0",
      apiVersion: "1",
      entry: "../outside.js",
    }),
    "utf8",
  );
  await writeFile(path.join(pluginA, "src/index.js"), "export function registerNoobotPlugin() {}\n", "utf8");
  await writeFile(path.join(pluginB, "src/index.js"), "export function registerNoobotPlugin() {}\n", "utf8");
  try {
    const loaded = await loadNoobotPlugins({ pluginRootDir: tempRoot });
    assert.equal(loaded.loadedCount, 1);
    assert.ok(loaded.errors.some((item) => String(item?.stage || "") === "validate_unique_id"));
    assert.ok(loaded.errors.some((item) => String(item?.stage || "") === "validate_entry_path"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("plugin runtime cache supports get/refresh and diagnostics", async () => {
  const tempRoot = createTempRoot("noobot-plugin-loader-cache-");
  const pluginDir = path.join(tempRoot, "cache-plugin");
  await mkdir(path.join(pluginDir, "src"), { recursive: true });
  await writeFile(
    path.join(pluginDir, "manifest.json"),
    JSON.stringify({
      id: "cache",
      name: "cache-plugin",
      version: "1.0.0",
      apiVersion: "1",
      entry: "src/index.js",
      enabledByDefault: false,
    }),
    "utf8",
  );
  await writeFile(path.join(pluginDir, "src/index.js"), "export function registerNoobotPlugin() {}\n", "utf8");
  try {
    clearNoobotPluginRuntimeCache();
    const runtimeA = await getNoobotPluginRuntime({ pluginRootDir: tempRoot });
    const runtimeB = await getNoobotPluginRuntime({ pluginRootDir: tempRoot });
    assert.equal(runtimeA, runtimeB);
    assert.equal(runtimeA.loadedCount, 0);
    assert.equal(runtimeA.skippedCount, 1);
    const diagnostics = buildNoobotPluginDiagnostics(runtimeA);
    assert.equal(diagnostics.skippedCount, 1);
    assert.equal(Array.isArray(diagnostics.skipped), true);
    const refreshed = await refreshNoobotPluginRuntime({ pluginRootDir: tempRoot });
    assert.notEqual(refreshed.loadedAt, "");
  } finally {
    clearNoobotPluginRuntimeCache();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
