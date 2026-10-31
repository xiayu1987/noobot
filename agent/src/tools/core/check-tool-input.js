/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { lstat, realpath, stat } from "node:fs/promises";
import {
  authorizePathRef,
  PATH_CAPABILITIES,
  PATH_ENTRY_KIND,
  PATH_REF_VIEWS,
  filePath as path,
  normalizePathForPlatform,
  resolveConfiguredSandboxMounts,
  resolvePathRef,
  resolveToolInputPath,
  TOOL_PATH_RESOLUTION_ERROR,
  buildToolPathScopeErrorDetails,
  isToolPathScopeError,
  isPathWithinRoot,
} from "@noobot/path-resolver";
import {
  getBasePathFromAgentContext,
  getRuntimeFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { tTool } from "./tool-i18n.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { isSuperUserAgentContext } from "../../shared/utils/super-user.js";
import {
  isHostIsolationMode,
  isSandboxIsolationMode,
  resolveExecutionIsolation,
} from "@noobot/execution-isolation-protocol";
import { resolveConfiguredPathPolicy } from "../../config/core/path-policy-adapter.js";
import { text } from "@noobot/shared/value";

function tCheckInput(agentContext = {}, key = "") {
  const keyMap = {
    runtimeBasePathMissing: "common.runtimeBasePathMissing",
    fieldRequired: "common.fieldRequired",
    pathSeparatorsNotAllowed: "common.pathSeparatorsNotAllowed",
    controlCharsNotAllowed: "common.controlCharsNotAllowed",
    fileNameIncludedRequired: "common.fileNameIncludedRequired",
    pathOutOfScope: "common.pathOutOfScope",
    fileNotFound: "common.fileNotFound",
  };
  return tTool(getRuntimeFromAgentContext(agentContext), keyMap[text(key)] || "");
}

function resolveToolPathErrorText(agentContext = {}, resolution = {}, fieldName = "filePath") {
  const keyMap = {
    [TOOL_PATH_RESOLUTION_ERROR.EMPTY_PATH]: "tools.file.pathErrorRequired",
    [TOOL_PATH_RESOLUTION_ERROR.HOST_ABSOLUTE_NOT_ALLOWED]:
      "tools.file.pathErrorHostAbsoluteNotAllowed",
    [TOOL_PATH_RESOLUTION_ERROR.SANDBOX_PATH_NOT_ALLOWED]: "tools.file.pathErrorSandboxNotAllowed",
    [TOOL_PATH_RESOLUTION_ERROR.SANDBOX_PATH_NOT_MAPPED]: "tools.file.pathErrorSandboxNotMapped",
    [TOOL_PATH_RESOLUTION_ERROR.VIRTUAL_RELATIVE_PATH_AMBIGUOUS]:
      "tools.file.pathErrorVirtualRelativeAmbiguous",
    [TOOL_PATH_RESOLUTION_ERROR.WORKSPACE_PATH_OUT_OF_SCOPE]:
      "tools.file.pathErrorWorkspaceOutOfScope",
  };
  const key = keyMap[resolution.error];
  return key
    ? tTool(getRuntimeFromAgentContext(agentContext), key, {
        field: fieldName,
        virtualRoot: resolution.virtualRoot,
        suggestedPath: resolution.candidateWorkspaceRelativePath,
        suggestedSandboxPath: resolution.candidateSandboxPath,
      })
    : tCheckInput(agentContext, "pathOutOfScope");
}

async function statExisting(readStats, targetPath) {
  try {
    return await readStats(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const lstatExisting = (targetPath) => statExisting(lstat, targetPath);

function resolveEntryKind(stats) {
  if (stats.isFile()) return PATH_ENTRY_KIND.FILE;
  if (stats.isDirectory()) return PATH_ENTRY_KIND.DIRECTORY;
  return PATH_ENTRY_KIND.OTHER;
}

async function resolveExistingParent(targetPath = "") {
  let candidate = path.dirname(path.resolve(targetPath));
  while (candidate && candidate !== path.dirname(candidate)) {
    if (await lstatExisting(candidate)) return realpath(candidate);
    candidate = path.dirname(candidate);
  }
  return realpath(candidate || path.parse(path.resolve(targetPath)).root);
}

function resolveRuntimeBasePath(agentContext = {}) {
  const basePath = getBasePathFromAgentContext(agentContext);
  if (!basePath) {
    throw recoverableToolError(tCheckInput(agentContext, "runtimeBasePathMissing"), {
      code: ERROR_CODE.RECOVERABLE_RUNTIME_BASEPATH_MISSING,
    });
  }
  return path.resolve(basePath);
}

function resolveRuntimeIsolation(runtime = {}) {
  return resolveExecutionIsolation(runtime.globalConfig);
}

export function canUseHostPathsForWorkspaceTools(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  return (
    isSuperUserAgentContext(agentContext) &&
    isHostIsolationMode(resolveRuntimeIsolation(runtime).mode)
  );
}

export function projectToolPathRef(pathRef = {}) {
  const resolved = resolvePathRef({ input: pathRef });
  if (resolved.view === "attachment") {
    return Object.freeze({ view: resolved.view, identity: resolved.identity });
  }
  if (resolved.view === PATH_REF_VIEWS.MOUNT) {
    return Object.freeze({ view: resolved.view, mount: resolved.mount, path: resolved.path });
  }
  return Object.freeze({
    view: resolved.view,
    path: resolved.view === "workspace" && !resolved.path ? "." : resolved.path,
  });
}

function assertValidSimpleFileName({ fileName = "", fieldName = "fileName", agentContext }) {
  const normalizedFileName = text(fileName);
  if (!normalizedFileName) {
    throw recoverableToolError(`${fieldName} ${tCheckInput(agentContext, "fieldRequired")}`, {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      details: { field: fieldName },
    });
  }
  if (normalizedFileName.includes("/") || normalizedFileName.includes("\\")) {
    throw recoverableToolError(
      `${fieldName} ${tCheckInput(agentContext, "pathSeparatorsNotAllowed")}`,
      {
        code: ERROR_CODE.RECOVERABLE_INVALID_FILE_NAME,
        details: { field: fieldName, value: normalizedFileName },
      },
    );
  }
  if (/[\0-\x1F\x7F]/.test(normalizedFileName)) {
    throw recoverableToolError(
      `${fieldName} ${tCheckInput(agentContext, "controlCharsNotAllowed")}`,
      {
        code: ERROR_CODE.RECOVERABLE_INVALID_FILE_NAME,
        details: { field: fieldName, value: normalizedFileName },
      },
    );
  }
  return normalizedFileName;
}

export function assertValidFileNameFromPath({
  filePath = "",
  fieldName = "filePath",
  agentContext,
}) {
  const normalizedPath = text(filePath);
  if (!normalizedPath) {
    throw recoverableToolError(`${fieldName} ${tCheckInput(agentContext, "fieldRequired")}`, {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      details: { field: fieldName },
    });
  }
  const normalizedPathForName = normalizePathForPlatform(normalizedPath);
  const parsedName = path.basename(path.normalize(normalizedPathForName));
  if (!parsedName || parsedName === "." || parsedName === path.sep) {
    throw recoverableToolError(
      `${fieldName} ${tCheckInput(agentContext, "fileNameIncludedRequired")}`,
      {
        code: ERROR_CODE.RECOVERABLE_INVALID_FILE_NAME,
        details: { field: fieldName, value: normalizedPath },
      },
    );
  }
  return assertValidSimpleFileName({
    fileName: parsedName,
    fieldName,
    agentContext,
  });
}

export async function resolveAuthorizedUserWorkspaceFilePath({
  filePath = "",
  agentContext = {},
  fieldName = "filePath",
  mustExist = false,
  capability = PATH_CAPABILITIES.FILE_READ,
  requiredExecutionRoot = "",
}) {
  const normalizedPath = text(filePath);
  if (!normalizedPath) {
    throw recoverableToolError(`${fieldName} ${tCheckInput(agentContext, "fieldRequired")}`, {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      details: { field: fieldName },
    });
  }

  const workspacePath = resolveRuntimeBasePath(agentContext);
  const runtime = getRuntimeFromAgentContext(agentContext);
  const userId = text(runtime.systemRuntime.userId);
  const isolation = resolveRuntimeIsolation(runtime);
  const isSuperUser = isSuperUserAgentContext(agentContext);
  const resolvedToolPath = resolveToolInputPath({
    inputPath: normalizedPath,
    runtime,
    workspacePath,
    allowHostAbsolute: true,
    allowSandbox: isSandboxIsolationMode(isolation.mode),
    allowVirtualRelative: false,
  });
  if (!resolvedToolPath.ok) {
    const localizedHint = resolveToolPathErrorText(agentContext, resolvedToolPath, fieldName);
    throw recoverableToolError(localizedHint, {
      code: isToolPathScopeError(resolvedToolPath.error)
        ? ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE
        : ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: {
        field: fieldName,
        filePath: normalizedPath,
        pathView: resolvedToolPath.view,
        error: resolvedToolPath.error,
        hint: localizedHint,
        suggestedPath: resolvedToolPath.candidateWorkspaceRelativePath,
        suggestedSandboxPath: resolvedToolPath.candidateSandboxPath,
      },
    });
  }
  const resolvedTargetPath = resolvedToolPath.resolvedPath;
  const normalizedRequiredExecutionRoot = text(requiredExecutionRoot)
    ? path.resolve(requiredExecutionRoot)
    : "";
  if (
    normalizedRequiredExecutionRoot &&
    !isPathWithinRoot(normalizedRequiredExecutionRoot, resolvedTargetPath)
  ) {
    throw recoverableToolError(tCheckInput(agentContext, "pathOutOfScope"), {
      code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
      details: {
        field: fieldName,
        scope: "required_execution_root",
        reason: "path_outside_required_root",
      },
    });
  }

  const logicalPathRef =
    resolvedToolPath.mountPathRef ??
    resolvePathRef({
      input: resolvedTargetPath,
      workspaceRoot: workspacePath,
      owner: userId,
    });
  const configuredPathPolicy = resolveConfiguredPathPolicy(runtime.globalConfig);
  const principal = {
    userId,
    role: isSuperUser ? "super_admin" : "regular_user",
  };

  const mounts = resolveConfiguredSandboxMounts(runtime);
  const authorizeExecutionPath = (executionPath) =>
    authorizePathRef({
      pathRef: logicalPathRef,
      principal,
      capability,
      pathPolicy: configuredPathPolicy,
      executionPath,
      workspaceRoot: workspacePath,
      mounts,
    });

  const targetAuthorization = authorizeExecutionPath(resolvedTargetPath);
  if (!targetAuthorization.allowed) {
    throw recoverableToolError(tCheckInput(agentContext, "pathOutOfScope"), {
      code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
      details: {
        ...buildToolPathScopeErrorDetails({
          field: fieldName,
          pathView: resolvedToolPath.view,
        }),
        reason: targetAuthorization.code,
      },
    });
  }

  const existingInfo = await lstatExisting(resolvedTargetPath);
  if (
    existingInfo?.isSymbolicLink() &&
    configuredPathPolicy.resolution.followSymbolicLinks !== true
  ) {
    throw recoverableToolError(tCheckInput(agentContext, "pathOutOfScope"), {
      code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
      details: {
        field: fieldName,
        pathView: logicalPathRef.view,
        scope: logicalPathRef.view,
        reason: "symbolic_link_not_allowed",
      },
    });
  }
  const targetInfo = existingInfo ? await statExisting(stat, resolvedTargetPath) : null;
  if (existingInfo && !targetInfo) {
    throw recoverableToolError(tCheckInput(agentContext, "pathOutOfScope"), {
      code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
      details: {
        field: fieldName,
        pathView: logicalPathRef.view,
        scope: "real_path",
        reason: "dangling_symbolic_link",
      },
    });
  }
  if (mustExist && !targetInfo) {
    throw recoverableToolError(`${tCheckInput(agentContext, "fileNotFound")}: ${normalizedPath}`, {
      code: ERROR_CODE.RECOVERABLE_FILE_NOT_FOUND,
      details: { field: fieldName, filePath: normalizedPath },
    });
  }
  let resourcePath = resolvedTargetPath;
  let entryKind = PATH_ENTRY_KIND.MISSING;
  if (targetInfo) {
    const realTarget = await realpath(resolvedTargetPath);
    resourcePath = realTarget;
    entryKind = resolveEntryKind(targetInfo);
    if (
      normalizedRequiredExecutionRoot &&
      !isPathWithinRoot(await realpath(normalizedRequiredExecutionRoot), realTarget)
    ) {
      throw recoverableToolError(tCheckInput(agentContext, "pathOutOfScope"), {
        code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
        details: {
          field: fieldName,
          scope: "required_execution_root",
          reason: "real_path_outside_required_root",
        },
      });
    }
    const realAuthorization = authorizeExecutionPath(realTarget);
    if (!realAuthorization.allowed)
      throw recoverableToolError(tCheckInput(agentContext, "pathOutOfScope"), {
        code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
        details: {
          field: fieldName,
          pathView: logicalPathRef.view,
          scope: "real_path",
          reason: realAuthorization.code,
        },
      });
  }
  if (
    !targetInfo &&
    capability !== PATH_CAPABILITIES.FILE_READ &&
    capability !== PATH_CAPABILITIES.FILE_SEARCH
  ) {
    const realParent = await resolveExistingParent(resolvedTargetPath);
    const projectedTarget = path.join(realParent, path.basename(resolvedTargetPath));
    resourcePath = projectedTarget;
    const parentAuthorization = authorizeExecutionPath(projectedTarget);
    if (!parentAuthorization.allowed)
      throw recoverableToolError(tCheckInput(agentContext, "pathOutOfScope"), {
        code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
        details: {
          field: fieldName,
          pathView: logicalPathRef.view,
          scope: "write_parent",
          reason: parentAuthorization.code,
        },
      });
  }

  return Object.freeze({
    executionPath: resolvedTargetPath,
    resourcePath,
    entryKind,
    pathRef: logicalPathRef,
    toolPath: Object.freeze({ ...resolvedToolPath }),
  });
}
