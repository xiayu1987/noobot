/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access } from "node:fs/promises";
import path from "node:path";
import {
  getBasePathFromAgentContext,
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
  getSystemRuntimeFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { normalizeParentSessionId } from "../../context/parent-session-id-resolver.js";
import { recoverableToolError } from "../../error/index.js";
import { tTool } from "./tool-i18n.js";
import { ERROR_CODE } from "../../error/constants.js";
import {
  resolveHostPath,
  resolveSandboxPathMappings,
} from "../../utils/sandbox-path-resolver.js";

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

function isUuid(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
}

function isWithinBasePath(basePath = "", targetPath = "") {
  const rel = path.relative(basePath, targetPath);
  if (!rel) return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
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

function isSuperUserAgentContext(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const systemRuntime = getSystemRuntimeFromAgentContext(agentContext, runtime);
  return systemRuntime?.isSuperUser === true;
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

function resolveAdditionalAllowedRoots(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const mappedRoots = resolveSandboxPathMappings(runtime)
    .map((item = {}) => String(item?.source || "").trim())
    .filter(Boolean);
  const scriptConfig = resolveExecuteScriptConfig(runtime);
  const sandboxProviderConfig =
    scriptConfig?.sandboxProvider &&
    typeof scriptConfig.sandboxProvider === "object"
      ? scriptConfig.sandboxProvider
      : scriptConfig?.sandbox_provider &&
          typeof scriptConfig.sandbox_provider === "object"
        ? scriptConfig.sandbox_provider
        : {};
  const providerName = String(sandboxProviderConfig?.default || "docker")
    .trim()
    .toLowerCase();
  const providerDetail =
    sandboxProviderConfig?.[providerName] &&
    typeof sandboxProviderConfig[providerName] === "object"
      ? sandboxProviderConfig[providerName]
      : {};
  const dockerMounts = Array.isArray(providerDetail?.dockerMounts)
    ? providerDetail.dockerMounts
    : Array.isArray(providerDetail?.docker_mounts)
      ? providerDetail.docker_mounts
      : [];
  const dockerMountSources = dockerMounts
    .map((item) => (item && typeof item === "object" ? item : {}))
    .map((item) =>
      String(item?.source || item?.mountSource || item?.mount_source || "").trim(),
    )
    .filter(Boolean);
  return Array.from(new Set([...mappedRoots, ...dockerMountSources]))
    .map((item) => path.resolve(item))
    .filter(Boolean);
}

function resolveInputPathToHostPath({ inputPath = "", workspacePath = "", agentContext = {} } = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  if (isSuperUserAgentContext(agentContext)) {
    const workspaceRoot = resolveWorkspaceRoot(agentContext);
    const normalizedInputPath = String(inputPath || "").trim();
    if (workspaceRoot && path.isAbsolute(normalizedInputPath)) {
      const normalizedSandboxPath = normalizedInputPath.replaceAll("\\", "/");
      if (normalizedSandboxPath === "/workspace") return workspaceRoot;
      if (normalizedSandboxPath.startsWith("/workspace/")) {
        return path.resolve(workspaceRoot, normalizedSandboxPath.slice("/workspace/".length));
      }
    }
  }
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
      if (resolved) return path.resolve(resolved);
    } catch {
      // Keep path validation deterministic: ignore resolver errors and use fallback.
    }
  }
  const resolvedByDefault = resolveHostPath({
    path: inputPath,
    sandboxPath: inputPath,
    runtime: { ...runtime, basePath: runtime?.basePath || workspacePath },
    agentContext,
  });
  return resolvedByDefault ? path.resolve(resolvedByDefault) : "";
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

export function assertValidSimpleFileName({
  fileName = "",
  fieldName = "fileName",
}) {
  const normalizedFileName = String(fileName || "").trim();
  if (!normalizedFileName) {
    throw recoverableToolError(
      `${fieldName} ${tCheckInput({}, "fieldRequired")}`,
      {
        code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        details: { field: fieldName },
      },
    );
  }
  if (
    normalizedFileName.includes("/") ||
    normalizedFileName.includes("\\")
  ) {
    throw recoverableToolError(
      `${fieldName} ${tCheckInput({}, "pathSeparatorsNotAllowed")}`,
      {
        code: ERROR_CODE.RECOVERABLE_INVALID_FILE_NAME,
        details: { field: fieldName, value: normalizedFileName },
      },
    );
  }
  if (/[\0-\x1F\x7F]/.test(normalizedFileName)) {
    throw recoverableToolError(
      `${fieldName} ${tCheckInput({}, "controlCharsNotAllowed")}`,
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
}) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) {
    throw recoverableToolError(
      `${fieldName} ${tCheckInput({}, "fieldRequired")}`,
      {
        code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        details: { field: fieldName },
      },
    );
  }
  const parsedName = path.basename(path.normalize(normalizedPath));
  if (!parsedName || parsedName === "." || parsedName === path.sep) {
    throw recoverableToolError(
      `${fieldName} ${tCheckInput({}, "fileNameIncludedRequired")}`,
      {
        code: ERROR_CODE.RECOVERABLE_INVALID_FILE_NAME,
        details: { field: fieldName, value: normalizedPath },
      },
    );
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
    throw recoverableToolError(
      `${fieldName} ${tCheckInput(agentContext, "fieldRequired")}`,
      {
        code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        details: { field: fieldName },
      },
    );
  }
  if (!isUuid(normalizedParentSessionId)) {
    throw recoverableToolError(
      `${fieldName} ${tCheckInput(agentContext, "invalidUuidFormat")}`,
      {
        code: ERROR_CODE.RECOVERABLE_INVALID_PARENT_SESSION_ID,
        details: { field: fieldName, value: normalizedParentSessionId },
      },
    );
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
  const normalizedParentDialogProcessId = String(
    parentDialogProcessId || "",
  ).trim();
  if (!normalizedParentDialogProcessId) {
    throw recoverableToolError(
      `${dialogFieldName} ${tCheckInput(agentContext, "fieldRequired")}`,
      {
        code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        details: { field: dialogFieldName },
      },
    );
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

export async function assertAndResolveUserWorkspaceFilePath({
  filePath = "",
  agentContext = {},
  fieldName = "filePath",
  mustExist = false,
}) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) {
    throw recoverableToolError(
      `${fieldName} ${tCheckInput(agentContext, "fieldRequired")}`,
      {
        code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        details: { field: fieldName },
      },
    );
  }

  const workspacePath = resolveUserWorkspacePath(agentContext);
  const hostMappedPath = resolveInputPathToHostPath({
    inputPath: normalizedPath,
    workspacePath,
    agentContext,
  });
  const resolvedTargetPath = hostMappedPath || (path.isAbsolute(normalizedPath)
    ? path.resolve(normalizedPath)
    : path.resolve(workspacePath, normalizedPath));

  const isSuperUser = isSuperUserAgentContext(agentContext);
  const allowedRoots = [
    workspacePath,
    ...resolveAdditionalAllowedRoots(agentContext),
  ].filter(Boolean);
  const inAllowedScope = isSuperUser || allowedRoots.some((rootPath) =>
    isWithinBasePath(rootPath, resolvedTargetPath),
  );
  if (!inAllowedScope) {
    throw recoverableToolError(
      `${tCheckInput(agentContext, "pathOutOfScope")}: ${normalizedPath}`,
      {
        code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
        details: {
          field: fieldName,
          filePath: normalizedPath,
          allowedRoots,
        },
      },
    );
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

  return resolvedTargetPath;
}
