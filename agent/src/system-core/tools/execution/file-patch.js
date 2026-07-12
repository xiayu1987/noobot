/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdir } from "node:fs/promises";
import {
  filePath as path,
  isAbsolutePathAnyPlatform,
  isCaseInsensitivePathContext,
  normalizePathForPlatform,
  resolvePathUnderRoot,
} from "../../utils/path-resolver.js";
import { recoverableToolError } from "../../error/index.js";
import { ERROR_CODE } from "../../error/constants.js";
import {
  assertAndResolveUserWorkspaceFilePath,
  assertValidFileNameFromPath,
} from "../core/check-tool-input.js";
import {
  exists,
  isForbiddenWorkspaceRelativePath,
  normalizeSlash,
  splitLines,
  toWorkspaceRelativePath,
  toPositiveInt,
} from "./file-utils.js";
import {
  getBasePathFromAgentContext,
  getRuntimeFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { isSuperUserAgentContext } from "../../utils/super-user.js";

function parseUnifiedHunkHeader(header = "") {
  const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(header);
  if (!match) {
    throw recoverableToolError(`invalid unified diff hunk header: ${header}`, {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: {
        field: "patch",
        hint: "Use a unified diff hunk header like @@ -1,3 +1,3 @@, or use apply_patch syntax with *** Begin Patch.",
      },
    });
  }
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] || "1"),
    newStart: Number(match[3]),
    newCount: Number(match[4] || "1"),
  };
}

const VIRTUAL_PATCH_ROOTS = new Set(["project", "workspace", "workdir", "repo", "repository"]);
const PROJECT_ROOT_MARKERS = [
  ".git",
  "package.json",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
];

function normalizePatchPathInput(rawPath = "") {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return "";
  return normalizePathForPlatform(trimmed);
}

function stripDiffPath(rawPath = "", strip = 1) {
  const withoutTimestamp = normalizePatchPathInput(String(rawPath || "").trim().split(/\s+/)[0] || "");
  if (!withoutTimestamp || withoutTimestamp === "/dev/null") return withoutTimestamp;
  const parts = withoutTimestamp.split("/").filter(Boolean);
  if (/^[A-Za-z]:$/.test(parts[0] || "")) return withoutTimestamp;
  if (withoutTimestamp.startsWith("/") && !VIRTUAL_PATCH_ROOTS.has(parts[0])) return withoutTimestamp;
  const stripCount = toPositiveInt(strip, 1, 0, 10);
  return parts.slice(stripCount).join("/") || withoutTimestamp;
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.map((item) => String(item || "").trim()).filter(Boolean)));
}

function buildPatchPathVariants(filePath = "", agentContext = {}, { patchRoot = "" } = {}) {
  const normalized = normalizePatchPathInput(filePath);
  if (!normalized || normalized === "/dev/null") return [normalized];
  const parts = normalized.split("/").filter(Boolean);
  const workspaceBaseName = path.basename(path.resolve(getBasePathFromAgentContext(agentContext) || "."));
  const patchRootParts = normalizePatchPathInput(patchRoot).split("/").filter(Boolean);
  const patchRootBaseName = patchRootParts[patchRootParts.length - 1] || "";
  const virtualRoots = new Set([...VIRTUAL_PATCH_ROOTS, workspaceBaseName, patchRootBaseName].filter(Boolean));
  if (isAbsolutePathAnyPlatform(normalized) && !virtualRoots.has(parts[0])) {
    return [normalized];
  }
  const variants = [parts.join("/") || normalized];
  if (virtualRoots.has(parts[0]) && parts.length > 1) {
    variants.push(parts.slice(1).join("/"));
  }
  return uniqueStrings(variants);
}

