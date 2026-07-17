/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { filePath as path, isAbsolutePathAnyPlatform } from "../../utils/path-resolver.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  assertAndResolveUserWorkspaceFilePath,
  assertValidFileNameFromPath,
} from "../core/check-tool-input.js";
import { recoverableToolError } from "../../error/index.js";
import { ERROR_CODE } from "../../error/constants.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME, TOOL_RESULT_STATE } from "../constants/index.js";
import { isSuperUserAgentContext } from "../../utils/super-user.js";
import {
  DEFAULT_MAX_SEARCH_FILES,
  DEFAULT_READ_MAX_LINES,
  DEFAULT_SEARCH_CONTEXT_LINES,
  DEFAULT_SEARCH_MAX_RESULTS,
  exists,
  formatLinesWithNumbers,
  splitLines,
  toPositiveInt,
} from "./file-utils.js";
import { collectSearchFiles, hasRipgrep, searchFilesWithRipgrep, searchInText } from "./file-search.js";
import { confirmCriticalToolOperation, createRiskLevelSchema } from "./tool-risk.js";
import {
  applySearchHunks,
  applyUnifiedHunks,
  parseApplyPatch,
  parseUnifiedDiff,
  resolvePatchTargetsWithOptions,
} from "./file-patch.js";

function buildLineNumberedNearbyContent(content = "", targetLine = 1, radius = 3) {
  const rawContent = String(content || "");
  const lines = splitLines(rawContent);
  if (rawContent.endsWith("\n")) lines.pop();
  const totalLines = lines.length;
  if (!totalLines) {
    return {
      contextStartLine: 1,
      contextEndLine: 0,
      nearbyContent: "",
    };
  }
  const line = toPositiveInt(targetLine, 1, 1, totalLines);
  const contextRadius = toPositiveInt(radius, 3, 0, 20);
  const start = Math.max(1, line - contextRadius);
  const end = Math.min(totalLines, line + contextRadius);
  return {
    contextStartLine: start,
    contextEndLine: end,
    nearbyContent: formatLinesWithNumbers(lines.slice(start - 1, end), start),
  };
}

function buildPatchFailurePayload({
  error,
  original = "",
  displayPath = "",
  resolvedPath = "",
} = {}) {
  const details = error?.details && typeof error.details === "object" ? error.details : {};
  const line = Number(details?.line || 1);
  return {
    ok: false,
    code: String(error?.code || ERROR_CODE.RECOVERABLE_INVALID_INPUT),
    error: error?.message || String(error),
    message: error?.message || String(error),
    filePath: displayPath,
    resolvedPath,
    details,
    ...buildLineNumberedNearbyContent(original, line, 3),
  };
}

function resolveFileToolIsSandbox(agentContext = {}) {
  const runtime = agentContext?.execution?.controllers?.runtime || {};
  const globalCfg = runtime?.globalConfig?.tools?.execute_script && typeof runtime.globalConfig.tools.execute_script === "object"
    ? runtime.globalConfig.tools.execute_script
    : {};
  const userCfg = runtime?.userConfig?.tools?.execute_script && typeof runtime.userConfig.tools.execute_script === "object"
    ? runtime.userConfig.tools.execute_script
    : {};
  const scriptConfig = { ...globalCfg, ...userCfg };
  return scriptConfig?.sandboxMode === true || scriptConfig?.sandbox_mode === true;
}

function buildPatchFieldDescription(agentContext = {}, fieldName = "") {
  const isSandbox = resolveFileToolIsSandbox(agentContext);
  const isSuperUser = isSuperUserAgentContext(agentContext);
  const baseText = tTool(agentContext, `tools.patch_file.${fieldName}`);
  const modeText = (() => {
    if (fieldName === "fieldPatch") {
      if (isSandbox) {
        return tTool(agentContext, "tools.patch_file.fieldPatchPathHintSandbox");
      }
      if (isSuperUser) {
        return tTool(agentContext, "tools.patch_file.fieldPatchPathHintSuperHost");
      }
      return tTool(agentContext, "tools.patch_file.fieldPatchPathHintHost");
    }
    if (fieldName === "fieldRoot") {
      if (isSandbox) {
        return tTool(agentContext, "tools.patch_file.fieldRootPathHintSandbox");
      }
      if (isSuperUser) {
        return tTool(agentContext, "tools.patch_file.fieldRootPathHintSuperHost");
      }
      return tTool(agentContext, "tools.patch_file.fieldRootPathHintHost");
    }
    return "";
  })();
  return [baseText, modeText].map((item) => String(item || "").trim()).filter(Boolean).join(" ");
}

