/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  filePath as path,
  classifyToolInputPath,
  isAbsolutePathAnyPlatform,
  normalizePathForPlatform,
  isPathWithinRoot,
  resolvePathRef,
  PATH_CAPABILITIES,
  TOOL_PATH_VIEWS,
} from "@noobot/path-resolver";
import { recoverableToolError } from "../../../shared/errors/index.js";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import {
  resolveAuthorizedUserWorkspaceFilePath,
  assertValidFileNameFromPath,
  canUseHostPathsForWorkspaceTools,
  projectToolPathRef,
} from "../../core/check-tool-input.js";
import { tTool } from "../../core/tool-i18n.js";
import {
  exists,
  isForbiddenWorkspaceRelativePath,
  normalizeSlash,
  toWorkspaceRelativePath,
} from "../file-utils.js";
import { getBasePathFromAgentContext } from "../../../context/agent-context-accessor.js";

function normalizePatchPathInput(rawPath = "") {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return "";
  return normalizePathForPlatform(trimmed);
}

function resolvePatchDefaultRoot(agentContext = {}) {
  return path.resolve(getBasePathFromAgentContext(agentContext) || ".");
}

function resolvePatchRootInvalidHint(agentContext = {}) {
  return canUseHostPathsForWorkspaceTools(agentContext)
    ? tTool(agentContext, "tools.patch_file.rootInvalidHintSuperHost")
    : tTool(agentContext, "tools.patch_file.rootInvalidHintHost");
}

function formatDisplayPath({
  workspacePath = "",
  rootPath = "",
  candidatePath = "",
  resolvedPath = "",
} = {}) {
  const normalizedWorkspace = workspacePath ? path.resolve(workspacePath) : "";
  const normalizedResolved = resolvedPath ? path.resolve(resolvedPath) : "";
  if (
    normalizedWorkspace &&
    normalizedResolved &&
    isPathWithinRoot(normalizedWorkspace, normalizedResolved)
  ) {
    return toWorkspaceRelativePath(normalizedWorkspace, normalizedResolved);
  }
  const normalizedRoot = rootPath ? path.resolve(rootPath) : "";
  if (
    normalizedRoot &&
    normalizedResolved &&
    isPathWithinRoot(normalizedRoot, normalizedResolved)
  ) {
    return toWorkspaceRelativePath(normalizedRoot, normalizedResolved);
  }
  return normalizeSlash(candidatePath);
}

async function resolvePatchRoot({ root = "", agentContext = {} } = {}) {
  const normalizedRoot = normalizePatchPathInput(root);
  if (!normalizedRoot || normalizedRoot === ".") {
    const workspacePath = resolvePatchDefaultRoot(agentContext);
    return {
      displayPath: "",
      resolvedPath: workspacePath,
      inputPath: "",
    };
  }
  const classifiedRoot = classifyToolInputPath(normalizedRoot, { agentContext });
  if (
    normalizedRoot === ".." ||
    normalizedRoot.startsWith("../") ||
    isAbsolutePathAnyPlatform(normalizedRoot) ||
    classifiedRoot.view === TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE ||
    classifiedRoot.view === TOOL_PATH_VIEWS.HOST_ABSOLUTE ||
    classifiedRoot.view === TOOL_PATH_VIEWS.VIRTUAL_RELATIVE
  ) {
    throw recoverableToolError(
      `patch root must be a workspace-relative child directory: ${normalizedRoot}`,
      {
        code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
        details: {
          field: "root",
          root: normalizedRoot,
          pathView: classifiedRoot.view,
          hint: resolvePatchRootInvalidHint(agentContext),
        },
      },
    );
  }
  if (isForbiddenWorkspaceRelativePath(normalizedRoot)) {
    throw recoverableToolError(`patch root is not allowed: ${normalizedRoot}`, {
      code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
      details: { field: "root", root: normalizedRoot },
    });
  }
  assertValidFileNameFromPath({ filePath: normalizedRoot, fieldName: "root" });
  const resolution = await resolveAuthorizedUserWorkspaceFilePath({
    filePath: normalizedRoot,
    agentContext,
    fieldName: "root",
    capability: PATH_CAPABILITIES.FILE_PATCH,
    mustExist: true,
  });
  return {
    displayPath: normalizedRoot,
    resolvedPath: resolution.executionPath,
    pathRef: resolution.pathRef,
    inputPath: normalizedRoot,
  };
}

async function buildPatchPathCandidate(filePath = "", agentContext = {}, { root = "" } = {}) {
  const workspacePath = resolvePatchDefaultRoot(agentContext);
  const rootInfo = await resolvePatchRoot({ root, agentContext });
  const explicitRootPath = rootInfo.displayPath ? rootInfo.resolvedPath : "";
  const candidatePath = normalizePatchPathInput(filePath);
  const inputPath = explicitRootPath
    ? normalizeSlash(path.join(rootInfo.inputPath, candidatePath))
    : candidatePath;
  return {
    candidatePath,
    inputPath,
    displayPath: explicitRootPath
      ? formatDisplayPath({
          workspacePath,
          rootPath: explicitRootPath,
          candidatePath,
          resolvedPath: inputPath,
        })
      : candidatePath,
    rootPath: explicitRootPath || workspacePath,
    reason: explicitRootPath ? "explicit-root" : "workspace",
  };
}

