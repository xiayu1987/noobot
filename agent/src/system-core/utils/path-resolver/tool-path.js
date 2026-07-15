/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath, normalizePathForPlatform, isAbsolutePathAnyPlatform, resolvePathPlatformFromContext, TOOL_PATH_VIEWS, normalizeSlashPath } from "./platform.js";
import { resolveSandboxUserRoot, resolveHostPath } from "./sandbox-mapping.js";

const VIRTUAL_TOOL_PATH_ROOTS = new Set(["project", "workspace", "workdir", "repo", "repository"]);

function normalizeWorkspaceRootAlias(value = "") {
  const normalized = normalizeSlashPath(value);
  if (normalized === "/workspace" || normalized.startsWith("/workspace/")) return "workspace";
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

function resolveSharedToolHostPath({ inputPath = "", runtime = {}, agentContext = null } = {}) {
  const payload = {
    path: inputPath,
    sandboxPath: inputPath,
    runtime,
    agentContext,
  };
  const resolverCandidates = [
    runtime?.sharedTools?.resolveHostPath,
    runtime?.sharedTools?.toHostPath,
    runtime?.sharedTools?.pathMapper?.toHostPath,
  ];
  for (const resolver of resolverCandidates) {
    if (typeof resolver !== "function") continue;
    try {
      const resolved = String(resolver(payload) || "").trim();
      if (resolved) return filePath.resolve(resolved);
    } catch {
      // Ignore resolver errors; path validation remains deterministic.
    }
  }
  return "";
}

export function resolveToolInputPath({
  inputPath = "",
  agentContext = null,
  runtime = {},
  workspacePath = "",
  workspaceRoot = "",
  allowHostAbsolute = false,
  allowSandbox = true,
  allowVirtualRelative = true,
} = {}) {
  const classified = classifyToolInputPath(inputPath, { agentContext });
  const normalizedWorkspace = workspacePath ? filePath.resolve(workspacePath) : "";
  const normalizedWorkspaceRoot = workspaceRoot ? filePath.resolve(workspaceRoot) : "";
  if (!classified.normalized) {
    return {
      ...classified,
      ok: false,
      error: "empty_path",
      resolvedPath: "",
      workspaceRelativePath: "",
      hint: "Path is required.",
    };
  }

  const sharedResolved = resolveSharedToolHostPath({
    inputPath: classified.normalized,
    runtime,
    agentContext,
  });
  if (sharedResolved) {
    return {
      ...classified,
      ok: true,
      resolvedPath: sharedResolved,
      workspaceRelativePath: "",
      mapped: true,
      error: "",
      hint: "",
    };
  }

  if (classified.view === TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE) {
    if (!allowSandbox) {
      return {
        ...classified,
        ok: false,
        resolvedPath: "",
        workspaceRelativePath: "",
        error: "sandbox_path_not_allowed",
        hint: "Sandbox paths are not allowed here.",
      };
    }
    if (classified.sandboxRoot === "project" && normalizedWorkspace && !resolveSandboxUserRoot(runtime)) {
      const normalizedProjectPath = normalizeSlashPath(classified.normalized);
      const resolvedPath = normalizedProjectPath === "/project"
        ? normalizedWorkspace
        : filePath.resolve(normalizedWorkspace, normalizedProjectPath.slice("/project/".length));
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
    if (classified.sandboxRoot === "workspace" && normalizedWorkspaceRoot) {
      const normalizedSandboxPath = normalizeSlashPath(classified.normalized);
      const sandboxUserRoot = normalizeSlashPath(resolveSandboxUserRoot(runtime));
      if (sandboxUserRoot === "/workspace" && normalizedWorkspace) {
        const resolvedPath = normalizedSandboxPath === "/workspace"
          ? normalizedWorkspace
          : filePath.resolve(normalizedWorkspace, normalizedSandboxPath.slice("/workspace/".length));
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
      if (sandboxUserRoot.startsWith("/workspace/")) {
        const resolvedPath = normalizedSandboxPath === "/workspace"
          ? normalizedWorkspaceRoot
          : filePath.resolve(normalizedWorkspaceRoot, normalizedSandboxPath.slice("/workspace/".length));
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
        const resolvedPath = normalizedSandboxPath === "/workspace"
          ? normalizedWorkspaceRoot
          : filePath.resolve(normalizedWorkspaceRoot, normalizedSandboxPath.slice("/workspace/".length));
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
      error: "sandbox_path_not_mapped",
      hint: "Sandbox path is not mapped to a host path.",
    };
  }

  if (classified.view === TOOL_PATH_VIEWS.HOST_ABSOLUTE) {
    if (!allowHostAbsolute) {
      return {
        ...classified,
        ok: false,
        resolvedPath: "",
        workspaceRelativePath: "",
        error: "host_absolute_not_allowed",
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
    return {
      ...classified,
      ok: false,
      resolvedPath: "",
      workspaceRelativePath: "",
      candidateWorkspaceRelativePath: relativeWithoutVirtualRoot,
      candidateSandboxPath: `/${classified.normalized}`,
      error: "virtual_relative_path_ambiguous",
      hint: `Use /${classified.virtualRoot}/... for sandbox paths, or remove '${classified.virtualRoot}/' for workspace-relative paths.`,
    };
  }

  return {
    ...classified,
    ok: true,
    resolvedPath: filePath.resolve(normalizedWorkspace || ".", classified.normalized),
    workspaceRelativePath: classified.normalized,
    mapped: false,
    error: "",
    hint: "",
  };
}
