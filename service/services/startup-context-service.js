/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { resolveRuntimeTopology } from "@noobot/runtime-topology-protocol/ports";
import { isPlainObject } from "@noobot/shared/value";

const STARTUP_CONTEXT_ARG = "--startup-context";
const SCHEMA_VERSION = 1;
const APP_PLATFORMS = Object.freeze(["desktop", "web"]);
const LOGGED_ENV_KEYS = Object.freeze([
  "NOOBOT_FFMPEG_PATH",
  "NOOBOT_FFPROBE_PATH",
  "NOOBOT_PLAYWRIGHT_CHROMIUM_PATH",
  "LIBRE_OFFICE_EXE",
]);

function fail(field, expectation) {
  throw new TypeError(`[startup-context] ${field} must be ${expectation}`);
}

function requireObject(value, field) {
  if (!isPlainObject(value)) fail(field, "an object");
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string") fail(field, "a string");
  return value;
}

function requireNonEmptyString(value, field) {
  if (!requireString(value, field)) fail(field, "a non-empty string");
  return value;
}

function requireBoolean(value, field) {
  if (typeof value !== "boolean") fail(field, "a boolean");
  return value;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) fail(field, "an array");
  return value;
}

function requirePort(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 65535) fail(field, "a port integer");
  return value;
}

function requireOneOf(value, allowed, field) {
  if (!allowed.includes(value)) fail(field, `one of ${allowed.join(", ")}`);
  return value;
}

function readPath(value, field) {
  const normalized = requireString(value, field);
  return normalized ? path.resolve(normalized) : "";
}

function readRequiredPath(value, field) {
  return path.resolve(requireNonEmptyString(value, field));
}

function readStringList(value, field) {
  return requireArray(value, field).map((item, index) => requireString(item, `${field}[${index}]`));
}

function readEnvMap(value, field) {
  const output = {};
  for (const [key, rawValue] of Object.entries(requireObject(value, field))) {
    const envValue = requireString(rawValue, `${field}.${key}`);
    if (envValue) output[key] = envValue;
  }
  return output;
}

function readDependencySourceItem(value, field) {
  const item = requireObject(value, field);
  return {
    key: requireNonEmptyString(item.key, `${field}.key`),
    name: requireString(item.name, `${field}.name`),
    available: requireBoolean(item.available, `${field}.available`),
    installMode: requireString(item.installMode, `${field}.installMode`),
    sourceType: requireString(item.sourceType, `${field}.sourceType`),
    hasCustomSource: requireBoolean(item.hasCustomSource, `${field}.hasCustomSource`),
    customSourceEnvKeys: readStringList(item.customSourceEnvKeys, `${field}.customSourceEnvKeys`),
    configKeys: readStringList(item.configKeys, `${field}.configKeys`),
  };
}

function readDependencySourceSummary(value, field) {
  const summary = requireObject(value, field);
  return {
    platform: requireNonEmptyString(summary.platform, `${field}.platform`),
    dependencies: requireArray(summary.dependencies, `${field}.dependencies`).map((item, index) =>
      readDependencySourceItem(item, `${field}.dependencies[${index}]`),
    ),
  };
}

function readDependencies(value, field) {
  if (value === null) return null;
  const dependencies = requireObject(value, field);
  return {
    hasPlaywrightChromium: requireBoolean(
      dependencies.hasPlaywrightChromium,
      `${field}.hasPlaywrightChromium`,
    ),
    hasFfmpeg: requireBoolean(dependencies.hasFfmpeg, `${field}.hasFfmpeg`),
    hasFfprobe: requireBoolean(dependencies.hasFfprobe, `${field}.hasFfprobe`),
    hasLibreOffice: requireBoolean(dependencies.hasLibreOffice, `${field}.hasLibreOffice`),
    ffmpegPath: requireString(dependencies.ffmpegPath, `${field}.ffmpegPath`),
    ffprobePath: requireString(dependencies.ffprobePath, `${field}.ffprobePath`),
    libreOfficePath: requireString(dependencies.libreOfficePath, `${field}.libreOfficePath`),
    playwrightChromiumPath: requireString(
      dependencies.playwrightChromiumPath,
      `${field}.playwrightChromiumPath`,
    ),
    pathPrefix: requireString(dependencies.pathPrefix, `${field}.pathPrefix`),
    sourceSummary: readDependencySourceSummary(
      dependencies.sourceSummary,
      `${field}.sourceSummary`,
    ),
  };
}

