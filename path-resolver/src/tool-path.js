/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  filePath,
  normalizePathForPlatform,
  isAbsolutePathAnyPlatform,
  TOOL_PATH_VIEWS,
  normalizeSlashPath,
} from "./platform.js";
import { SANDBOX_MOUNT_KIND, resolveSandboxMount } from "./sandbox-mapping.js";
import { WORKSPACE_SANDBOX_PATHS } from "@noobot/execution-isolation-protocol";
import { PATH_REF_VIEWS, isPathWithinRoot, resolvePathRef } from "./path-contract.js";
import { text } from "@noobot/shared/value";

const VIRTUAL_TOOL_PATH_ROOTS = new Set(["project", "workspace", "workdir", "repo", "repository"]);

export const TOOL_PATH_RESOLUTION_ERROR = Object.freeze({
  EMPTY_PATH: "empty_path",
  HOST_ABSOLUTE_NOT_ALLOWED: "host_absolute_not_allowed",
  SANDBOX_PATH_NOT_ALLOWED: "sandbox_path_not_allowed",
  SANDBOX_PATH_NOT_MAPPED: "sandbox_path_not_mapped",
  VIRTUAL_RELATIVE_PATH_AMBIGUOUS: "virtual_relative_path_ambiguous",
  WORKSPACE_PATH_OUT_OF_SCOPE: "workspace_path_out_of_scope",
});

const TOOL_PATH_SCOPE_ERRORS = new Set([
  TOOL_PATH_RESOLUTION_ERROR.HOST_ABSOLUTE_NOT_ALLOWED,
  TOOL_PATH_RESOLUTION_ERROR.SANDBOX_PATH_NOT_ALLOWED,
  TOOL_PATH_RESOLUTION_ERROR.SANDBOX_PATH_NOT_MAPPED,
  TOOL_PATH_RESOLUTION_ERROR.WORKSPACE_PATH_OUT_OF_SCOPE,
]);

export function isToolPathScopeError(error = "") {
  return TOOL_PATH_SCOPE_ERRORS.has(text(error));
}

function normalizeWorkspaceRootAlias(value = "") {
  const normalized = normalizeSlashPath(value);
  if (
    normalized === WORKSPACE_SANDBOX_PATHS.ROOT ||
    normalized.startsWith(`${WORKSPACE_SANDBOX_PATHS.ROOT}/`)
  )
    return "workspace";
  if (normalized === "/project" || normalized.startsWith("/project/")) return "project";
  return "";
}

function buildClassifiedToolPath({ view, raw, normalized, virtualRoot = "", sandboxRoot = "" }) {
  return {
    view,
    raw,
    normalized,
    virtualRoot,
    sandboxRoot,
    candidateWorkspaceRelativePath: "",
    candidateSandboxPath: "",
  };
}

export function classifyToolInputPath(inputPath = "") {
  const raw = text(inputPath);
  if (!raw) {
    return buildClassifiedToolPath({ view: TOOL_PATH_VIEWS.EMPTY, raw, normalized: "" });
  }
  const normalized = normalizePathForPlatform(raw);
  if (!normalized && (raw === "." || raw === "./")) {
    return buildClassifiedToolPath({
      view: TOOL_PATH_VIEWS.WORKSPACE_RELATIVE,
      raw,
      normalized: ".",
    });
  }
  const sandboxRoot = normalizeWorkspaceRootAlias(normalized);
  if (sandboxRoot) {
    return buildClassifiedToolPath({
      view: TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE,
      raw,
      normalized,
      sandboxRoot,
    });
  }
  if (isAbsolutePathAnyPlatform(normalized)) {
    return buildClassifiedToolPath({ view: TOOL_PATH_VIEWS.HOST_ABSOLUTE, raw, normalized });
  }
  const firstSegment = normalized.split("/").filter(Boolean)[0] || "";
  if (VIRTUAL_TOOL_PATH_ROOTS.has(firstSegment)) {
    return buildClassifiedToolPath({
      view: TOOL_PATH_VIEWS.VIRTUAL_RELATIVE,
      raw,
      normalized,
      virtualRoot: firstSegment,
    });
  }
  return buildClassifiedToolPath({ view: TOOL_PATH_VIEWS.WORKSPACE_RELATIVE, raw, normalized });
}