function buildDiagnosticPathMapper(agentContext = {}) {
  const workspaceRoot = resolvePatchDefaultRoot(agentContext);
  return (value = "") =>
    projectToolPathRef(
      resolvePathRef({
        input: value,
        workspaceRoot,
      }),
    );
}

function buildPathAttemptDetails({
  filePath = "",
  fieldName = "filePath",
  candidate,
  agentContext = {},
  root = "",
} = {}) {
  const workspacePath = resolvePatchDefaultRoot(agentContext);
  const toDiagnosticPath = buildDiagnosticPathMapper(agentContext);
  return {
    field: fieldName,
    filePath,
    root: normalizePatchPathInput(root),
    basePath: toDiagnosticPath(workspacePath),
    attemptedPaths: [
      {
        path: candidate.displayPath || candidate.candidatePath,
        inputPath: toDiagnosticPath(candidate.inputPath || candidate.candidatePath),
        rootPath: toDiagnosticPath(candidate.rootPath || workspacePath),
        reason: candidate.reason,
      },
    ],
    hint: root
      ? "Patch path was resolved under the requested root. Check strip/root or use a path that exists under root."
      : "Patch paths are resolved from the current workspace root. If target files are in a child project, include that project directory in the patch path or pass root.",
  };
}

function throwPatchFileNotFound({
  filePath = "",
  fieldName = "filePath",
  candidate,
  agentContext = {},
  root = "",
  cause = null,
} = {}) {
  throw recoverableToolError(`file not found: ${filePath}`, {
    code: ERROR_CODE.RECOVERABLE_FILE_NOT_FOUND,
    cause,
    details: buildPathAttemptDetails({ filePath, fieldName, candidate, agentContext, root }),
  });
}

async function resolveWorkspacePatchPath({
  filePath = "",
  agentContext = {},
  fieldName = "filePath",
  mustExist = false,
  root = "",
} = {}) {
  const candidate = await buildPatchPathCandidate(filePath, agentContext, { root });
  const resolution = await resolveAuthorizedUserWorkspaceFilePath({
    filePath: candidate.inputPath || candidate.candidatePath,
    agentContext,
    fieldName,
    capability: PATH_CAPABILITIES.FILE_PATCH,
    mustExist: false,
  });
  if (mustExist && !(await exists(resolution.executionPath))) {
    throwPatchFileNotFound({
      filePath,
      fieldName,
      candidate,
      agentContext,
      root,
    });
  }
  return {
    displayPath: candidate.displayPath,
    resolvedPath: resolution.executionPath,
    resourcePath: resolution.resourcePath,
    pathRef: resolution.pathRef,
  };
}

export async function resolvePatchTargets({ patches = [], agentContext = {} } = {}) {
  return resolvePatchTargetsWithOptions({ patches, agentContext });
}

export async function resolvePatchTargetsWithOptions({
  patches = [],
  agentContext = {},
  root = "",
} = {}) {
  const resolved = [];
  for (const item of patches) {
    const oldPath = normalizePatchPathInput(item.oldPath);
    const newPath = normalizePatchPathInput(item.newPath);
    const normalizedItem = { ...item, oldPath, newPath };
    const targetPath = newPath && newPath !== "/dev/null" ? newPath : oldPath;
    assertValidFileNameFromPath({ filePath: targetPath, fieldName: "patch.path" });
    if (isForbiddenWorkspaceRelativePath(targetPath)) {
      throw recoverableToolError(`patch path is not allowed: ${targetPath}`, {
        code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
        details: { field: "patch", filePath: targetPath },
      });
    }
    const oldInfo =
      oldPath && oldPath !== "/dev/null"
        ? await resolveWorkspacePatchPath({
            filePath: oldPath,
            agentContext,
            fieldName: "patch.oldPath",
            mustExist: normalizedItem.mode !== "add",
            root,
          })
        : { displayPath: oldPath, resolvedPath: "" };
    const newInfo =
      newPath && newPath !== "/dev/null"
        ? normalizedItem.mode !== "add" && oldPath === newPath && oldInfo.resolvedPath
          ? oldInfo
          : await resolveWorkspacePatchPath({
              filePath: newPath,
              agentContext,
              fieldName: "patch.newPath",
              mustExist: false,
              root,
            })
        : { displayPath: newPath, resolvedPath: "" };
    resolved.push({
      ...normalizedItem,
      oldPath: oldInfo.displayPath || oldPath,
      newPath: newInfo.displayPath || newPath,
      resolvedOldPath: oldInfo.resolvedPath,
      resolvedNewPath: newInfo.resolvedPath,
      oldResourcePath: oldInfo.resourcePath || "",
      newResourcePath: newInfo.resourcePath || "",
      oldPathRef: oldInfo.pathRef || null,
      newPathRef: newInfo.pathRef || null,
    });
  }
  return resolved;
}
