/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  filePath,
  normalizePathForPlatform,
  isAbsolutePathAnyPlatform,
  resolvePathPlatformFromContext,
  TOOL_PATH_VIEWS,
  normalizeSlashPath,
} from "./platform.mjs";
import {
  resolveSandboxMount,
  resolveSandboxUserRoot,
  resolveHostPath,
} from "./sandbox-mapping.mjs";
import { WORKSPACE_SANDBOX_PATHS } from "@noobot/execution-isolation-protocol";
import { isPathWithinRoot } from "./path-contract.mjs";

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
  return TOOL_PATH_SCOPE_ERRORS.has(String(error || "").trim());
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

export function classifyToolInputPath(inputPath = "", { agentContext = null } = {}) {
  const raw = String(inputPath || "").trim();
  if (!raw) {
    return {
      view: TOOL_PATH_VIEWS.EMPTY,
      raw,
      normalized: "",
      virtualRoot: "",
      sandboxRoot: "",
    };
  }
  const normalized = normalizePathForPlatform(raw, {
    platform: resolvePathPlatformFromContext(agentContext, ""),
  });
  if (!normalized && (raw === "." || raw === "./")) {
    return {
      view: TOOL_PATH_VIEWS.WORKSPACE_RELATIVE,
      raw,
      normalized: ".",
      virtualRoot: "",
      sandboxRoot: "",
    };
  }
  const sandboxRoot = normalizeWorkspaceRootAlias(normalized);
  if (sandboxRoot) {
    return {
      view: TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE,
      raw,
      normalized,
      virtualRoot: "",
      sandboxRoot,
    };
  }
  if (isAbsolutePathAnyPlatform(normalized)) {
    return {
      view: TOOL_PATH_VIEWS.HOST_ABSOLUTE,
      raw,
      normalized,
      virtualRoot: "",
      sandboxRoot: "",
    };
  }
  const firstSegment = normalized.split("/").filter(Boolean)[0] || "";
  if (VIRTUAL_TOOL_PATH_ROOTS.has(firstSegment)) {
    return {
      view: TOOL_PATH_VIEWS.VIRTUAL_RELATIVE,
      raw,
      normalized,
      virtualRoot: firstSegment,
      sandboxRoot: "",
    };
  }
  return {
    view: TOOL_PATH_VIEWS.WORKSPACE_RELATIVE,
    raw,
    normalized,
    virtualRoot: "",
    sandboxRoot: "",
  };
}