function projectSandboxMount(mountedPath) {
  const resolved = {
    ok: true,
    resolvedPath: filePath.resolve(mountedPath.hostPath),
    workspaceRelativePath: "",
    mapped: true,
    error: "",
  };
  if (mountedPath.kind === SANDBOX_MOUNT_KIND.WORKSPACE) return resolved;

  const relative = mountedPath.sandboxPath.slice(mountedPath.target.length).replace(/^\/+/, "");
  return {
    ...resolved,
    mountPathRef: resolvePathRef({
      input: { view: PATH_REF_VIEWS.MOUNT, mount: mountedPath.target, path: relative || "." },
    }),
  };
}

export function resolveToolInputPath({
  inputPath = "",
  runtime = {},
  workspacePath = "",
  allowHostAbsolute = false,
  allowSandbox = false,
  allowVirtualRelative = false,
} = {}) {
  const classified = classifyToolInputPath(inputPath);
  const normalizedWorkspace = workspacePath ? filePath.resolve(workspacePath) : "";
  if (!classified.normalized) {
    return {
      ...classified,
      ok: false,
      error: TOOL_PATH_RESOLUTION_ERROR.EMPTY_PATH,
      resolvedPath: "",
      workspaceRelativePath: "",
    };
  }

  if (classified.view === TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE) {
    if (!allowSandbox) {
      return {
        ...classified,
        ok: false,
        resolvedPath: "",
        workspaceRelativePath: "",
        error: TOOL_PATH_RESOLUTION_ERROR.SANDBOX_PATH_NOT_ALLOWED,
      };
    }
    const mountedPath = resolveSandboxMount({ sandboxPath: classified.normalized, runtime });
    if (mountedPath) {
      return { ...classified, ...projectSandboxMount(mountedPath) };
    }
    return {
      ...classified,
      ok: false,
      resolvedPath: "",
      workspaceRelativePath: "",
      error: TOOL_PATH_RESOLUTION_ERROR.SANDBOX_PATH_NOT_MAPPED,
    };
  }

  if (classified.view === TOOL_PATH_VIEWS.HOST_ABSOLUTE) {
    if (allowSandbox) {
      const mountedPath = resolveSandboxMount({ sandboxPath: classified.normalized, runtime });
      if (mountedPath) {
        return {
          ...classified,
          view: TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE,
          sandboxRoot: "mount",
          ...projectSandboxMount(mountedPath),
        };
      }
      return {
        ...classified,
        view: TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE,
        sandboxRoot: "",
        ok: false,
        resolvedPath: "",
        workspaceRelativePath: "",
        mapped: false,
        error: TOOL_PATH_RESOLUTION_ERROR.SANDBOX_PATH_NOT_MAPPED,
      };
    }
    if (!allowHostAbsolute) {
      return {
        ...classified,
        ok: false,
        resolvedPath: "",
        workspaceRelativePath: "",
        error: TOOL_PATH_RESOLUTION_ERROR.HOST_ABSOLUTE_NOT_ALLOWED,
      };
    }
    return {
      ...classified,
      ok: true,
      resolvedPath: normalizePathForPlatform(classified.normalized),
      workspaceRelativePath: "",
      mapped: false,
      error: "",
    };
  }

  if (classified.view === TOOL_PATH_VIEWS.VIRTUAL_RELATIVE && !allowVirtualRelative) {
    const relativeWithoutVirtualRoot = classified.normalized.split("/").slice(1).join("/");
    return {
      ...classified,
      ok: false,
      resolvedPath: "",
      workspaceRelativePath: "",
      candidateWorkspaceRelativePath: relativeWithoutVirtualRoot,
      candidateSandboxPath: allowSandbox ? `/${classified.normalized}` : "",
      error: TOOL_PATH_RESOLUTION_ERROR.VIRTUAL_RELATIVE_PATH_AMBIGUOUS,
    };
  }

  const resolvedWorkspacePath = filePath.resolve(normalizedWorkspace || ".", classified.normalized);
  if (normalizedWorkspace && !isPathWithinRoot(normalizedWorkspace, resolvedWorkspacePath)) {
    return {
      ...classified,
      ok: false,
      resolvedPath: "",
      workspaceRelativePath: classified.normalized,
      mapped: false,
      error: TOOL_PATH_RESOLUTION_ERROR.WORKSPACE_PATH_OUT_OF_SCOPE,
    };
  }

  return {
    ...classified,
    ok: true,
    resolvedPath: resolvedWorkspacePath,
    workspaceRelativePath: classified.normalized,
    mapped: false,
    error: "",
  };
}

export function buildToolPathScopeErrorDetails({ field = "", pathView = "" } = {}) {
  return {
    ...(field ? { field } : {}),
    ...(pathView ? { pathView } : {}),
    scope: "workspace",
  };
}
