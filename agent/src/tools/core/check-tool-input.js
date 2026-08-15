/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, lstat, realpath } from "node:fs/promises";
import {
  authorizePathRef,
  PATH_CAPABILITIES,
  filePath as path,
  normalizePathForPlatform,
  resolvePathPolicy,
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
  getSessionIdsFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { normalizeParentSessionId } from "../../context/parent-session-id-resolver.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { tTool } from "./tool-i18n.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { isSuperUserAgentContext } from "../../shared/utils/super-user.js";
import {
  EXECUTION_ISOLATION_MODE,
  resolveExecutionIsolation,
} from "@noobot/execution-isolation-protocol";

function tCheckInput(agentContext = {}, key = "") {
  const keyMap = {
    runtimeBasePathMissing: "common.runtimeBasePathMissing",
    fieldRequired: "common.fieldRequired",
    pathSeparatorsNotAllowed: "common.pathSeparatorsNotAllowed",
    controlCharsNotAllowed: "common.controlCharsNotAllowed",
    fileNameIncludedRequired: "common.fileNameIncludedRequired",
    invalidUuidFormat: "common.invalidUuidFormat",
    sessionContextMissing: "common.sessionContextMissing",
    parentSessionNotFound: "common.parentSessionNotFound",
    notFoundInParentSessionMessages: "common.notFoundInParentSessionMessages",
    pathOutOfScope: "common.pathOutOfScope",
    fileNotFound: "common.fileNotFound",
  };
  return tTool(agentContext, keyMap[String(key || "").trim()] || "");
}

function resolveToolPathErrorText(agentContext = {}, resolution = {}, fieldName = "filePath") {
  const keyMap = {
    [TOOL_PATH_RESOLUTION_ERROR.EMPTY_PATH]: "tools.file.pathErrorRequired",
    [TOOL_PATH_RESOLUTION_ERROR.HOST_ABSOLUTE_NOT_ALLOWED]:
      "tools.file.pathErrorHostAbsoluteNotAllowed",
    [TOOL_PATH_RESOLUTION_ERROR.SANDBOX_PATH_NOT_ALLOWED]:
      "tools.file.pathErrorSandboxNotAllowed",
    [TOOL_PATH_RESOLUTION_ERROR.SANDBOX_PATH_NOT_MAPPED]:
      "tools.file.pathErrorSandboxNotMapped",
    [TOOL_PATH_RESOLUTION_ERROR.VIRTUAL_RELATIVE_PATH_AMBIGUOUS]:
      "tools.file.pathErrorVirtualRelativeAmbiguous",
    [TOOL_PATH_RESOLUTION_ERROR.WORKSPACE_PATH_OUT_OF_SCOPE]:
      "tools.file.pathErrorWorkspaceOutOfScope",
  };
  const key = keyMap[resolution?.error];
  return key
    ? tTool(agentContext, key, {
        field: fieldName,
        virtualRoot: String(resolution?.virtualRoot || ""),
        suggestedPath: String(resolution?.candidateWorkspaceRelativePath || ""),
        suggestedSandboxPath: String(resolution?.candidateSandboxPath || ""),
      })
    : tCheckInput(agentContext, "pathOutOfScope");
}

function isUuid(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
}

async function resolveExistingParent(targetPath = "") {
  let candidate = path.dirname(path.resolve(targetPath));
  while (candidate && candidate !== path.dirname(candidate)) {
    if (await lstat(candidate).catch(() => null)) return realpath(candidate);
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

function resolveUserWorkspacePath(agentContext = {}) {
  return resolveRuntimeBasePath(agentContext);
}

function resolveWorkspaceRoot(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const workspaceRoot = String(runtime?.globalConfig?.workspaceRoot || "").trim();
  return workspaceRoot ? path.resolve(workspaceRoot) : "";
}

function resolveRuntimeIsolation(runtime = {}) {
  return resolveExecutionIsolation(runtime?.globalConfig || {});
}

export function canUseHostPathsForWorkspaceTools(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  return (
    isSuperUserAgentContext(agentContext) &&
    resolveRuntimeIsolation(runtime).mode === EXECUTION_ISOLATION_MODE.HOST
  );
}

export function projectToolPathRef(pathRef = {}) {
  const resolved = resolvePathRef({ input: pathRef });
  if (resolved.view === "attachment") {
    return Object.freeze({ view: resolved.view, identity: resolved.identity });
  }
  return Object.freeze({
    view: resolved.view,
    path: resolved.view === "workspace" && !resolved.path ? "." : resolved.path,
  });
}

function resolveSessionContext(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const sessionManager = runtime?.sessionManager || null;
  const sessionIds = getSessionIdsFromAgentContext(agentContext, runtime);
  const userId = String(agentContext?.userId || sessionIds.userId || "").trim();
  if (!sessionManager || !userId) {
    throw recoverableToolError(tCheckInput(agentContext, "sessionContextMissing"), {
      code: ERROR_CODE.RECOVERABLE_SESSION_CONTEXT_MISSING,
      details: { hasSessionManager: Boolean(sessionManager), hasUserId: Boolean(userId) },
    });
  }
  return { sessionManager, userId };
}

export function assertValidSimpleFileName({ fileName = "", fieldName = "fileName" }) {
  const normalizedFileName = String(fileName || "").trim();
  if (!normalizedFileName) {
    throw recoverableToolError(`${fieldName} ${tCheckInput({}, "fieldRequired")}`, {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      details: { field: fieldName },
    });
  }
  if (normalizedFileName.includes("/") || normalizedFileName.includes("\\")) {
    throw recoverableToolError(`${fieldName} ${tCheckInput({}, "pathSeparatorsNotAllowed")}`, {
      code: ERROR_CODE.RECOVERABLE_INVALID_FILE_NAME,
      details: { field: fieldName, value: normalizedFileName },
    });
  }
  if (/[\0-\x1F\x7F]/.test(normalizedFileName)) {
    throw recoverableToolError(`${fieldName} ${tCheckInput({}, "controlCharsNotAllowed")}`, {
      code: ERROR_CODE.RECOVERABLE_INVALID_FILE_NAME,
      details: { field: fieldName, value: normalizedFileName },
    });
  }
  return normalizedFileName;
}

export function assertValidFileNameFromPath({ filePath = "", fieldName = "filePath" }) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) {
    throw recoverableToolError(`${fieldName} ${tCheckInput({}, "fieldRequired")}`, {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      details: { field: fieldName },
    });
  }
  const normalizedPathForName = normalizePathForPlatform(normalizedPath);
  const parsedName = path.basename(path.normalize(normalizedPathForName));
  if (!parsedName || parsedName === "." || parsedName === path.sep) {
    throw recoverableToolError(`${fieldName} ${tCheckInput({}, "fileNameIncludedRequired")}`, {
      code: ERROR_CODE.RECOVERABLE_INVALID_FILE_NAME,
      details: { field: fieldName, value: normalizedPath },
    });
  }
  return assertValidSimpleFileName({
    fileName: parsedName,
    fieldName,
  });
}

export async function assertValidParentSessionId({
  parentSessionId = "",
  agentContext = {},
  fieldName = "parentSessionId",
}) {
  const normalizedParentSessionId = normalizeParentSessionId(parentSessionId);
  if (!normalizedParentSessionId) {
    throw recoverableToolError(`${fieldName} ${tCheckInput(agentContext, "fieldRequired")}`, {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      details: { field: fieldName },
    });
  }
  if (!isUuid(normalizedParentSessionId)) {
    throw recoverableToolError(`${fieldName} ${tCheckInput(agentContext, "invalidUuidFormat")}`, {
      code: ERROR_CODE.RECOVERABLE_INVALID_PARENT_SESSION_ID,
      details: { field: fieldName, value: normalizedParentSessionId },
    });
  }

  const { sessionManager, userId } = resolveSessionContext(agentContext);

  const sessionTree = await sessionManager.getSessionTree({ userId });
  if (!sessionTree?.nodes?.[normalizedParentSessionId]) {
    throw recoverableToolError(
      `${tCheckInput(agentContext, "parentSessionNotFound")}: ${normalizedParentSessionId}`,
      {
        code: ERROR_CODE.RECOVERABLE_PARENT_SESSION_NOT_FOUND,
        details: { parentSessionId: normalizedParentSessionId },
      },
    );
  }
  return normalizedParentSessionId;
}

export async function assertValidParentDialogProcessId({
  parentSessionId = "",
  parentDialogProcessId = "",
  agentContext = {},
  parentSessionFieldName = "parentSessionId",
  dialogFieldName = "parentDialogProcessId",
}) {
  const normalizedParentSessionId = await assertValidParentSessionId({
    parentSessionId,
    agentContext,
    fieldName: parentSessionFieldName,
  });
  const normalizedParentDialogProcessId = String(parentDialogProcessId || "").trim();
  if (!normalizedParentDialogProcessId) {
    throw recoverableToolError(`${dialogFieldName} ${tCheckInput(agentContext, "fieldRequired")}`, {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      details: { field: dialogFieldName },
    });
  }

  const { sessionManager, userId } = resolveSessionContext(agentContext);

  const exists = await sessionManager.hasDialogProcessIdInSession({
    userId,
    sessionId: normalizedParentSessionId,
    dialogProcessId: normalizedParentDialogProcessId,
  });
  if (!exists) {
    throw recoverableToolError(
      `${dialogFieldName} ${tCheckInput(agentContext, "notFoundInParentSessionMessages")}: ${normalizedParentDialogProcessId}`,
      {
        code: ERROR_CODE.RECOVERABLE_PARENT_DIALOG_PROCESS_NOT_FOUND,
        details: {
          field: dialogFieldName,
          parentSessionId: normalizedParentSessionId,
          parentDialogProcessId: normalizedParentDialogProcessId,
        },
      },
    );
  }
  return {
    parentSessionId: normalizedParentSessionId,
    parentDialogProcessId: normalizedParentDialogProcessId,
  };
}

export async function resolveAuthorizedUserWorkspaceFilePath({
  filePath = "",
  agentContext = {},
  fieldName = "filePath",
  mustExist = false,
  capability = PATH_CAPABILITIES.FILE_READ,
  requiredExecutionRoot = "",
}) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) {
    throw recoverableToolError(`${fieldName} ${tCheckInput(agentContext, "fieldRequired")}`, {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      details: { field: fieldName },
    });
  }

  const workspacePath = resolveUserWorkspacePath(agentContext);
  const runtime = getRuntimeFromAgentContext(agentContext);
  const isolation = resolveRuntimeIsolation(runtime);
  const isSuperUser = isSuperUserAgentContext(agentContext);
  const workspaceRoot = resolveWorkspaceRoot(agentContext);
  const resolvedToolPath = resolveToolInputPath({
    inputPath: normalizedPath,
    runtime,
    workspacePath,
    workspaceRoot,
    agentContext,
    allowHostAbsolute: true,
    allowSandbox: isolation.mode === EXECUTION_ISOLATION_MODE.SANDBOX,
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
          suggestedPath: resolvedToolPath.candidateWorkspaceRelativePath || "",
          ...(resolvedToolPath.candidateSandboxPath
            ? { suggestedSandboxPath: resolvedToolPath.candidateSandboxPath }
            : {}),
        },
      });
  }
  const resolvedTargetPath = resolvedToolPath.resolvedPath;
  const normalizedRequiredExecutionRoot = String(requiredExecutionRoot || "").trim()
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
  const logicalPathRef = resolvedToolPath.mountTarget
    ? resolvePathRef({
        input: {
          view: "workspace",
          path: resolvedToolPath.logicalPath,
          owner: String(runtime?.userId || ""),
        },
      })
    : resolvePathRef({
        input: resolvedTargetPath,
        workspaceRoot: workspacePath,
        owner: String(runtime?.userId || ""),
      });
  if (
    resolvedToolPath.mountReadOnly === true &&
    [PATH_CAPABILITIES.FILE_WRITE, PATH_CAPABILITIES.FILE_PATCH].includes(capability)
  ) {
    throw recoverableToolError(`${fieldName} ${tCheckInput(agentContext, "pathOutOfScope")}`, {
      code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
      details: {
        field: fieldName,
        filePath: normalizedPath,
        pathView: logicalPathRef.view,
        reason: "sandbox_mount_read_only",
      },
    });
  }
  const configuredPathPolicy = resolvePathPolicy(runtime?.globalConfig || {});
  const principal = {
    userId: String(runtime?.userId || ""),
    role: isSuperUser ? "super_admin" : "regular_user",
    isSuperUser,
  };
  const authorization = authorizePathRef({
    pathRef: logicalPathRef,
    principal,
    capability,
    pathPolicy: configuredPathPolicy,
    executionPath: resolvedTargetPath,
    workspaceRoot: workspacePath,
    executionRoots: [resolvedToolPath.executionRoot].filter(Boolean),
  });

  if (!authorization.allowed) {
    throw recoverableToolError(tCheckInput(agentContext, "pathOutOfScope"), {
      code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
      details: {
        ...buildToolPathScopeErrorDetails({
          field: fieldName,
          pathView: resolvedToolPath.view,
        }),
      },
    });
  }

  const existingInfo = await lstat(resolvedTargetPath).catch(() => null);
  const resolutionPolicy = configuredPathPolicy.resolution || {};
  if (existingInfo?.isSymbolicLink() && resolutionPolicy.followSymbolicLinks !== true) {
    throw recoverableToolError(tCheckInput(agentContext, "pathOutOfScope"), {
      code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
      details: {
        field: fieldName,
        pathView: logicalPathRef.view,
        scope: "workspace",
        reason: "symbolic_link_not_allowed",
      },
    });
  }
  if (mustExist) {
    try {
      await access(resolvedTargetPath);
    } catch {
      throw recoverableToolError(
        `${tCheckInput(agentContext, "fileNotFound")}: ${normalizedPath}`,
        {
          code: ERROR_CODE.RECOVERABLE_FILE_NOT_FOUND,
          details: { field: fieldName, filePath: normalizedPath },
        },
      );
    }
  }
  if (existingInfo && resolutionPolicy.requireRealPathForExistingTargets !== false) {
    const realTarget = await realpath(resolvedTargetPath);
    if (
      normalizedRequiredExecutionRoot &&
      !isPathWithinRoot(
        await realpath(normalizedRequiredExecutionRoot).catch(() => normalizedRequiredExecutionRoot),
        realTarget,
      )
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
    const realDecision = authorizePathRef({
      pathRef: logicalPathRef,
      principal,
      capability,
      pathPolicy: configuredPathPolicy,
      executionPath: realTarget,
      workspaceRoot: workspacePath,
      executionRoots: [resolvedToolPath.executionRoot].filter(Boolean),
    });
    if (!realDecision.allowed)
      throw recoverableToolError(tCheckInput(agentContext, "pathOutOfScope"), {
        code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
        details: {
          field: fieldName,
          pathView: logicalPathRef.view,
          scope: "workspace",
          reason: "real_path_out_of_scope",
        },
      });
  }
  if (
    !existingInfo &&
    resolutionPolicy.validateWriteParentRealPath !== false &&
    capability !== PATH_CAPABILITIES.FILE_READ &&
    capability !== PATH_CAPABILITIES.FILE_SEARCH
  ) {
    const realParent = await resolveExistingParent(resolvedTargetPath);
    const projectedTarget = path.join(realParent, path.basename(resolvedTargetPath));
    const parentDecision = authorizePathRef({
      pathRef: logicalPathRef,
      principal,
      capability,
      pathPolicy: configuredPathPolicy,
      executionPath: projectedTarget,
      workspaceRoot: workspacePath,
      executionRoots: [resolvedToolPath.executionRoot].filter(Boolean),
    });
    if (!parentDecision.allowed)
      throw recoverableToolError(tCheckInput(agentContext, "pathOutOfScope"), {
        code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
        details: {
          field: fieldName,
          pathView: logicalPathRef.view,
          scope: "workspace",
          reason: "write_parent_out_of_scope",
        },
      });
  }

  return Object.freeze({
    executionPath: resolvedTargetPath,
    pathRef: logicalPathRef,
    toolPath: Object.freeze({ ...resolvedToolPath }),
  });
}