function uniqueNumbers(values = []) {
  return Array.from(new Set(values
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0)));
}

function buildPatchParseAttempts({ format = "", patch = "", strip = 1 } = {}) {
  const requestedFormat = String(format || "").trim();
  const trimmedPatch = String(patch || "").trimStart();
  const stripAttempts = uniqueNumbers([strip, 1, 0, 2]);
  const unifiedAttempts = stripAttempts.map((stripValue) => ({
    format: "unified_diff",
    strip: stripValue,
  }));
  const applyAttempt = { format: "apply_patch", strip };

  if (requestedFormat === "apply_patch") return [applyAttempt, ...unifiedAttempts];
  if (requestedFormat === "unified_diff") return [...unifiedAttempts, applyAttempt];
  if (trimmedPatch.startsWith("*** Begin Patch")) return [applyAttempt, ...unifiedAttempts];
  return [...unifiedAttempts, applyAttempt];
}

function buildPatchRootAttempts(root = "") {
  const normalizedRoot = String(root || "").trim();
  if (!normalizedRoot) return [""];
  const attempts = [normalizedRoot];
  if (normalizedRoot === ".." || normalizedRoot.startsWith("../") || normalizedRoot.startsWith("..\\")) {
    attempts.push("");
  }
  return Array.from(new Set(attempts));
}

function parsePatchAttempt({ patch = "", attempt = {} } = {}) {
  return attempt.format === "apply_patch"
    ? parseApplyPatch(patch)
    : parseUnifiedDiff(patch, attempt.strip);
}

async function preparePatchExecution({ format = "", patch = "", strip = 1, root = "", agentContext = {} } = {}) {
  const attempts = buildPatchParseAttempts({ format, patch, strip });
  const rootAttempts = buildPatchRootAttempts(root);
  const failures = [];
  for (const rootAttempt of rootAttempts) {
    for (const attempt of attempts) {
      let parsed = null;
      try {
        parsed = parsePatchAttempt({ patch, attempt });
      } catch (error) {
        failures.push({ ...attempt, root: rootAttempt, stage: "parse", error });
        continue;
      }
      try {
        const targets = await resolvePatchTargetsWithOptions({ patches: parsed, agentContext, root: rootAttempt });
        return { ...attempt, root: rootAttempt, parsed, targets };
      } catch (error) {
        failures.push({ ...attempt, root: rootAttempt, stage: "resolve", error });
      }
    }
  }
  const resolveFailures = failures.filter((item) => item.stage === "resolve");
  const firstFailure = failures[0]?.error;
  const firstResolveFailure = resolveFailures[0]?.error;
  const lastFailure = failures[failures.length - 1]?.error;
  const error = firstResolveFailure || lastFailure || firstFailure;
  if (error?.details && typeof error.details === "object") {
    error.details.patchAttempts = failures.map((item) => ({
      format: item.format,
      strip: item.strip,
      root: item.root,
      stage: item.stage,
      message: item.error?.message || String(item.error),
    }));
  }
  throw error || recoverableToolError("invalid patch", {
    code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
    details: { field: "patch" },
  });
}

