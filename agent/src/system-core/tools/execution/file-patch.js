/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
      details: { field: "patch" },
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
  if (/^file:\/\//i.test(trimmed)) {
    try {
      return normalizeSlash(fileURLToPath(trimmed));
    } catch {
      return normalizeSlash(trimmed.replace(/^file:\/+/i, ""));
    }
  }
  return normalizeSlash(trimmed);
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

function buildPatchPathVariants(filePath = "", agentContext = {}) {
  const normalized = normalizePatchPathInput(filePath);
  if (!normalized || normalized === "/dev/null") return [normalized];
  const parts = normalized.split("/").filter(Boolean);
  const workspaceBaseName = path.basename(path.resolve(getBasePathFromAgentContext(agentContext) || "."));
  const virtualRoots = new Set([...VIRTUAL_PATCH_ROOTS, workspaceBaseName].filter(Boolean));
  if ((path.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) && !virtualRoots.has(parts[0])) {
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

async function buildPatchPathCandidates(filePath = "", agentContext = {}) {
  const workspacePath = path.resolve(getBasePathFromAgentContext(agentContext) || ".");
  const variants = buildPatchPathVariants(filePath, agentContext);
  const baseCandidates = variants.map((candidatePath, index) => ({
    candidatePath,
    displayPath: candidatePath,
    rootPath: workspacePath,
    priority: index,
    reason: index === 0 ? "workspace" : "virtual-root-stripped",
  }));

  if (!isSuperUserAgentContext(agentContext)) return baseCandidates;

  const roots = await discoverSuperUserPatchRoots(agentContext);
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

function dedupeResolvedCandidates(candidates = []) {
  const seen = new Set();
  const result = [];
  const caseInsensitivePath = process.platform === "win32" || process.platform === "darwin";
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

async function resolveCompatibleWorkspaceFilePath({
  filePath = "",
  agentContext = {},
  fieldName = "filePath",
  mustExist = false,
} = {}) {
  const candidates = await buildPatchPathCandidates(filePath, agentContext);
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
    const uniqueMatches = dedupeResolvedCandidates(matches);
    if (uniqueMatches.length === 1) {
      const match = uniqueMatches[0];
      return { displayPath: match.displayPath, resolvedPath: match.resolvedPath };
    }
    if (uniqueMatches.length > 1) {
      throwAmbiguousPatchPath({ filePath, fieldName, matches: uniqueMatches });
    }
    if (firstError && candidates.length === 1) throw firstError;
    return {
      displayPath: filePath,
      resolvedPath: await assertAndResolveUserWorkspaceFilePath({ filePath, agentContext, fieldName, mustExist: true }),
    };
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
  const uniqueMatches = dedupeResolvedCandidates(matches);
  if (uniqueMatches.length === 1) {
    const match = uniqueMatches[0];
    return { displayPath: match.displayPath, resolvedPath: match.resolvedPath };
  }
  if (uniqueMatches.length > 1) {
    throwAmbiguousPatchPath({ filePath, fieldName, matches: uniqueMatches });
  }
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
      const header = parseUnifiedHunkHeader(lines[i]);
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
        ...header,
        oldCount: oldSeen,
        newCount: newSeen,
        declaredOldCount: header.oldCount,
        declaredNewCount: header.newCount,
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
  const resolved = [];
  for (const item of patches) {
    const targetPath = item.newPath && item.newPath !== "/dev/null" ? item.newPath : item.oldPath;
    assertValidFileNameFromPath({ filePath: targetPath, fieldName: "patch.path" });
    if (isForbiddenWorkspaceRelativePath(targetPath)) {
      throw recoverableToolError(`patch path is not allowed: ${targetPath}`, {
        code: ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
        details: { field: "patch", filePath: targetPath },
      });
    }
    const oldInfo = item.oldPath && item.oldPath !== "/dev/null"
      ? await resolveCompatibleWorkspaceFilePath({
        filePath: item.oldPath,
        agentContext,
        fieldName: "patch.oldPath",
        mustExist: item.mode !== "add",
      })
      : { displayPath: item.oldPath, resolvedPath: "" };
    const newInfo = item.newPath && item.newPath !== "/dev/null"
      ? item.mode !== "add" && item.oldPath === item.newPath && oldInfo.resolvedPath
        ? oldInfo
        : await resolveCompatibleWorkspaceFilePath({
          filePath: item.newPath,
          agentContext,
          fieldName: "patch.newPath",
          mustExist: false,
        })
      : { displayPath: item.newPath, resolvedPath: "" };
    resolved.push({
      ...item,
      oldPath: oldInfo.displayPath || item.oldPath,
      newPath: newInfo.displayPath || item.newPath,
      resolvedOldPath: oldInfo.resolvedPath,
      resolvedNewPath: newInfo.resolvedPath,
    });
  }
  return resolved;
}
