/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { recoverableToolError } from "../error/index.js";

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
  const runtime = agentContext?.runtime || {};
  const basePath = String(agentContext?.basePath || runtime?.basePath || "").trim();
  if (!basePath) {
    throw recoverableToolError("runtime basePath missing", {
      code: "RECOVERABLE_RUNTIME_BASEPATH_MISSING",
    });
  }
  return path.resolve(basePath);
}

function resolveUserWorkspacePath(agentContext = {}) {
  return resolveRuntimeBasePath(agentContext);
}

export function assertValidSimpleFileName({
  fileName = "",
  fieldName = "fileName",
}) {
  const normalizedFileName = String(fileName || "").trim();
  if (!normalizedFileName) {
    throw recoverableToolError(`${fieldName} required`, {
      code: "RECOVERABLE_INPUT_MISSING",
      details: { field: fieldName },
    });
  }
  if (
    normalizedFileName.includes("/") ||
    normalizedFileName.includes("\\")
  ) {
    throw recoverableToolError(`${fieldName} must not contain path separators`, {
      code: "RECOVERABLE_INVALID_FILE_NAME",
      details: { field: fieldName, value: normalizedFileName },
    });
  }
  if (/[\0-\x1F\x7F]/.test(normalizedFileName)) {
    throw recoverableToolError(
      `${fieldName} must not contain control characters`,
      {
        code: "RECOVERABLE_INVALID_FILE_NAME",
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
    throw recoverableToolError(`${fieldName} required`, {
      code: "RECOVERABLE_INPUT_MISSING",
      details: { field: fieldName },
    });
  }
  const parsedName = path.basename(path.normalize(normalizedPath));
  if (!parsedName || parsedName === "." || parsedName === path.sep) {
    throw recoverableToolError(`${fieldName} must include file name`, {
      code: "RECOVERABLE_INVALID_FILE_NAME",
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
  const normalizedParentSessionId = String(parentSessionId || "").trim();
  if (!normalizedParentSessionId) {
    throw recoverableToolError(`${fieldName} required`, {
      code: "RECOVERABLE_INPUT_MISSING",
      details: { field: fieldName },
    });
  }
  if (!isUuid(normalizedParentSessionId)) {
    throw recoverableToolError(`invalid ${fieldName} format (UUID required)`, {
      code: "RECOVERABLE_INVALID_PARENT_SESSION_ID",
      details: { field: fieldName, value: normalizedParentSessionId },
    });
  }

  const runtime = agentContext?.runtime || {};
  const sessionManager = runtime?.sessionManager || null;
  const userId = String(
    agentContext?.userId || runtime?.userId || runtime?.systemRuntime?.userId || "",
  ).trim();
  if (!sessionManager || !userId) {
    throw recoverableToolError("session context missing", {
      code: "RECOVERABLE_SESSION_CONTEXT_MISSING",
      details: { hasSessionManager: Boolean(sessionManager), hasUserId: Boolean(userId) },
    });
  }

  const sessionTree = await sessionManager.getSessionTree({ userId });
  if (!sessionTree?.nodes?.[normalizedParentSessionId]) {
    throw recoverableToolError(
      `parent session not found: ${normalizedParentSessionId}`,
      {
        code: "RECOVERABLE_PARENT_SESSION_NOT_FOUND",
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
    throw recoverableToolError(`${dialogFieldName} required`, {
      code: "RECOVERABLE_INPUT_MISSING",
      details: { field: dialogFieldName },
    });
  }

  const runtime = agentContext?.runtime || {};
  const sessionManager = runtime?.sessionManager || null;
  const userId = String(
    agentContext?.userId || runtime?.userId || runtime?.systemRuntime?.userId || "",
  ).trim();
  if (!sessionManager || !userId) {
    throw recoverableToolError("session context missing", {
      code: "RECOVERABLE_SESSION_CONTEXT_MISSING",
      details: { hasSessionManager: Boolean(sessionManager), hasUserId: Boolean(userId) },
    });
  }

  const exists = await sessionManager.hasDialogProcessIdInSession({
    userId,
    sessionId: normalizedParentSessionId,
    dialogProcessId: normalizedParentDialogProcessId,
  });
  if (!exists) {
    throw recoverableToolError(
      `${dialogFieldName} not found in parent session messages: ${normalizedParentDialogProcessId}`,
      {
        code: "RECOVERABLE_PARENT_DIALOG_PROCESS_NOT_FOUND",
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
    throw recoverableToolError(`${fieldName} required`, {
      code: "RECOVERABLE_INPUT_MISSING",
      details: { field: fieldName },
    });
  }

  const workspacePath = resolveUserWorkspacePath(agentContext);
  const resolvedTargetPath = path.isAbsolute(normalizedPath)
    ? path.resolve(normalizedPath)
    : path.resolve(workspacePath, normalizedPath);

  if (!isWithinBasePath(workspacePath, resolvedTargetPath)) {
    throw recoverableToolError(`Path out of scope: ${normalizedPath}`, {
      code: "RECOVERABLE_PATH_OUT_OF_SCOPE",
      details: {
        field: fieldName,
        filePath: normalizedPath,
        allowedRoot: workspacePath,
      },
    });
  }

  if (mustExist) {
    try {
      await access(resolvedTargetPath);
    } catch {
      throw recoverableToolError(`File not found: ${normalizedPath}`, {
        code: "RECOVERABLE_FILE_NOT_FOUND",
        details: { field: fieldName, filePath: normalizedPath },
      });
    }
  }

  return resolvedTargetPath;
}
