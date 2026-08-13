/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  filePath as path,
  classifyToolInputPath,
  isAbsolutePathAnyPlatform,
  isCaseInsensitivePathContext,
  normalizePathForPlatform,
  resolvePathUnderRoot,
  PATH_CAPABILITIES,
  TOOL_PATH_VIEWS,
} from "@noobot/path-resolver";
import { recoverableToolError } from "../../../shared/errors/index.js";
import { ERROR_CODE } from "../../../shared/errors/constants.js";
import {
  assertAndResolveUserWorkspaceFilePath,
  assertValidFileNameFromPath,
} from "../../core/check-tool-input.js";
import { tTool } from "../../core/tool-i18n.js";
import {
  exists,
  isForbiddenWorkspaceRelativePath,
  normalizeSlash,
  toWorkspaceRelativePath,
} from "../file-utils.js";
import {
  getBasePathFromAgentContext,
  getRuntimeFromAgentContext,
} from "../../../context/agent-context-accessor.js";
import { isSuperUserAgentContext } from "../../../shared/utils/super-user.js";

function normalizePatchPathInput(rawPath = "") {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return "";
  return normalizePathForPlatform(trimmed);
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.map((item) => String(item || "").trim()).filter(Boolean)));
}

function isWithinBasePath(basePath = "", targetPath = "") {
  const rel = path.relative(basePath, targetPath);
  if (!rel) return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function resolvePatchDefaultRoot(agentContext = {}) {
  return path.resolve(getBasePathFromAgentContext(agentContext) || ".");
}

function resolvePatchRootInvalidHint(agentContext = {}) {
  return isSuperUserAgentContext(agentContext)
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
    isWithinBasePath(normalizedWorkspace, normalizedResolved)
  ) {
    return toWorkspaceRelativePath(normalizedWorkspace, normalizedResolved);
  }
  const normalizedRoot = rootPath ? path.resolve(rootPath) : "";
  if (
    normalizedRoot &&
    normalizedResolved &&
    isWithinBasePath(normalizedRoot, normalizedResolved)
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
  const resolvedPath = await assertAndResolveUserWorkspaceFilePath({
    filePath: normalizedRoot,
    agentContext,
    fieldName: "root",
    capability: PATH_CAPABILITIES.FILE_PATCH,
    mustExist: true,
  });
  return {
    displayPath: normalizedRoot,
    resolvedPath,
    inputPath: normalizedRoot,
  };
}

async function buildPatchPathCandidates(filePath = "", agentContext = {}, { root = "" } = {}) {
  const workspacePath = resolvePatchDefaultRoot(agentContext);
  const rootInfo = await resolvePatchRoot({ root, agentContext });
  const explicitRootPath = rootInfo.displayPath ? rootInfo.resolvedPath : "";
  const candidatePath = normalizePatchPathInput(filePath);
  const inputPath = explicitRootPath
    ? resolvePathUnderRoot(explicitRootPath, candidatePath)
    : candidatePath;
  return [
    {
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
      priority: 0,
      reason: explicitRootPath ? "explicit-root" : "workspace",
    },
  ];
}

function dedupeResolvedCandidates(candidates = [], agentContext = {}) {
  const seen = new Set();
  const result = [];
  const caseInsensitivePath = isCaseInsensitivePathContext(agentContext);
  for (const item of candidates) {
    const normalizedKey = normalizeSlash(path.resolve(item.resolvedPath || ""));
    const key = caseInsensitivePath ? normalizedKey.toLowerCase() : normalizedKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result.sort((a, b) => a.priority - b.priority);
}

function throwAmbiguousPatchPath({ filePath = "", fieldName = "filePath", matches = [] } = {}) {
  const options = matches.map((item) => item.displayPath || item.candidatePath).filter(Boolean);
  throw recoverableToolError(`ambiguous patch path: ${filePath}`, {
    code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
    details: {
      field: fieldName,
      filePath,
      options,
      reasons: matches.map((item) => item.reason).filter(Boolean),
    },
  });
}

function buildDiagnosticPathMapper(agentContext = {}) {
  void agentContext;
  return (value = "") => normalizeSlash(value);
}

function buildPathAttemptDetails({
  filePath = "",
  fieldName = "filePath",
  candidates = [],
  agentContext = {},
  root = "",
} = {}) {
  const workspacePath = resolvePatchDefaultRoot(agentContext);
  const toDiagnosticPath = buildDiagnosticPathMapper(agentContext);
  const classifiedInput = classifyToolInputPath(filePath, { agentContext });
  const virtualRelativeSuggestion =
    classifiedInput.view === TOOL_PATH_VIEWS.VIRTUAL_RELATIVE
      ? {
          pathView: classifiedInput.view,
          suggestedPatchPath: classifiedInput.normalized.split("/").slice(1).join("/"),
          suggestedSandboxPath: `/${classifiedInput.normalized}`,
          pathHint: `Path '${classifiedInput.normalized}' looks like a virtual relative path. Use '/${classifiedInput.virtualRoot}/...' for sandbox paths, or remove '${classifiedInput.virtualRoot}/' for workspace-relative paths.`,
        }
      : {};
  const suggestedRoots = uniqueStrings(
    candidates
      .filter((item) => item.reason && String(item.reason).includes("discovered-project-root"))
      .map((item) => toWorkspaceRelativePath(workspacePath, item.rootPath || ""))
      .filter(
        (relativeRoot) =>
          relativeRoot &&
          relativeRoot !== ".." &&
          !relativeRoot.startsWith("../") &&
          !isAbsolutePathAnyPlatform(relativeRoot),
      ),
  );
  return {
    field: fieldName,
    filePath,
    root: normalizePatchPathInput(root),
    basePath: toDiagnosticPath(workspacePath),
    attemptedPaths: candidates.map((item) => ({
      path: item.displayPath || item.candidatePath,
      inputPath: toDiagnosticPath(item.inputPath || item.candidatePath),
      rootPath: toDiagnosticPath(item.rootPath || workspacePath),
      reason: item.reason,
    })),
    suggestedRoots,
    suggestedRoot: suggestedRoots.length === 1 ? suggestedRoots[0] : "",
    ...virtualRelativeSuggestion,
    hint: root
      ? "Patch path was resolved under the requested root. Check strip/root or use a path that exists under root."
      : virtualRelativeSuggestion.pathHint ||
        "Patch paths are resolved from the current workspace root. If target files are in a child project, include that project directory in the patch path or pass root.",
  };
}

function throwPatchFileNotFound({
  filePath = "",
  fieldName = "filePath",
  candidates = [],
  agentContext = {},
  root = "",
  cause = null,
} = {}) {
  throw recoverableToolError(`file not found: ${filePath}`, {
    code: ERROR_CODE.RECOVERABLE_FILE_NOT_FOUND,
    cause,
    details: buildPathAttemptDetails({ filePath, fieldName, candidates, agentContext, root }),
  });
}

async function resolveCompatibleWorkspaceFilePath({
  filePath = "",
  agentContext = {},
  fieldName = "filePath",
  mustExist = false,
  root = "",
} = {}) {
  const candidates = await buildPatchPathCandidates(filePath, agentContext, { root });
  let firstError = null;
  if (mustExist) {
    const matches = [];
    for (const candidate of candidates) {
      try {
        const resolvedPath = await assertAndResolveUserWorkspaceFilePath({
          filePath: candidate.inputPath || candidate.candidatePath,
          agentContext,
          fieldName,
          capability: PATH_CAPABILITIES.FILE_PATCH,
          mustExist: false,
        });
        if (await exists(resolvedPath)) {
          matches.push({ ...candidate, resolvedPath });
        }
      } catch (error) {
        firstError ||= error;
      }
    }
    const uniqueMatches = dedupeResolvedCandidates(matches, agentContext);
    if (uniqueMatches.length === 1) {
      const match = uniqueMatches[0];
      return { displayPath: match.displayPath, resolvedPath: match.resolvedPath };
    }
    if (uniqueMatches.length > 1) {
      throwAmbiguousPatchPath({ filePath, fieldName, matches: uniqueMatches });
    }
    if (firstError?.code === ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE) throw firstError;
    throwPatchFileNotFound({
      filePath,
      fieldName,
      candidates,
      agentContext,
      root,
      cause: firstError,
    });
  }

  const matches = [];
  for (const candidate of candidates) {
    try {
      const resolvedPath = await assertAndResolveUserWorkspaceFilePath({
        filePath: candidate.inputPath || candidate.candidatePath,
        agentContext,
        fieldName,
        capability: PATH_CAPABILITIES.FILE_PATCH,
        mustExist: false,
      });
      if (await exists(path.dirname(resolvedPath))) {
        matches.push({ ...candidate, resolvedPath });
      }
    } catch (error) {
      firstError ||= error;
    }
  }
  const uniqueMatches = dedupeResolvedCandidates(matches, agentContext);
  if (uniqueMatches.length === 1) {
    const match = uniqueMatches[0];
    return { displayPath: match.displayPath, resolvedPath: match.resolvedPath };
  }
  if (uniqueMatches.length > 1) {
    throwAmbiguousPatchPath({ filePath, fieldName, matches: uniqueMatches });
  }
  if (firstError?.code === ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE) throw firstError;
  if (firstError && candidates.length === 1) throw firstError;
  const fallback = candidates[0]?.candidatePath || filePath;
  return {
    displayPath: fallback,
    resolvedPath: await assertAndResolveUserWorkspaceFilePath({
      filePath: fallback,
      agentContext,
      fieldName,
      mustExist: false,
      capability: PATH_CAPABILITIES.FILE_PATCH,
    }),
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
        ? await resolveCompatibleWorkspaceFilePath({
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
          : await resolveCompatibleWorkspaceFilePath({
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
    });
  }
  return resolved;
}