export function resolveToolInputPath({
  inputPath = "",
  agentContext = null,
  runtime = {},
  workspacePath = "",
  workspaceRoot = "",
  allowHostAbsolute = false,
  allowSandbox = false,
  allowVirtualRelative = false,
} = {}) {
  const classified = classifyToolInputPath(inputPath, { agentContext });
  const normalizedWorkspace = workspacePath ? filePath.resolve(workspacePath) : "";
  const normalizedWorkspaceRoot = workspaceRoot ? filePath.resolve(workspaceRoot) : "";
  if (!classified.normalized) {
    return {
      ...classified,
      ok: false,
      error: TOOL_PATH_RESOLUTION_ERROR.EMPTY_PATH,
      resolvedPath: "",
      workspaceRelativePath: "",
      hint: "Path is required.",
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
        hint: "Sandbox paths are not allowed here.",
      };
    }
    const mountedPath = resolveSandboxMount({
      sandboxPath: classified.normalized,
      runtime: { ...runtime, basePath: runtime?.basePath || normalizedWorkspace },
    });
    if (mountedPath) {
      return {
        ...classified,
        ok: true,
        resolvedPath: filePath.resolve(mountedPath.hostPath),
        workspaceRelativePath: "",
        mapped: true,
        logicalPath: mountedPath.sandboxPath,
        executionRoot: mountedPath.source,
        mountTarget: mountedPath.target,
        mountReadOnly: mountedPath.readOnly,
        error: "",
        hint: "",
      };
    }
    if (classified.sandboxRoot === "workspace" && normalizedWorkspaceRoot) {
      const normalizedSandboxPath = normalizeSlashPath(classified.normalized);
      const sandboxUserRoot = normalizeSlashPath(resolveSandboxUserRoot(runtime));
      if (sandboxUserRoot === WORKSPACE_SANDBOX_PATHS.ROOT && normalizedWorkspace) {
        const resolvedPath =
          normalizedSandboxPath === WORKSPACE_SANDBOX_PATHS.ROOT
            ? normalizedWorkspace
            : filePath.resolve(
                normalizedWorkspace,
                normalizedSandboxPath.slice(`${WORKSPACE_SANDBOX_PATHS.ROOT}/`.length),
              );
        return {
          ...classified,
          ok: true,
          resolvedPath,
          workspaceRelativePath: "",
          mapped: true,
          error: "",
          hint: "",
        };
      }
      if (sandboxUserRoot.startsWith(`${WORKSPACE_SANDBOX_PATHS.ROOT}/`)) {
        const resolvedPath =
          normalizedSandboxPath === WORKSPACE_SANDBOX_PATHS.ROOT
            ? normalizedWorkspaceRoot
            : filePath.resolve(
                normalizedWorkspaceRoot,
                normalizedSandboxPath.slice(`${WORKSPACE_SANDBOX_PATHS.ROOT}/`.length),
              );
        return {
          ...classified,
          ok: true,
          resolvedPath,
          workspaceRelativePath: "",
          mapped: true,
          error: "",
          hint: "",
        };
      }
      if (!sandboxUserRoot) {
        const resolvedPath =
          normalizedSandboxPath === WORKSPACE_SANDBOX_PATHS.ROOT
            ? normalizedWorkspaceRoot
            : filePath.resolve(
                normalizedWorkspaceRoot,
                normalizedSandboxPath.slice(`${WORKSPACE_SANDBOX_PATHS.ROOT}/`.length),
              );
        return {
          ...classified,
          ok: true,
          resolvedPath,
          workspaceRelativePath: "",
          mapped: true,
          error: "",
          hint: "",
        };
      }
    }
    const mappedBySandbox = resolveHostPath({
      path: classified.normalized,
      sandboxPath: classified.normalized,
      runtime: { ...runtime, basePath: runtime?.basePath || normalizedWorkspace },
      agentContext,
    });
    if (mappedBySandbox) {
      return {
        ...classified,
        ok: true,
        resolvedPath: filePath.resolve(mappedBySandbox),
        workspaceRelativePath: "",
        mapped: true,
        error: "",
        hint: "",
      };
    }
    return {
      ...classified,
      ok: false,
      resolvedPath: "",
      workspaceRelativePath: "",
      error: TOOL_PATH_RESOLUTION_ERROR.SANDBOX_PATH_NOT_MAPPED,
      hint: "Sandbox path is not mapped to a host path.",
    };
  }

  if (classified.view === TOOL_PATH_VIEWS.HOST_ABSOLUTE) {
    if (allowSandbox) {
      const mountedPath = resolveSandboxMount({
        sandboxPath: classified.normalized,
        runtime: { ...runtime, basePath: runtime?.basePath || normalizedWorkspace },
      });
      if (mountedPath) {
        return {
          ...classified,
          view: TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE,
          sandboxRoot: "mount",
          ok: true,
          resolvedPath: filePath.resolve(mountedPath.hostPath),
          workspaceRelativePath: "",
          mapped: true,
          logicalPath: mountedPath.sandboxPath,
          executionRoot: mountedPath.source,
          mountTarget: mountedPath.target,
          mountReadOnly: mountedPath.readOnly,
          error: "",
          hint: "",
        };
      }
    }
    if (!allowHostAbsolute) {
      return {
        ...classified,
        ok: false,
        resolvedPath: "",
        workspaceRelativePath: "",
        error: TOOL_PATH_RESOLUTION_ERROR.HOST_ABSOLUTE_NOT_ALLOWED,
        hint: "Host absolute paths are only allowed for super users.",
      };
    }
    return {
      ...classified,
      ok: true,
      resolvedPath: normalizePathForPlatform(classified.normalized),
      workspaceRelativePath: "",
      mapped: false,
      error: "",
      hint: "",
    };
  }

  if (classified.view === TOOL_PATH_VIEWS.VIRTUAL_RELATIVE && !allowVirtualRelative) {
    const relativeWithoutVirtualRoot = classified.normalized.split("/").slice(1).join("/");
    const sandboxHint = allowSandbox
      ? `Use /${classified.virtualRoot}/... for sandbox paths, or remove '${classified.virtualRoot}/' for workspace-relative paths.`
      : `Remove '${classified.virtualRoot}/' for a workspace-relative path.`;
    return {
      ...classified,
      ok: false,
      resolvedPath: "",
      workspaceRelativePath: "",
      candidateWorkspaceRelativePath: relativeWithoutVirtualRoot,
      ...(allowSandbox ? { candidateSandboxPath: `/${classified.normalized}` } : {}),
      error: TOOL_PATH_RESOLUTION_ERROR.VIRTUAL_RELATIVE_PATH_AMBIGUOUS,
      hint: sandboxHint,
    };
  }

  const resolvedWorkspacePath = filePath.resolve(
    normalizedWorkspace || ".",
    classified.normalized,
  );
  if (normalizedWorkspace && !isPathWithinRoot(normalizedWorkspace, resolvedWorkspacePath)) {
    return {
      ...classified,
      ok: false,
      resolvedPath: "",
      workspaceRelativePath: classified.normalized,
      mapped: false,
      error: TOOL_PATH_RESOLUTION_ERROR.WORKSPACE_PATH_OUT_OF_SCOPE,
      hint: "Workspace-relative path resolves outside the workspace root.",
    };
  }

  return {
    ...classified,
    ok: true,
    resolvedPath: resolvedWorkspacePath,
    workspaceRelativePath: classified.normalized,
    mapped: false,
    error: "",
    hint: "",
  };
}

/**
 * Return only path-scope information safe for tool consumers.
 *
 * Host filesystem enforcement details are intentionally not part of a public tool error.
 */
export function buildToolPathScopeErrorDetails({ field = "", pathView = "" } = {}) {
  return {
    ...(field ? { field } : {}),
    ...(pathView ? { pathView } : {}),
    scope: "workspace",
  };
}