export function createFileTool({ agentContext }) {
  const isSandbox = resolveFileToolIsSandbox(agentContext);
  const runtime = agentContext?.execution?.controllers?.runtime || {};
  const abortSignal = runtime?.abortSignal || null;
  const readFileTool = new DynamicStructuredTool({
    name: TOOL_NAME.READ_FILE,
    description: tTool(agentContext, "tools.file.readDescriptionWithLineNumbers"),
    schema: z.object({
      filePath: z.string().describe(tTool(agentContext, "tools.file.readFilePathField")),
      startLine: z.number().int().optional().describe(tTool(agentContext, "tools.file.readStartLineField")),
      endLine: z.number().int().optional().describe(tTool(agentContext, "tools.file.readEndLineField")),
      includeLineNumbers: z.boolean().optional().default(true).describe(tTool(agentContext, "tools.file.readIncludeLineNumbersField")),
      maxLines: z.number().int().optional().default(DEFAULT_READ_MAX_LINES).describe(tTool(agentContext, "tools.file.readMaxLinesField")),
      riskLevel: createRiskLevelSchema(agentContext, "tools.file.readRiskLevelField"),
    }),
    func: async ({ filePath, startLine, endLine, includeLineNumbers = true, maxLines = DEFAULT_READ_MAX_LINES, riskLevel }) => {
      await confirmCriticalToolOperation({ runtime, riskLevel, toolName: TOOL_NAME.READ_FILE, operation: "read file", target: "the requested file", reason: "The file may contain privacy information, credentials, tokens, or secrets." });
      assertValidFileNameFromPath({ filePath, fieldName: "filePath" });
      const resolvedPath = await assertAndResolveUserWorkspaceFilePath({
        filePath,
        agentContext,
        fieldName: "filePath",
        mustExist: true,
      });
      await stat(resolvedPath);
      const hasRange = Number.isFinite(Number(startLine)) || Number.isFinite(Number(endLine));
      const rawContent = await readFile(resolvedPath, "utf8");
      const allLines = splitLines(rawContent);
      if (rawContent.endsWith("\n")) allLines.pop();
      const totalLines = allLines.length;
      const start = toPositiveInt(startLine, 1, 1, Math.max(1, totalLines));
      const requestedEnd = Number.isFinite(Number(endLine))
        ? toPositiveInt(endLine, totalLines, 1, Math.max(1, totalLines))
        : totalLines;
      const lineLimit = toPositiveInt(maxLines, DEFAULT_READ_MAX_LINES, 1, 5000);
      const end = Math.min(Math.max(start, requestedEnd), start + lineLimit - 1, totalLines);
      const selectedLines = allLines.slice(start - 1, end);
      const content = includeLineNumbers
        ? formatLinesWithNumbers(selectedLines, start)
        : selectedLines.join("\n");
      const truncated = end < requestedEnd || end < totalLines;
      return toToolJsonResult(TOOL_NAME.READ_FILE, {
        ok: true,
        resolvedPath,
        fileName: path.basename(resolvedPath),
        isSandbox,
        startLine: start,
        endLine: end,
        totalLines,
        includeLineNumbers: includeLineNumbers !== false,
        truncated,
        content,
      });
    },
  });

  const writeFileTool = new DynamicStructuredTool({
    name: TOOL_NAME.WRITE_FILE,
    description: tTool(agentContext, "tools.file.writeDescription"),
    schema: z.object({
      filePath: z.string().describe(tTool(agentContext, "tools.file.writeFilePathField")),
      content: z.string().describe(tTool(agentContext, "tools.file.writeContentField")),
      overwrite: z.boolean().optional().default(true).describe(tTool(agentContext, "tools.file.writeOverwriteField")),
      riskLevel: createRiskLevelSchema(agentContext, "tools.file.writeRiskLevelField"),
    }),
    func: async ({ filePath, content, overwrite = true, riskLevel }) => {
      await confirmCriticalToolOperation({ runtime, riskLevel, toolName: TOOL_NAME.WRITE_FILE, operation: "write file", target: "the requested file", reason: "The write may make destructive or security-sensitive changes." });
      assertValidFileNameFromPath({ filePath, fieldName: "filePath" });
      const resolvedPath = await assertAndResolveUserWorkspaceFilePath({
        filePath,
        agentContext,
        fieldName: "filePath",
      });
      if (overwrite === false && await exists(resolvedPath)) {
        return toToolJsonResult(TOOL_NAME.WRITE_FILE, {
          ok: false,
          message: "file exists; set overwrite=true to replace it",
          resolvedPath,
          fileName: path.basename(resolvedPath),
          isSandbox,
        });
      }
      await mkdir(path.dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, content, "utf8");
      return toToolJsonResult(TOOL_NAME.WRITE_FILE, {
        ok: true,
        state: TOOL_RESULT_STATE.OK,
        resolvedPath,
        fileName: path.basename(resolvedPath),
        isSandbox,
      });
    },
  });

  const searchTool = new DynamicStructuredTool({
    name: TOOL_NAME.SEARCH,
    description: tTool(agentContext, "tools.search.description"),
    schema: z.object({
      source: z.enum(["files", "text"]).optional().default("files").describe(tTool(agentContext, "tools.search.fieldSource")),
      query: z.string().describe(tTool(agentContext, "tools.search.fieldQuery")),
      isRegex: z.boolean().optional().default(false).describe(tTool(agentContext, "tools.search.fieldIsRegex")),
      caseSensitive: z.boolean().optional().default(false).describe(tTool(agentContext, "tools.search.fieldCaseSensitive")),
      path: z.string().optional().describe(tTool(agentContext, "tools.search.fieldPath")),
      glob: z.string().optional().describe(tTool(agentContext, "tools.search.fieldGlob")),
      text: z.string().optional().describe(tTool(agentContext, "tools.search.fieldText")),
      contextLines: z.number().int().optional().default(DEFAULT_SEARCH_CONTEXT_LINES).describe(tTool(agentContext, "tools.search.fieldContextLines")),
      maxResults: z.number().int().optional().default(DEFAULT_SEARCH_MAX_RESULTS).describe(tTool(agentContext, "tools.search.fieldMaxResults")),
      riskLevel: createRiskLevelSchema(agentContext, "tools.search.fieldRiskLevel"),
    }),
    func: async ({ source = "files", query, isRegex = false, caseSensitive = false, path: inputPath = ".", glob = "", text = "", contextLines = DEFAULT_SEARCH_CONTEXT_LINES, maxResults = DEFAULT_SEARCH_MAX_RESULTS, riskLevel }) => {
      await confirmCriticalToolOperation({ runtime, riskLevel, toolName: TOOL_NAME.SEARCH, operation: source === "text" ? "search provided text" : "search local files", target: source === "text" ? "caller-provided text" : "the requested file scope", reason: "Search results may contain privacy information, credentials, tokens, or secrets." });
      const normalizedSource = String(source || "files").trim() === "text" ? "text" : "files";
      const normalizedQuery = String(query || "");
      if (!normalizedQuery) {
        return toToolJsonResult(TOOL_NAME.SEARCH, { ok: false, message: "query is required" });
      }
      if (normalizedSource === "text") {
        const normalizedText = String(text || "");
        const result = searchInText({ text: normalizedText, query: normalizedQuery, isRegex, caseSensitive, contextLines, maxResults });
        return toToolJsonResult(TOOL_NAME.SEARCH, {
          ok: true,
          source: "text",
          query: normalizedQuery,
          ...result,
        });
      }

      const searchRoot = await assertAndResolveUserWorkspaceFilePath({
        filePath: inputPath || ".",
        agentContext,
        fieldName: "path",
        mustExist: true,
      });
      const workspacePath = await assertAndResolveUserWorkspaceFilePath({
        filePath: ".",
        agentContext,
        fieldName: "workspace",
        mustExist: true,
      });
      const maxCount = toPositiveInt(maxResults, DEFAULT_SEARCH_MAX_RESULTS, 1, 500);
      let fastSearchResult = null;
      if (await hasRipgrep()) {
        try {
          fastSearchResult = await searchFilesWithRipgrep({
            rootPath: searchRoot,
            workspacePath,
            query: normalizedQuery,
            isRegex,
            caseSensitive,
            glob,
            contextLines,
            maxResults: maxCount,
            abortSignal,
          });
        } catch {
          fastSearchResult = null;
        }
      }
      let matches = Array.isArray(fastSearchResult?.matches)
        ? fastSearchResult.matches
        : [];
      let truncated = fastSearchResult?.truncated === true;
      if (!fastSearchResult) {
        const files = await collectSearchFiles({
          rootPath: searchRoot,
          workspacePath,
          glob,
          maxFiles: DEFAULT_MAX_SEARCH_FILES,
          abortSignal,
        });
        matches = [];
        for (const file of files) {
          if (abortSignal?.aborted) throw abortSignal.reason || new DOMException("The operation was aborted", "AbortError");
          if (matches.length >= maxCount) break;
          let content = "";
          try {
            content = await readFile(file.filePath, "utf8");
          } catch {
            continue;
          }
          const result = searchInText({
            text: content,
            query: normalizedQuery,
            isRegex,
            caseSensitive,
            contextLines,
            maxResults: maxCount - matches.length,
            filePath: file.relativePath,
          });
          matches.push(...result.matches);
        }
        truncated = matches.length >= maxCount;
      }
      return toToolJsonResult(TOOL_NAME.SEARCH, {
        ok: true,
        source: "files",
        query: normalizedQuery,
        path: inputPath || ".",
        glob: String(glob || ""),
        matches,
        truncated,
      });
    },
  });

  const patchFileTool = new DynamicStructuredTool({
    name: TOOL_NAME.PATCH_FILE,
    description: tTool(agentContext, "tools.patch_file.description"),
    schema: z.object({
      format: z.enum(["unified_diff", "apply_patch"]).optional().describe(tTool(agentContext, "tools.patch_file.fieldFormat")),
      patch: z.string().describe(buildPatchFieldDescription(agentContext, "fieldPatch")),
      strip: z.number().int().optional().default(1).describe(tTool(agentContext, "tools.patch_file.fieldStrip")),
      root: z.string().optional().default("").describe(buildPatchFieldDescription(agentContext, "fieldRoot")),
      dryRun: z.boolean().optional().default(false).describe(tTool(agentContext, "tools.patch_file.fieldDryRun")),
      riskLevel: createRiskLevelSchema(agentContext, "tools.patch_file.fieldRiskLevel"),
    }),
    func: async ({ format, patch = "", strip = 1, root = "", dryRun = false, riskLevel }) => {
      await confirmCriticalToolOperation({ runtime, riskLevel, toolName: TOOL_NAME.PATCH_FILE, operation: dryRun ? "validate file patch" : "apply file patch", target: "the requested file scope", reason: "The patch may add, modify, move, or delete files." });
      const prepared = await preparePatchExecution({ format, patch, strip, root, agentContext });
      const normalizedFormat = prepared.format;
      // strip only affects relative diff prefixes (git a/, b/, etc). When every
      // target path is absolute, strip is never applied, so the retry-loop value
      // in prepared.strip is meaningless; report null to avoid a misleading echo.
      const stripAppliesToTargets = prepared.targets.some((item) => {
        const oldPath = String(item.oldPath || "");
        const newPath = String(item.newPath || "");
        const relevant = [oldPath, newPath].filter((value) => value && value !== "/dev/null");
        return relevant.some((value) => !isAbsolutePathAnyPlatform(value));
      });
      const resolvedStrip = stripAppliesToTargets ? prepared.strip : null;
      const resolvedRoot = prepared.root;
      const targets = prepared.targets;
      const writePlans = [];
      const deletePlans = [];
      for (const item of targets) {
        if (item.mode === "add") {
          if (await exists(item.resolvedNewPath)) {
            throw recoverableToolError(`target file already exists: ${item.newPath}`, {
              code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
              details: { field: "patch", filePath: item.newPath },
            });
          }
          const content = Object.prototype.hasOwnProperty.call(item, "content")
            ? item.content
            : applyUnifiedHunks("", item.hunks || []);
          writePlans.push({ filePath: item.resolvedNewPath, content, displayPath: item.newPath });
          continue;
        }
        if (item.mode === "delete") {
          deletePlans.push({ filePath: item.resolvedOldPath, displayPath: item.oldPath });
          continue;
        }
        const original = await readFile(item.resolvedOldPath, "utf8");
        let nextContent = "";
        try {
          nextContent = normalizedFormat === "unified_diff" && !(item.hunks || []).some((hunk) => hunk?.searchOnly)
            ? applyUnifiedHunks(original, item.hunks || [])
            : applySearchHunks(original, item.hunks || []);
        } catch (error) {
          return toToolJsonResult(
            TOOL_NAME.PATCH_FILE,
            buildPatchFailurePayload({
              error,
              original,
              displayPath: item.oldPath,
              resolvedPath: item.resolvedOldPath,
            }),
          );
        }
        const outputPath = item.resolvedNewPath || item.resolvedOldPath;
        writePlans.push({ filePath: outputPath, content: nextContent, displayPath: item.newPath || item.oldPath });
        if (item.mode === "move" && item.resolvedOldPath !== outputPath) {
          deletePlans.push({ filePath: item.resolvedOldPath, displayPath: item.oldPath });
        }
      }
      if (!dryRun) {
        for (const plan of writePlans) {
          await mkdir(path.dirname(plan.filePath), { recursive: true });
          await writeFile(plan.filePath, plan.content, "utf8");
        }
        for (const plan of deletePlans) {
          if (writePlans.some((item) => item.filePath === plan.filePath)) continue;
          await unlink(plan.filePath);
        }
      }
      return toToolJsonResult(TOOL_NAME.PATCH_FILE, {
        ok: true,
        format: normalizedFormat,
        strip: normalizedFormat === "unified_diff" ? resolvedStrip : undefined,
        dryRun: dryRun === true,
        root: String(resolvedRoot || ""),
        requestedRoot: String(root || ""),
        changedFiles: writePlans.map((item) => item.displayPath),
        deletedFiles: deletePlans.map((item) => item.displayPath),
        resolvedFiles: [
          ...writePlans.map((item) => ({
            path: item.displayPath,
            resolvedPath: item.filePath,
            action: "write",
          })),
          ...deletePlans.map((item) => ({
            path: item.displayPath,
            resolvedPath: item.filePath,
            action: "delete",
          })),
        ],
      });
    },
  });

  return [readFileTool, writeFileTool, searchTool, patchFileTool];
}
