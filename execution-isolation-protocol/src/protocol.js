/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import path from "node:path";
import { SHELL, resolveHostShell } from "@noobot/platform-compatibility/platform";
import { TOOL_EXECUTION_VIEW } from "./execution-views.js";

export { TOOL_EXECUTION_VIEW } from "./execution-views.js";

export const EXECUTION_ISOLATION_PROTOCOL_NAME = "noobot.execution-isolation";
export const EXECUTION_ISOLATION_PROTOCOL_VERSION = 1;

export const EXECUTION_ISOLATION_MODE = Object.freeze({
  HOST: "host",
  SANDBOX: "sandbox",
});

export const SANDBOX_PROVIDER = Object.freeze({
  DOCKER: "docker",
});

export const DOCKER_CONTAINER_SCOPE = Object.freeze({
  GLOBAL: "global",
  USER: "user",
});

export const TOOL_EXECUTION_CLASS = Object.freeze({
  WORKSPACE_IO: "workspace_io",
  WORKSPACE_COMPUTE: "workspace_compute",
  NATIVE_HOST: "native_host",
  SERVICE_CONTROL: "service_control",
});

export const EXECUTION_ISOLATION_DEFAULTS = Object.freeze({
  mode: EXECUTION_ISOLATION_MODE.HOST,
  sandbox: Object.freeze({
    provider: SANDBOX_PROVIDER.DOCKER,
    scope: DOCKER_CONTAINER_SCOPE.USER,
    containerName: "noobot-workspace-sandbox",
    image: "nikolaik/python-nodejs:python3.12-nodejs26-bookworm",
  }),
});

export const WORKSPACE_SANDBOX_PATHS = Object.freeze({
  ROOT: "/workspace",
  OPS_WORKDIR_RELATIVE: "runtime/ops_workdir",
});

export { SHELL as COMMAND_SHELL } from "@noobot/platform-compatibility/platform";

export function resolveCommandShell({ executionView, platform = process.platform } = {}) {
  if (executionView === TOOL_EXECUTION_VIEW.WORKSPACE_SANDBOX) return SHELL.BASH;
  if (executionView === TOOL_EXECUTION_VIEW.SERVICE_HOST_RESTRICTED) {
    return resolveHostShell(platform);
  }
  throw new Error(`execution view does not support shell commands: ${executionView}`);
}

