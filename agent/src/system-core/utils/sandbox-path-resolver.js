/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSandboxProvider } from "../config/index.js";

export function normalizeSlashPath(value = "") {
  return String(value || "").trim().replaceAll("\\", "/");
}

function sanitizeSandboxUserPart(input = "") {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function resolveExecuteScriptConfig(runtime = {}) {
  const globalCfg =
    runtime?.globalConfig?.tools?.execute_script &&
    typeof runtime.globalConfig.tools.execute_script === "object"
      ? runtime.globalConfig.tools.execute_script
      : {};
  const userCfg =
    runtime?.userConfig?.tools?.execute_script &&
    typeof runtime.userConfig.tools.execute_script === "object"
      ? runtime.userConfig.tools.execute_script
      : {};
  return {
    ...globalCfg,
    ...userCfg,
  };
}

function normalizeContainerTarget(target = "") {
  const normalized = normalizeSlashPath(target);
  if (!normalized) return "";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function resolveExecuteScriptMountMappings(runtime = {}) {
  const scriptConfig = resolveExecuteScriptConfig(runtime);
  const sandboxProviderCfg =
    ((scriptConfig?.sandboxProvider &&
      typeof scriptConfig.sandboxProvider === "object"
      ? scriptConfig.sandboxProvider
      : null) ||
      (scriptConfig?.sandbox_provider &&
      typeof scriptConfig.sandbox_provider === "object"
        ? scriptConfig.sandbox_provider
        : null) ||
      {});
  const provider = normalizeSandboxProvider(
    sandboxProviderCfg?.default || "docker",
  );
  const providerDetail =
    sandboxProviderCfg?.[provider] && typeof sandboxProviderCfg[provider] === "object"
      ? sandboxProviderCfg[provider]
      : {};
  const dockerMounts = Array.isArray(providerDetail?.dockerMounts)
    ? providerDetail.dockerMounts
    : Array.isArray(providerDetail?.docker_mounts)
      ? providerDetail.docker_mounts
      : [];
  const normalizedMounts = dockerMounts
    .map((item) => (item && typeof item === "object" ? item : {}))
    .map((item) => ({
      source: normalizeSlashPath(
        item?.source || item?.mountSource || item?.mount_source || "",
      ),
      target: normalizeContainerTarget(
        item?.target || item?.mountTarget || item?.mount_target || "",
      ),
    }))
    .filter((item) => Boolean(item.source && item.target));
  if (normalizedMounts.length) return normalizedMounts;

  const legacySource = normalizeSlashPath(
    providerDetail?.dockerProjectMountSource ||
      providerDetail?.docker_project_mount_source ||
      "",
  );
  const legacyTarget = normalizeContainerTarget(
    providerDetail?.dockerProjectMountTarget ||
      providerDetail?.docker_project_mount_target ||
      "",
  );
  if (legacySource && legacyTarget) {
    return [{ source: legacySource, target: legacyTarget }];
  }
  return [];
}

function resolveSandboxUserRoot(runtime = {}) {
  const scriptConfig = resolveExecuteScriptConfig(runtime);
  const sandboxMode =
    scriptConfig?.sandboxMode === true || scriptConfig?.sandbox_mode === true;
  if (!sandboxMode) return "";
  const sandboxProviderCfg =
    ((scriptConfig?.sandboxProvider &&
      typeof scriptConfig.sandboxProvider === "object"
      ? scriptConfig.sandboxProvider
      : null) ||
      (scriptConfig?.sandbox_provider &&
      typeof scriptConfig.sandbox_provider === "object"
        ? scriptConfig.sandbox_provider
        : null) ||
      {});
  const provider = normalizeSandboxProvider(
    sandboxProviderCfg?.default || "docker",
  );
  if (provider === "firejail") return "$HOME";
  if (provider === "bubblewrap") return "/workspace";
  const providerDetail =
    sandboxProviderCfg?.[provider] && typeof sandboxProviderCfg[provider] === "object"
      ? sandboxProviderCfg[provider]
      : {};
  const scope = String(
    providerDetail?.dockerContainerScope ||
      providerDetail?.docker_container_scope ||
      "global",
  )
    .trim()
    .toLowerCase();
  if (scope === "user") return "/workspace";
  const userPart = sanitizeSandboxUserPart(runtime?.userId || "user") || "user";
  return `/workspace/${userPart}`;
}

function mapPathByMappings(filePath = "", mappings = []) {
  const normalizedFilePath = normalizeSlashPath(filePath);
  if (!normalizedFilePath || !Array.isArray(mappings) || !mappings.length) return "";
  for (const mapping of mappings) {
    const source = normalizeSlashPath(mapping?.source || mapping?.hostPath || mapping?.host || "");
    const target = normalizeSlashPath(mapping?.target || mapping?.sandboxPath || mapping?.sandbox || "");
    if (!source || !target) continue;
    if (normalizedFilePath === source) return target;
    if (normalizedFilePath.startsWith(`${source}/`)) {
      return `${target}${normalizedFilePath.slice(source.length)}`;
    }
  }
  return "";
}

function mapPathByReverseMappings(filePath = "", mappings = []) {
  const normalizedFilePath = normalizeSlashPath(filePath);
  if (!normalizedFilePath || !Array.isArray(mappings) || !mappings.length) return "";
  const normalizedMappings = mappings
    .map((mapping) => ({
      source: normalizeSlashPath(mapping?.source || mapping?.hostPath || mapping?.host || ""),
      target: normalizeSlashPath(mapping?.target || mapping?.sandboxPath || mapping?.sandbox || ""),
    }))
    .filter((mapping) => Boolean(mapping.source && mapping.target))
    .sort((leftItem, rightItem) => rightItem.target.length - leftItem.target.length);
  for (const mapping of normalizedMappings) {
    if (normalizedFilePath === mapping.target) return mapping.source;
    if (normalizedFilePath.startsWith(`${mapping.target}/`)) {
      return `${mapping.source}${normalizedFilePath.slice(mapping.target.length)}`;
    }
  }
  return "";
}

export function resolveSandboxPathMappings(runtime = {}) {
  const systemRuntimeMappings = runtime?.systemRuntime?.config?.sandboxPathMappings;
  const userMappings = runtime?.userConfig?.tools?.sandboxPathMappings;
  const globalMappings = runtime?.globalConfig?.tools?.sandboxPathMappings;
  const mappings = Array.isArray(systemRuntimeMappings)
    ? systemRuntimeMappings
    : (Array.isArray(userMappings) ? userMappings : globalMappings);
  const configuredMappings = Array.isArray(mappings) ? mappings : [];
  return [
    ...configuredMappings,
    ...resolveExecuteScriptMountMappings(runtime),
  ]
    .map((item) => (item && typeof item === "object" ? item : {}))
    .map((item) => ({
      source: normalizeSlashPath(item?.source || item?.hostPath || item?.host || ""),
      target: normalizeSlashPath(item?.target || item?.sandboxPath || item?.sandbox || ""),
    }))
    .filter((item) => Boolean(item.source && item.target))
    .sort((leftItem, rightItem) => rightItem.source.length - leftItem.source.length);
}

export function resolveSandboxPath({
  path = "",
  hostPath = "",
  relativePath = "",
  runtime = {},
  agentContext = null,
} = {}) {
  const normalizedHostPath = normalizeSlashPath(hostPath || path);
  if (!normalizedHostPath && !String(relativePath || "").trim()) return "";

  const mappedByConfig = mapPathByMappings(
    normalizedHostPath,
    resolveSandboxPathMappings(runtime),
  );
  if (mappedByConfig) return String(mappedByConfig || "").trim();

  const sandboxUserRoot = resolveSandboxUserRoot(runtime);
  const hostBasePath = String(
    runtime?.basePath || agentContext?.environment?.workspace?.basePath || "",
  ).trim();
  const normalizedHostBasePath = normalizeSlashPath(hostBasePath);
  if (sandboxUserRoot && normalizedHostBasePath && normalizedHostPath) {
    if (normalizedHostPath === normalizedHostBasePath) return sandboxUserRoot;
    if (normalizedHostPath.startsWith(`${normalizedHostBasePath}/`)) {
      return `${sandboxUserRoot}${normalizedHostPath.slice(normalizedHostBasePath.length)}`;
    }
  }

  const sandboxRoot = String(
    runtime?.systemRuntime?.staticInfo?.sandboxRoot ||
      runtime?.systemRuntime?.staticInfo?.sandbox?.sandboxRoot ||
      agentContext?.environment?.staticInfo?.sandboxRoot ||
      agentContext?.environment?.staticInfo?.sandbox?.sandboxRoot ||
      "",
  ).trim();
  const normalizedSandboxRoot = normalizeSlashPath(sandboxRoot);
  if (normalizedSandboxRoot) {
    if (sandboxUserRoot && normalizedHostPath && normalizedHostBasePath) {
      if (normalizedHostPath === normalizedHostBasePath) return sandboxUserRoot;
      if (normalizedHostPath.startsWith(`${normalizedHostBasePath}/`)) {
        return `${sandboxUserRoot}${normalizedHostPath.slice(normalizedHostBasePath.length)}`;
      }
    }
    const normalizedRelativePath = normalizeSlashPath(relativePath).replace(/^\/+/, "");
    if (normalizedRelativePath) return `${normalizedSandboxRoot}/${normalizedRelativePath}`;
  }

  return "";
}

export function resolveHostPath({
  path = "",
  sandboxPath = "",
  runtime = {},
  agentContext = null,
} = {}) {
  const normalizedSandboxPath = normalizeSlashPath(sandboxPath || path);
  if (!normalizedSandboxPath) return "";

  const mappedByConfig = mapPathByReverseMappings(
    normalizedSandboxPath,
    resolveSandboxPathMappings(runtime),
  );
  if (mappedByConfig) return String(mappedByConfig || "").trim();

  const sandboxUserRoot = resolveSandboxUserRoot(runtime);
  const hostBasePath = String(
    runtime?.basePath || agentContext?.environment?.workspace?.basePath || "",
  ).trim();
  const normalizedHostBasePath = normalizeSlashPath(hostBasePath);
  const normalizedSandboxUserRoot = normalizeSlashPath(sandboxUserRoot);
  if (normalizedSandboxUserRoot && normalizedHostBasePath) {
    if (normalizedSandboxPath === normalizedSandboxUserRoot) return normalizedHostBasePath;
    if (normalizedSandboxPath.startsWith(`${normalizedSandboxUserRoot}/`)) {
      return `${normalizedHostBasePath}${normalizedSandboxPath.slice(normalizedSandboxUserRoot.length)}`;
    }
  }

  const sandboxRoot = String(
    runtime?.systemRuntime?.staticInfo?.sandboxRoot ||
      runtime?.systemRuntime?.staticInfo?.sandbox?.sandboxRoot ||
      agentContext?.environment?.staticInfo?.sandboxRoot ||
      agentContext?.environment?.staticInfo?.sandbox?.sandboxRoot ||
      "",
  ).trim();
  const normalizedSandboxRoot = normalizeSlashPath(sandboxRoot);
  if (normalizedSandboxRoot && normalizedHostBasePath) {
    if (normalizedSandboxPath === normalizedSandboxRoot) return normalizedHostBasePath;
    if (normalizedSandboxPath.startsWith(`${normalizedSandboxRoot}/`)) {
      return `${normalizedHostBasePath}${normalizedSandboxPath.slice(normalizedSandboxRoot.length)}`;
    }
  }

  return "";
}

export function resolveAttachmentDisplayPath({
  meta = {},
  path = "",
  hostPath = "",
  relativePath = "",
  runtime = {},
  agentContext = null,
  purpose = "attachment_display_path",
} = {}) {
  const sourceMeta = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
  const metaSandboxPath = String(
    sourceMeta?.sandboxPath ||
      sourceMeta?.sandboxViewPath ||
      sourceMeta?.sandbox_file_path ||
      "",
  ).trim();
  if (metaSandboxPath) return metaSandboxPath;

  const resolvedHostPath = String(hostPath || path || sourceMeta?.path || "").trim();
  const resolvedRelativePath = String(relativePath || sourceMeta?.relativePath || "").trim();
  const sandboxPath = resolveSandboxPath({
    path: resolvedHostPath,
    hostPath: resolvedHostPath,
    relativePath: resolvedRelativePath,
    runtime,
    agentContext,
    purpose,
  });
  if (sandboxPath) return String(sandboxPath || "").trim();
  return String(resolvedRelativePath || resolvedHostPath || sourceMeta?.name || "").trim();
}