function isWithinBasePath(basePath = "", targetPath = "") {
  const rel = path.relative(basePath, targetPath);
  if (!rel) return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function formatDisplayPath({ workspacePath = "", rootPath = "", candidatePath = "", resolvedPath = "" } = {}) {
  const normalizedWorkspace = workspacePath ? path.resolve(workspacePath) : "";
  const normalizedResolved = resolvedPath ? path.resolve(resolvedPath) : "";
  if (normalizedWorkspace && normalizedResolved && isWithinBasePath(normalizedWorkspace, normalizedResolved)) {
    return toWorkspaceRelativePath(normalizedWorkspace, normalizedResolved);
  }
  const normalizedRoot = rootPath ? path.resolve(rootPath) : "";
  if (normalizedRoot && normalizedResolved && isWithinBasePath(normalizedRoot, normalizedResolved)) {
    return toWorkspaceRelativePath(normalizedRoot, normalizedResolved);
  }
  return normalizeSlash(candidatePath);
}

async function looksLikeProjectRoot(rootPath = "") {
  for (const marker of PROJECT_ROOT_MARKERS) {
    if (await exists(path.join(rootPath, marker))) return true;
  }
  return false;
}

async function discoverSuperUserPatchRoots(agentContext = {}) {
  const workspacePath = path.resolve(getBasePathFromAgentContext(agentContext) || ".");
  const runtime = getRuntimeFromAgentContext(agentContext);
  const roots = [workspacePath];
  const workspaceRoot = String(runtime?.globalConfig?.workspaceRoot || "").trim();
  if (workspaceRoot) roots.push(path.resolve(workspaceRoot));

  let entries = [];
  try {
    entries = await readdir(workspacePath, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue;
    if (entry.name.startsWith(".")) continue;
    const childPath = path.join(workspacePath, entry.name);
    if (await looksLikeProjectRoot(childPath)) roots.push(childPath);
  }
  return uniqueStrings(roots.map((item) => path.resolve(item)));
}

async function discoverWorkspaceChildProjectRoots(agentContext = {}) {
  const workspacePath = path.resolve(getBasePathFromAgentContext(agentContext) || ".");
  let entries = [];
  try {
    entries = await readdir(workspacePath, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const roots = [];
  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue;
    if (entry.name.startsWith(".")) continue;
    const childPath = path.join(workspacePath, entry.name);
    if (await looksLikeProjectRoot(childPath)) roots.push(childPath);
  }
  return uniqueStrings(roots.map((item) => path.resolve(item)));
}

async function resolvePatchRoot({ root = "", agentContext = {} } = {}) {
  const normalizedRoot = normalizePatchPathInput(root);
  if (!normalizedRoot || normalizedRoot === ".") {
    const workspacePath = path.resolve(getBasePathFromAgentContext(agentContext) || ".");
    return {
      displayPath: "",
      resolvedPath: workspacePath,
      inputPath: "",
    };
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
    mustExist: true,
  });
  return {
    displayPath: normalizedRoot,
    resolvedPath,
    inputPath: normalizedRoot,
  };
}

async function buildPatchPathCandidates(filePath = "", agentContext = {}, { root = "" } = {}) {
  const workspacePath = path.resolve(getBasePathFromAgentContext(agentContext) || ".");
  const rootInfo = await resolvePatchRoot({ root, agentContext });
  const explicitRootPath = rootInfo.displayPath ? rootInfo.resolvedPath : "";
  const variants = buildPatchPathVariants(filePath, agentContext, { patchRoot: rootInfo.displayPath });
  const hasAbsolutePatchPath = variants.some((candidatePath) => isAbsolutePathAnyPlatform(candidatePath));
  const baseCandidates = variants.map((candidatePath, index) => ({
    candidatePath,
    inputPath: resolvePathUnderRoot(explicitRootPath, candidatePath),
    displayPath: explicitRootPath
      ? formatDisplayPath({
        workspacePath,
        rootPath: explicitRootPath,
        candidatePath,
        resolvedPath: resolvePathUnderRoot(explicitRootPath, candidatePath),
      })
      : candidatePath,
    rootPath: explicitRootPath || workspacePath,
    priority: index,
    reason: explicitRootPath
      ? (index === 0 ? "explicit-root" : "explicit-root + virtual-root-stripped")
      : (index === 0 ? "workspace" : "virtual-root-stripped"),
  }));

  if (explicitRootPath || hasAbsolutePatchPath) return baseCandidates;

  const roots = isSuperUserAgentContext(agentContext)
    ? await discoverSuperUserPatchRoots(agentContext)
    : [
      workspacePath,
      ...await discoverWorkspaceChildProjectRoots(agentContext),
    ];
  const candidates = [];
  for (const [rootIndex, rootPath] of roots.entries()) {
    for (const [variantIndex, candidatePath] of variants.entries()) {
      const resolvedPath = path.resolve(rootPath, candidatePath);
      candidates.push({
        candidatePath,
        inputPath: rootPath === workspacePath ? candidatePath : resolvedPath,
        displayPath: formatDisplayPath({ workspacePath, rootPath, candidatePath, resolvedPath }),
        rootPath,
        priority: (rootIndex * 10) + variantIndex,
        reason: rootIndex === 0
          ? (variantIndex === 0 ? "workspace" : "virtual-root-stripped")
          : (variantIndex === 0 ? "discovered-project-root" : "virtual-root-stripped + discovered-project-root"),
      });
    }
  }
  return candidates;
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

function buildPathAttemptDetails({
  filePath = "",
  fieldName = "filePath",
  candidates = [],
  agentContext = {},
  root = "",
} = {}) {
  const workspacePath = path.resolve(getBasePathFromAgentContext(agentContext) || ".");
  const suggestedRoots = uniqueStrings(candidates
    .filter((item) => item.reason && String(item.reason).includes("discovered-project-root"))
    .map((item) => toWorkspaceRelativePath(workspacePath, item.rootPath || "")));
  return {
    field: fieldName,
    filePath,
    root: normalizePatchPathInput(root),
    basePath: workspacePath,
    attemptedPaths: candidates.map((item) => ({
      path: item.displayPath || item.candidatePath,
      inputPath: normalizeSlash(item.inputPath || item.candidatePath),
      rootPath: normalizeSlash(item.rootPath || workspacePath),
      reason: item.reason,
    })),
    suggestedRoots,
    suggestedRoot: suggestedRoots.length === 1 ? suggestedRoots[0] : "",
    hint: root
      ? "Patch path was resolved under the requested root. Check strip/root or use a path that exists under root."
      : "Patch paths are resolved from the current workspace root. If target files are in a child project, include that project directory in the patch path or pass root.",
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
    throwPatchFileNotFound({ filePath, fieldName, candidates, agentContext, root, cause: firstError });
  }

  const matches = [];
  for (const candidate of candidates) {
    try {
      const resolvedPath = await assertAndResolveUserWorkspaceFilePath({
        filePath: candidate.inputPath || candidate.candidatePath,
        agentContext,
        fieldName,
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
    resolvedPath: await assertAndResolveUserWorkspaceFilePath({ filePath: fallback, agentContext, fieldName, mustExist: false }),
  };
}

function normalizePatchText(patch = "") {
  const text = String(patch || "").replace(/\r\n/g, "\n");
  const trimmed = text.trim();
  const fenced = /^```(?:diff|patch)?\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced ? fenced[1] : text;
}

export function parseUnifiedDiff(patch = "", strip = 1) {
  const lines = normalizePatchText(patch).split("\n");
  const filePatches = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith("--- ") || !lines[i + 1]?.startsWith("+++ ")) {
      i += 1;
      continue;
    }
    const oldPath = stripDiffPath(lines[i].slice(4), strip);
    const newPath = stripDiffPath(lines[i + 1].slice(4), strip);
    i += 2;
    const hunks = [];
    while (i < lines.length) {
      if (lines[i].startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
        break;
      }
      if (!lines[i].startsWith("@@")) {
        i += 1;
        continue;
      }
      const header = lines[i].trim() === "@@" ? null : parseUnifiedHunkHeader(lines[i]);
      i += 1;
      const hunkLines = [];
      let oldSeen = 0;
      let newSeen = 0;
      while (i < lines.length) {
        if (lines[i] === "\\ No newline at end of file") {
          i += 1;
          continue;
        }
        if (lines[i].startsWith("@@") || lines[i].startsWith("diff --git ")) break;
        if (lines[i].startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) break;
        const prefix = lines[i][0];
        if (![" ", "+", "-"].includes(prefix)) break;
        hunkLines.push({ type: prefix, text: lines[i].slice(1) });
        if (prefix !== "+") oldSeen += 1;
        if (prefix !== "-") newSeen += 1;
        i += 1;
      }
      hunks.push({
        ...(header || {}),
        searchOnly: !header,
        oldCount: oldSeen,
        newCount: newSeen,
        declaredOldCount: header?.oldCount || oldSeen,
        declaredNewCount: header?.newCount || newSeen,
        lines: hunkLines,
      });
    }
    filePatches.push({
      oldPath,
      newPath,
      hunks,
      mode: newPath === "/dev/null"
        ? "delete"
        : oldPath === "/dev/null"
          ? "add"
          : oldPath !== newPath
            ? "move"
            : "update",
    });
  }
  if (!filePatches.length) {
    throw recoverableToolError("invalid unified diff: no file patch found", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch" },
    });
  }
  return filePatches;
}

export function applyUnifiedHunks(originalContent = "", hunks = []) {
  const hadFinalNewline = String(originalContent || "").endsWith("\n");
  const originalLines = splitLines(originalContent);
  if (hadFinalNewline) originalLines.pop();
  const output = [];
  let pointer = 0;
  for (const hunk of hunks) {
    const hunkStart = Math.max(0, Number(hunk.oldStart || 1) - 1);
    if (hunkStart < pointer) {
      throw recoverableToolError("patch hunks overlap or are out of order", {
        code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
        details: { field: "patch" },
      });
    }
    output.push(...originalLines.slice(pointer, hunkStart));
    pointer = hunkStart;
    for (const line of hunk.lines || []) {
      if (line.type === " ") {
        if (originalLines[pointer] !== line.text) {
          throw recoverableToolError("patch context does not match target file", {
            code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
            details: {
              field: "patch",
              line: pointer + 1,
              expected: line.text,
              actual: originalLines[pointer],
            },
          });
        }
        output.push(line.text);
        pointer += 1;
      } else if (line.type === "-") {
        if (originalLines[pointer] !== line.text) {
          throw recoverableToolError("patch removal does not match target file", {
            code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
            details: {
              field: "patch",
              line: pointer + 1,
              expected: line.text,
              actual: originalLines[pointer],
            },
          });
        }
        pointer += 1;
      } else if (line.type === "+") {
        output.push(line.text);
      }
    }
  }
  output.push(...originalLines.slice(pointer));
  return output.join("\n") + (hadFinalNewline ? "\n" : "");
}

export function parseApplyPatch(patch = "") {
  const lines = normalizePatchText(patch).split("\n");
  if (lines[0] !== "*** Begin Patch" || !lines.some((line) => line === "*** End Patch")) {
    throw recoverableToolError("invalid apply_patch: missing Begin/End Patch marker", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch" },
    });
  }
  const patches = [];
  let i = 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line === "*** End Patch") break;
    if (line.startsWith("*** Add File: ")) {
      const filePath = line.slice("*** Add File: ".length).trim();
      i += 1;
      const contentLines = [];
      while (i < lines.length && !lines[i].startsWith("*** ")) {
        if (!lines[i].startsWith("+")) {
          throw recoverableToolError("invalid apply_patch add file line: expected + prefix", {
            code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
            details: { field: "patch" },
          });
        }
        contentLines.push(lines[i].slice(1));
        i += 1;
      }
      patches.push({ mode: "add", newPath: filePath, content: contentLines.join("\n") + (contentLines.length ? "\n" : "") });
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      patches.push({ mode: "delete", oldPath: line.slice("*** Delete File: ".length).trim() });
      i += 1;
      continue;
    }
    if (line.startsWith("*** Update File: ")) {
      const oldPath = line.slice("*** Update File: ".length).trim();
      let newPath = oldPath;
      i += 1;
      if (lines[i]?.startsWith("*** Move to: ")) {
        newPath = lines[i].slice("*** Move to: ".length).trim();
        i += 1;
      }
      const hunks = [];
      while (i < lines.length && !lines[i].startsWith("*** ")) {
        if (lines[i].startsWith("@@")) {
          i += 1;
          const hunkLines = [];
          while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("*** ")) {
            const prefix = lines[i][0];
            if ([" ", "+", "-"].includes(prefix)) {
              hunkLines.push({ type: prefix, text: lines[i].slice(1) });
            }
            i += 1;
          }
          hunks.push({ lines: hunkLines });
          continue;
        }
        i += 1;
      }
      patches.push({ mode: newPath === oldPath ? "update" : "move", oldPath, newPath, hunks });
      continue;
    }
    i += 1;
  }
  if (!patches.length) {
    throw recoverableToolError("invalid apply_patch: no file operation found", {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "patch" },
    });
  }
  return patches;
}

function findSubsequence(lines = [], pattern = [], startIndex = 0) {
  if (!pattern.length) return Math.max(0, startIndex);
  for (let i = Math.max(0, startIndex); i <= lines.length - pattern.length; i += 1) {
    let ok = true;
    for (let j = 0; j < pattern.length; j += 1) {
      if (lines[i + j] !== pattern[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

export function applySearchHunks(originalContent = "", hunks = []) {
  const hadFinalNewline = String(originalContent || "").endsWith("\n");
  const originalLines = splitLines(originalContent);
  if (hadFinalNewline) originalLines.pop();
  let output = [...originalLines];
  let searchStart = 0;
  for (const hunk of hunks) {
    const oldPattern = (hunk.lines || [])
      .filter((line) => line.type === " " || line.type === "-")
      .map((line) => line.text);
    const newBlock = (hunk.lines || [])
      .filter((line) => line.type === " " || line.type === "+")
      .map((line) => line.text);
    const hit = findSubsequence(output, oldPattern, searchStart);
    if (hit < 0) {
      throw recoverableToolError("apply_patch hunk context does not match target file", {
        code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
        details: {
          field: "patch",
          line: searchStart + 1,
          expected: oldPattern.join("\n"),
        },
      });
    }
    output = [
      ...output.slice(0, hit),
      ...newBlock,
      ...output.slice(hit + oldPattern.length),
    ];
    searchStart = hit + newBlock.length;
  }
  return output.join("\n") + (hadFinalNewline ? "\n" : "");
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
    const oldInfo = oldPath && oldPath !== "/dev/null"
      ? await resolveCompatibleWorkspaceFilePath({
        filePath: oldPath,
        agentContext,
        fieldName: "patch.oldPath",
        mustExist: normalizedItem.mode !== "add",
        root,
      })
      : { displayPath: oldPath, resolvedPath: "" };
    const newInfo = newPath && newPath !== "/dev/null"
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