export const TOOL_EXECUTION_REGISTRY = Object.freeze({
  read_file: TOOL_EXECUTION_CLASS.WORKSPACE_IO,
  write_file: TOOL_EXECUTION_CLASS.WORKSPACE_IO,
  patch_file: TOOL_EXECUTION_CLASS.WORKSPACE_IO,
  search: TOOL_EXECUTION_CLASS.WORKSPACE_IO,
  execute_script: TOOL_EXECUTION_CLASS.WORKSPACE_COMPUTE,
  execute_native_script: TOOL_EXECUTION_CLASS.NATIVE_HOST,

  multimodal_parse: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  multimodal_generate: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  call_service: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  call_mcp_task: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  list_skills: TOOL_EXECUTION_CLASS.WORKSPACE_IO,
  delegate_task_async: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  wait_async_task_result: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  plan_multi_task_collaboration: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  switch_model: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  user_interaction: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  access_connector: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  web_search: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  task_summary: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  task_check: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  request_help: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
  final_answer: TOOL_EXECUTION_CLASS.SERVICE_CONTROL,
});

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requiredString(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field} is required`);
  if (normalized.includes("\0")) throw new Error(`${field} contains a null byte`);
  return normalized;
}

export function sanitizeExecutionIdentity(input = "") {
  const normalized = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-");
  let start = 0;
  let end = normalized.length;
  while (normalized[start] === "-") start += 1;
  while (end > start && normalized[end - 1] === "-") end -= 1;
  return normalized.slice(start, end);
}

function normalizeContainerName(value) {
  const name = sanitizeExecutionIdentity(
    requiredString(value, "security.executionIsolation.sandbox.containerName"),
  );
  if (!name) throw new Error("security.executionIsolation.sandbox.containerName is invalid");
  return name;
}

function isAbsoluteHostPath(value) {
  return (
    value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)
  );
}

function normalizeMountTarget(value, field) {
  const source = requiredString(value, field);
  if (!source.startsWith("/") || source.includes("\\")) {
    throw new Error(`${field} must be an absolute container path`);
  }
  const segments = [];
  for (const segment of source.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") throw new Error(`${field} cannot contain '..'`);
    segments.push(segment);
  }
  const target = `/${segments.join("/")}`;
  if (
    target === "/" ||
    target === WORKSPACE_SANDBOX_PATHS.ROOT ||
    target.startsWith(`${WORKSPACE_SANDBOX_PATHS.ROOT}/`)
  ) {
    throw new Error(`${field} cannot replace the managed workspace mount`);
  }
  return target;
}

function normalizeOptionalLockWaitTimeout(value) {
  if (value === undefined) return undefined;
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 100) {
    throw new Error(
      "security.executionIsolation.sandbox.lockWaitTimeoutMs must be an integer >= 100",
    );
  }
  return timeout;
}

export function normalizeSandboxProvider(input = SANDBOX_PROVIDER.DOCKER) {
  const provider = String(input || "")
    .trim()
    .toLowerCase();
  if (provider !== SANDBOX_PROVIDER.DOCKER) {
    throw new Error(`invalid workspace sandbox provider: ${provider}`);
  }
  return provider;
}

export function normalizeDockerContainerScope(input = DOCKER_CONTAINER_SCOPE.USER) {
  const scope = String(input || "")
    .trim()
    .toLowerCase();
  if (!Object.values(DOCKER_CONTAINER_SCOPE).includes(scope)) {
    throw new Error(`invalid workspace sandbox scope: ${scope}`);
  }
  return scope;
}

export function normalizeSandboxMounts(input = []) {
  if (!Array.isArray(input))
    throw new Error("security.executionIsolation.sandbox.mounts must be an array");
  const targets = new Set();
  const mounts = input.map((value, index) => {
    const mount = objectOrEmpty(value);
    const field = `security.executionIsolation.sandbox.mounts[${index}]`;
    const source = requiredString(mount.source, `${field}.source`);
    if (!isAbsoluteHostPath(source))
      throw new Error(`${field}.source must be an absolute host path`);
    const target = normalizeMountTarget(mount.target, `${field}.target`);
    if (targets.has(target)) throw new Error(`${field}.target is duplicated: ${target}`);
    targets.add(target);
    if (mount.readOnly !== undefined && typeof mount.readOnly !== "boolean") {
      throw new Error(`${field}.readOnly must be boolean`);
    }
    return Object.freeze({
      source,
      target,
      description: String(mount.description || "").trim(),
      readOnly: mount.readOnly === true,
    });
  });
  return Object.freeze(mounts);
}

export function resolveExecutionIsolation(globalConfig = {}) {
  const configured = objectOrEmpty(globalConfig?.security?.executionIsolation);
  const mode = String(configured.mode || EXECUTION_ISOLATION_DEFAULTS.mode)
    .trim()
    .toLowerCase();
  if (!Object.values(EXECUTION_ISOLATION_MODE).includes(mode)) {
    throw new Error(`invalid execution isolation mode: ${mode}`);
  }
  const sandbox = objectOrEmpty(configured.sandbox);
  const lockWaitTimeoutMs = normalizeOptionalLockWaitTimeout(sandbox.lockWaitTimeoutMs);
  const resolvedSandbox = Object.freeze({
    provider: normalizeSandboxProvider(
      sandbox.provider || EXECUTION_ISOLATION_DEFAULTS.sandbox.provider,
    ),
    scope: normalizeDockerContainerScope(
      sandbox.scope || EXECUTION_ISOLATION_DEFAULTS.sandbox.scope,
    ),
    containerName: normalizeContainerName(
      sandbox.containerName || EXECUTION_ISOLATION_DEFAULTS.sandbox.containerName,
    ),
    image: requiredString(
      sandbox.image || EXECUTION_ISOLATION_DEFAULTS.sandbox.image,
      "security.executionIsolation.sandbox.image",
    ),
    mounts: normalizeSandboxMounts(sandbox.mounts || []),
    ...(lockWaitTimeoutMs === undefined ? {} : { lockWaitTimeoutMs }),
  });
  return Object.freeze({
    protocol: EXECUTION_ISOLATION_PROTOCOL_NAME,
    version: EXECUTION_ISOLATION_PROTOCOL_VERSION,
    mode,
    sandbox: resolvedSandbox,
  });
}

export function assertExecutionIsolationProtocol(isolation) {
  if (
    isolation?.protocol !== EXECUTION_ISOLATION_PROTOCOL_NAME ||
    isolation?.version !== EXECUTION_ISOLATION_PROTOCOL_VERSION
  ) {
    throw new Error("resolved execution isolation protocol required");
  }
  return isolation;
}

function resolveExecutionView({ executionClass, isolation }) {
  if (
    executionClass === TOOL_EXECUTION_CLASS.WORKSPACE_IO ||
    executionClass === TOOL_EXECUTION_CLASS.SERVICE_CONTROL
  ) {
    return TOOL_EXECUTION_VIEW.SERVICE_HOST;
  }
  if (executionClass === TOOL_EXECUTION_CLASS.NATIVE_HOST) {
    return TOOL_EXECUTION_VIEW.NATIVE_HOST_RESTRICTED;
  }
  if (executionClass === TOOL_EXECUTION_CLASS.WORKSPACE_COMPUTE) {
    return isolation.mode === EXECUTION_ISOLATION_MODE.SANDBOX
      ? TOOL_EXECUTION_VIEW.WORKSPACE_SANDBOX
      : TOOL_EXECUTION_VIEW.SERVICE_HOST_RESTRICTED;
  }
  throw new Error(`unsupported tool execution class: ${executionClass}`);
}

export function assertToolExecutionPolicy(policy) {
  const isolation = assertExecutionIsolationProtocol(policy?.isolation);
  if (!Object.values(TOOL_EXECUTION_CLASS).includes(policy?.executionClass)) {
    throw new Error("resolved tool execution class required");
  }
  const expectedView = resolveExecutionView({
    executionClass: policy.executionClass,
    isolation,
  });
  if (policy?.view !== expectedView) {
    throw new Error("tool execution view does not match execution isolation policy");
  }
  return policy;
}

export function resolveToolExecutionAuthorization({ policy, isSuperAdmin = false } = {}) {
  const resolved = assertToolExecutionPolicy(policy);
  const unrestrictedHostCompute =
    resolved.executionClass === TOOL_EXECUTION_CLASS.WORKSPACE_COMPUTE &&
    resolved.view === TOOL_EXECUTION_VIEW.SERVICE_HOST_RESTRICTED;
  if (unrestrictedHostCompute && isSuperAdmin !== true) {
    return Object.freeze({
      allowed: false,
      code: "host_compute_requires_super_admin",
    });
  }
  return Object.freeze({ allowed: true, code: "" });
}

export function resolveWorkspaceSandboxLayout({ isolation, userId = "" } = {}) {
  const resolved = assertExecutionIsolationProtocol(isolation);
  const userPart = sanitizeExecutionIdentity(userId || "user") || "user";
  const scope = resolved.sandbox.scope;
  const userIsolated = scope === DOCKER_CONTAINER_SCOPE.USER;
  const root = WORKSPACE_SANDBOX_PATHS.ROOT;
  const userRoot = userIsolated ? root : `${root}/${userPart}`;
  return Object.freeze({
    scope,
    userIsolated,
    root,
    userPart,
    userRoot,
    opsWorkdir: `${userRoot}/${WORKSPACE_SANDBOX_PATHS.OPS_WORKDIR_RELATIVE}`,
    containerName: userIsolated
      ? `${resolved.sandbox.containerName}-${userPart}`
      : resolved.sandbox.containerName,
  });
}

export function resolveWorkspaceSandboxMountProjection({
  isolation,
  userId = "",
  hostUserRoot = "",
} = {}) {
  const layout = resolveWorkspaceSandboxLayout({ isolation, userId });
  const normalizedHostUserRoot = requiredString(hostUserRoot, "hostUserRoot");
  if (!isAbsoluteHostPath(normalizedHostUserRoot)) {
    throw new Error("hostUserRoot must be an absolute host path");
  }
  return Object.freeze({
    source: layout.userIsolated ? normalizedHostUserRoot : path.dirname(normalizedHostUserRoot),
    target: layout.root,
  });
}

export function resolveSandboxMountMappings(isolation = {}) {
  const resolved = assertExecutionIsolationProtocol(isolation);
  const mounts = resolved.sandbox.mounts;
  return Object.freeze(
    mounts.map((mount) =>
      Object.freeze({
        source: mount.source,
        target: mount.target,
        description: mount.description,
        readOnly: mount.readOnly,
      }),
    ),
  );
}

export function resolveToolExecutionClass(toolName = "") {
  const normalizedName = String(toolName || "").trim();
  const executionClass = TOOL_EXECUTION_REGISTRY[normalizedName];
  if (!executionClass) throw new Error(`tool execution class is not registered: ${normalizedName}`);
  return executionClass;
}

export function resolveToolExecutionPolicy({ toolName = "", globalConfig = {} } = {}) {
  const isolation = resolveExecutionIsolation(globalConfig);
  const executionClass = resolveToolExecutionClass(toolName);
  const view = resolveExecutionView({ executionClass, isolation });
  return Object.freeze({ executionClass, view, isolation });
}

export function projectToolExecutionMeta({ policy } = {}) {
  const resolved = assertToolExecutionPolicy(policy);
  const sandboxed = resolved.view === TOOL_EXECUTION_VIEW.WORKSPACE_SANDBOX;
  return Object.freeze({
    view: resolved.view,
    provider: sandboxed ? resolved.isolation.sandbox.provider : "host",
    ...(sandboxed ? { image: resolved.isolation.sandbox.image } : {}),
  });
}
