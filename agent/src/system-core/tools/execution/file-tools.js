/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
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
import { applySearchHunks, applyUnifiedHunks, parseApplyPatch, parseUnifiedDiff, resolvePatchTargets } from "./file-patch.js";

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

export function createFileTool({ agentContext }) {
  const readFileTool = new DynamicStructuredTool({
    name: TOOL_NAME.READ_FILE,
    description: tTool(agentContext, "tools.file.readDescriptionWithLineNumbers"),
    schema: z.object({
      filePath: z.string().describe(tTool(agentContext, "tools.file.readFilePathField")),
      startLine: z.number().int().optional().describe(tTool(agentContext, "tools.file.readStartLineField")),
      endLine: z.number().int().optional().describe(tTool(agentContext, "tools.file.readEndLineField")),
      includeLineNumbers: z.boolean().optional().default(true).describe(tTool(agentContext, "tools.file.readIncludeLineNumbersField")),
      maxLines: z.number().int().optional().default(DEFAULT_READ_MAX_LINES).describe(tTool(agentContext, "tools.file.readMaxLinesField")),
    }),
    func: async ({ filePath, startLine, endLine, includeLineNumbers = true, maxLines = DEFAULT_READ_MAX_LINES }) => {
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
    }),
    func: async ({ filePath, content, overwrite = true }) => {
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
        });
      }
      await mkdir(path.dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, content, "utf8");
      return toToolJsonResult(TOOL_NAME.WRITE_FILE, {
        ok: true,
        state: TOOL_RESULT_STATE.OK,
        resolvedPath,
        fileName: path.basename(resolvedPath),
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
    }),
    func: async ({ source = "files", query, isRegex = false, caseSensitive = false, path: inputPath = ".", glob = "", text = "", contextLines = DEFAULT_SEARCH_CONTEXT_LINES, maxResults = DEFAULT_SEARCH_MAX_RESULTS }) => {
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
        });
        matches = [];
        for (const file of files) {
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
      format: z.enum(["apply_patch", "unified_diff"]).optional().default("apply_patch").describe(tTool(agentContext, "tools.patch_file.fieldFormat")),
      patch: z.string().describe(tTool(agentContext, "tools.patch_file.fieldPatch")),
      strip: z.number().int().optional().default(1).describe(tTool(agentContext, "tools.patch_file.fieldStrip")),
      dryRun: z.boolean().optional().default(false).describe(tTool(agentContext, "tools.patch_file.fieldDryRun")),
    }),
    func: async ({ format = "apply_patch", patch = "", strip = 1, dryRun = false }) => {
      const normalizedFormat = String(format || "apply_patch").trim() === "unified_diff" ? "unified_diff" : "apply_patch";
      const parsed = normalizedFormat === "unified_diff"
        ? parseUnifiedDiff(patch, strip)
        : parseApplyPatch(patch);
      const targets = await resolvePatchTargets({ patches: parsed, agentContext });
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
          nextContent = normalizedFormat === "unified_diff"
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
        dryRun: dryRun === true,
        changedFiles: writePlans.map((item) => item.displayPath),
        deletedFiles: deletePlans.map((item) => item.displayPath),
      });
    },
  });

  return [readFileTool, writeFileTool, searchTool, patchFileTool];
}