export function normalizeStartupContext(input) {
  const raw = requireObject(input, "startupContext");
  if (raw.schemaVersion !== SCHEMA_VERSION) fail("schemaVersion", String(SCHEMA_VERSION));
  const app = requireObject(raw.app, "app");
  const paths = requireObject(raw.paths, "paths");
  const service = requireObject(raw.service, "service");
  const runtime = requireObject(raw.runtime, "runtime");
  return {
    schemaVersion: SCHEMA_VERSION,
    app: {
      name: requireNonEmptyString(app.name, "app.name"),
      platform: requireOneOf(app.platform, APP_PLATFORMS, "app.platform"),
      channel: requireNonEmptyString(app.channel, "app.channel"),
      packaged: requireBoolean(app.packaged, "app.packaged"),
    },
    paths: {
      backendRoot: readRequiredPath(paths.backendRoot, "paths.backendRoot"),
      frontendRoot: readPath(paths.frontendRoot, "paths.frontendRoot"),
      pluginRootDir: readRequiredPath(paths.pluginRootDir, "paths.pluginRootDir"),
      userDataDir: readPath(paths.userDataDir, "paths.userDataDir"),
    },
    service: {
      port: requirePort(service.port, "service.port"),
      host: requireString(service.host, "service.host"),
      origin: requireString(service.origin, "service.origin"),
    },
    runtime: {
      node: requireNonEmptyString(runtime.node, "runtime.node"),
      cwd: readRequiredPath(runtime.cwd, "runtime.cwd"),
      execPath: readRequiredPath(runtime.execPath, "runtime.execPath"),
      resourcesPath: readPath(runtime.resourcesPath, "runtime.resourcesPath"),
      env: readEnvMap(runtime.env, "runtime.env"),
      dependencies: readDependencies(runtime.dependencies, "runtime.dependencies"),
    },
    createdAt: requireNonEmptyString(raw.createdAt, "createdAt"),
  };
}

function resolveHeadlessBackendRoot(cwd) {
  const resolvedCwd = path.resolve(cwd);
  return path.basename(resolvedCwd) === "service" ? path.dirname(resolvedCwd) : resolvedCwd;
}

export function createDefaultStartupContext({ cwd, env }) {
  const backendRoot = resolveHeadlessBackendRoot(cwd);
  return normalizeStartupContext({
    schemaVersion: SCHEMA_VERSION,
    app: { name: "Noobot", platform: "web", channel: process.platform, packaged: false },
    paths: {
      backendRoot,
      frontendRoot: "",
      pluginRootDir: path.join(backendRoot, "plugin"),
      userDataDir: "",
    },
    service: { port: Number(resolveRuntimeTopology(env).servicePort), host: "", origin: "" },
    runtime: {
      node: process.version,
      cwd,
      execPath: process.execPath,
      resourcesPath: "",
      env: {},
      dependencies: null,
    },
    createdAt: new Date().toISOString(),
  });
}

function pickArgValue(argv, name) {
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === name) return argv[index + 1];
    if (item.startsWith(`${name}=`)) return item.slice(name.length + 1);
  }
  return "";
}

export function resolveStartupContextPath(argv) {
  return readPath(pickArgValue(argv, STARTUP_CONTEXT_ARG), STARTUP_CONTEXT_ARG);
}

export async function loadStartupContext({ argv, cwd, env }) {
  const startupContextPath = resolveStartupContextPath(argv);
  if (!startupContextPath) return createDefaultStartupContext({ cwd, env });
  const content = await fs.readFile(startupContextPath, "utf8");
  return normalizeStartupContext(JSON.parse(content));
}

export function applyStartupRuntimeEnv(context, { env }) {
  Object.assign(env, context.runtime.env);
  return context.runtime.env;
}

export function safeStartupContextForLog(context) {
  const runtimeEnv = context.runtime.env;
  const loggedEnv = { PATH: runtimeEnv.PATH ? "[set]" : "" };
  for (const key of LOGGED_ENV_KEYS) loggedEnv[key] = runtimeEnv[key] || "";
  return { ...context, runtime: { ...context.runtime, env: loggedEnv } };
}
