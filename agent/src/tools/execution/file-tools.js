/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  filePath as path,
  isAbsolutePathAnyPlatform,
  PATH_CAPABILITIES,
  resolvePathPolicy,
  resolvePathRef,
  TOOL_PATH_CONTRACTS,
} from "@noobot/path-resolver";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  assertValidFileNameFromPath,
  canUseHostPathsForWorkspaceTools,
  projectToolPathRef,
  resolveAuthorizedUserWorkspaceFilePath,
} from "../core/check-tool-input.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { registerResource } from "../core/resource-broker.js";
import { createWorkspaceIoExecutor } from "../core/workspace-io-executor.js";
import { createFileSourceSchema, resolveFileInput } from "../core/file-input.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME, TOOL_RESULT_STATE } from "../constants/index.js";
import {
  DEFAULT_MAX_SEARCH_FILES,
  DEFAULT_READ_MAX_LINES,
  DEFAULT_SEARCH_CONTEXT_LINES,
  DEFAULT_SEARCH_MAX_RESULTS,
  formatLinesWithNumbers,
  splitLines,
  toPositiveInt,
} from "./file-utils.js";
import {
  collectSearchFiles,
  hasRipgrep,
  searchFilesWithRipgrep,
  searchInText,
} from "./file-search.js";
import { resolveToolExecutionPolicy } from "@noobot/execution-isolation-protocol";
import {
  SECURITY_EVIDENCE_SOURCE,
  classifyResourceRisk,
} from "@noobot/security-assessment-protocol";
import { confirmToolOperation, createRiskLevelSchema } from "./tool-risk.js";
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

function resourceFileName(resource) {
  return path.basename(String(resource?.logical?.path || "").trim());
}

function buildPatchFailurePayload({ error, original = "", pathRef = null } = {}) {
  const details = error?.details && typeof error.details === "object" ? error.details : {};
  const line = Number(details?.line || 1);
  return {
    ok: false,
    code: String(error?.code || ERROR_CODE.RECOVERABLE_INVALID_INPUT),
    error: error?.message || String(error),
    message: error?.message || String(error),
    ...(pathRef ? { path: projectToolPathRef(pathRef) } : {}),
    details,
    ...buildLineNumberedNearbyContent(original, line, 3),
  };
}

function buildFileToolDescription(agentContext = {}, descriptionKey = "") {
  const runtime = agentContext?.bindings?.runtime || {};
  const resolution = resolvePathPolicy(runtime.globalConfig || {}).resolution || {};
  return [
    tTool(agentContext, descriptionKey),
    tTool(agentContext, "tools.file.workspaceRelativePathRule"),
    ...(resolution.followSymbolicLinks === true
      ? []
      : [tTool(agentContext, "tools.file.symbolicLinkRule")]),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");
}

function buildPatchFieldDescription(agentContext = {}, fieldName = "") {
  const hostPathsAllowed = canUseHostPathsForWorkspaceTools(agentContext);
  const baseText = tTool(agentContext, `tools.patch_file.${fieldName}`);
  const modeText = (() => {
    if (fieldName === "fieldPatch") {
      if (hostPathsAllowed) {
        return tTool(agentContext, "tools.patch_file.fieldPatchPathHintSuperHost");
      }
      return tTool(agentContext, "tools.patch_file.fieldPatchPathHintHost");
    }
    if (fieldName === "fieldRoot") {
      if (hostPathsAllowed) {
        return tTool(agentContext, "tools.patch_file.fieldRootPathHintSuperHost");
      }
      return tTool(agentContext, "tools.patch_file.fieldRootPathHintHost");
    }
    return "";
  })();
  return [baseText, modeText]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");
}

function resolvePatchProtocol({ format = "", patch = "", strip = 1 } = {}) {
  const requestedFormat = String(format || "").trim();
  const trimmedPatch = String(patch || "").trimStart();
  const detectedFormat = trimmedPatch.startsWith("*** Begin Patch")
    ? "apply_patch"
    : "unified_diff";
  if (requestedFormat && requestedFormat !== detectedFormat) {
    throw recoverableToolError(`patch format does not match content: expected ${detectedFormat}`, {
      code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
      details: { field: "format", requestedFormat, detectedFormat },
    });
  }
  return { format: requestedFormat || detectedFormat, strip };
}

function parsePatchAttempt({ patch = "", attempt = {} } = {}) {
  return attempt.format === "apply_patch"
    ? parseApplyPatch(patch)
    : parseUnifiedDiff(patch, attempt.strip);
}

async function preparePatchExecution({
  format = "",
  patch = "",
  strip = 1,
  root = "",
  agentContext = {},
} = {}) {
  const protocol = resolvePatchProtocol({ format, patch, strip });
  const parsed = parsePatchAttempt({ patch, attempt: protocol });
  const normalizedRoot = String(root || "").trim();
  const targets = await resolvePatchTargetsWithOptions({
    patches: parsed,
    agentContext,
    root: normalizedRoot,
  });
  return { ...protocol, root: normalizedRoot, parsed, targets };
}

export function createFileTool({ agentContext }) {
  const runtime = agentContext?.bindings?.runtime || {};
  const abortSignal = runtime?.abortSignal || null;
  const workspaceIo = createWorkspaceIoExecutor({
    executionPolicy: resolveToolExecutionPolicy({
      toolName: TOOL_NAME.READ_FILE,
      globalConfig: runtime.globalConfig || {},
    }),
  });
  const readFileTool = new DynamicStructuredTool({
    name: TOOL_NAME.READ_FILE,
    metadata: { pathContract: TOOL_PATH_CONTRACTS.fileRead },
    description: buildFileToolDescription(
      agentContext,
      "tools.file.readDescriptionWithLineNumbers",
    ),
    schema: z.object({
      filePath: createFileSourceSchema({
        filePathDescription: tTool(agentContext, "tools.file.readFilePathField"),
      }),
      startLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(tTool(agentContext, "tools.file.readStartLineField")),
      endLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(tTool(agentContext, "tools.file.readEndLineField")),
      includeLineNumbers: z
        .boolean()
        .optional()
        .default(true)
        .describe(tTool(agentContext, "tools.file.readIncludeLineNumbersField")),
      maxLines: z
        .number()
        .int()
        .optional()
        .default(DEFAULT_READ_MAX_LINES)
        .describe(tTool(agentContext, "tools.file.readMaxLinesField")),
      riskLevel: createRiskLevelSchema(agentContext, "tools.file.readRiskLevelField"),
    }),
    func: async ({
      filePath,
      startLine,
      endLine,
      includeLineNumbers = true,
      maxLines = DEFAULT_READ_MAX_LINES,
      riskLevel,
    }) => {
      if (typeof filePath === "string")
        assertValidFileNameFromPath({ filePath, fieldName: "filePath" });
      const resolvedInput = await resolveFileInput({
        source: filePath,
        agentContext,
        fieldName: "filePath",
        mustExist: true,
        capability: PATH_CAPABILITIES.FILE_READ,
      });
      const resolvedPath = resolvedInput.executionPath;
      const pathRef = resolvedInput.pathRef;
      await confirmToolOperation({
        runtime,
        declaredRiskLevel: riskLevel,
        serverEvidence: {
          source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
          riskLevel: classifyResourceRisk({ operation: "read", scope: pathRef.view }),
        },
        toolName: TOOL_NAME.READ_FILE,
        operation: "read file",
        target: projectToolPathRef(pathRef),
        reason: "The final normalized resource requires confirmation under the server path policy.",
      });
      const targetStat = await workspaceIo.stat(resolvedPath);
      if (targetStat?.isDirectory?.()) {
        throw recoverableToolError(tTool(agentContext, "common.pathIsNotFile"), {
          code: ERROR_CODE.RECOVERABLE_PATH_NOT_FILE,
          details: { field: "filePath", path: projectToolPathRef(pathRef) },
        });
      }
      const hasRange = Number.isFinite(Number(startLine)) || Number.isFinite(Number(endLine));
      const rawContent = await workspaceIo.readText(resolvedPath);
      const allLines = splitLines(rawContent);
      if (rawContent.endsWith("\n")) allLines.pop();
      const totalLines = allLines.length;
      const requestedStart = Number.isFinite(Number(startLine)) ? Number(startLine) : 1;
      const requestedEnd = Number.isFinite(Number(endLine)) ? Number(endLine) : totalLines;
      const rangeError =
        Number.isFinite(Number(startLine)) && requestedStart > Math.max(1, totalLines)
          ? { field: "startLine", reason: "start_line_after_eof" }
          : Number.isFinite(Number(endLine)) && requestedEnd < requestedStart
            ? { field: "endLine", reason: "end_line_before_start_line" }
            : null;
      if (rangeError) {
        throw recoverableToolError(
          tTool(agentContext, "tools.file.readLineRangeOutOfBounds", {
            startLine: requestedStart,
            endLine: requestedEnd,
            totalLines,
          }),
          {
            code: ERROR_CODE.RECOVERABLE_LINE_RANGE_OUT_OF_BOUNDS,
            details: {
              ...rangeError,
              requestedStartLine: requestedStart,
              requestedEndLine: requestedEnd,
              totalLines,
            },
          },
        );
      }
      const start = requestedStart;
      const lineLimit = toPositiveInt(maxLines, DEFAULT_READ_MAX_LINES, 1, 5000);
      const end = Math.min(Math.max(start, requestedEnd), start + lineLimit - 1, totalLines);
      const selectedLines = allLines.slice(start - 1, end);
      const content = includeLineNumbers
        ? formatLinesWithNumbers(selectedLines, start)
        : selectedLines.join("\n");
      const readableEnd = Math.min(requestedEnd, totalLines);
      const truncated = end < readableEnd || (hasRange && requestedEnd < totalLines);
      const resource =
        resolvedInput.resourceRef ||
        (await registerResource({
          agentContext,
          executionPath: resolvedPath,
          logicalPathRef: pathRef,
          capabilities: { read: true, write: false, scriptInput: true },
        }));
      return toToolJsonResult(TOOL_NAME.READ_FILE, {
        ok: true,
        path: projectToolPathRef(pathRef),
        fileName: resourceFileName(resource),
        resources: [resource],
        startLine: start,
        endLine: end,
        totalLines,
        includeLineNumbers: includeLineNumbers !== false,
        truncated,
        hasMore: end < totalLines,
        content,
      });
    },
  });

  const writeFileTool = new DynamicStructuredTool({
    name: TOOL_NAME.WRITE_FILE,
    metadata: { pathContract: TOOL_PATH_CONTRACTS.fileWrite },
    description: buildFileToolDescription(agentContext, "tools.file.writeDescription"),
    schema: z.object({
      filePath: createFileSourceSchema({
        filePathDescription: tTool(agentContext, "tools.file.writeFilePathField"),
      }),
      content: z.string().describe(tTool(agentContext, "tools.file.writeContentField")),
      overwrite: z
        .boolean()
        .optional()
        .default(true)
        .describe(tTool(agentContext, "tools.file.writeOverwriteField")),
      riskLevel: createRiskLevelSchema(agentContext, "tools.file.writeRiskLevelField"),
    }),
    func: async ({ filePath, content, overwrite = true, riskLevel }) => {
      if (typeof filePath === "string")
        assertValidFileNameFromPath({ filePath, fieldName: "filePath" });
      const resolvedInput = await resolveFileInput({
        source: filePath,
        agentContext,
        fieldName: "filePath",
        mustExist: false,
        capability: PATH_CAPABILITIES.FILE_WRITE,
      });
      const resolvedPath = resolvedInput.executionPath;
      const pathRef = resolvedInput.pathRef;
      await confirmToolOperation({
        runtime,
        declaredRiskLevel: riskLevel,
        serverEvidence: {
          source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
          riskLevel: classifyResourceRisk({ operation: "write", scope: pathRef.view }),
        },
        toolName: TOOL_NAME.WRITE_FILE,
        operation: "write file",
        target: projectToolPathRef(pathRef),
        reason: "The final normalized resource requires confirmation under the server path policy.",
      });
      if (overwrite === false && (await workspaceIo.exists(resolvedPath))) {
        const message = tTool(agentContext, "tools.file.writeAlreadyExists");
        return toToolJsonResult(TOOL_NAME.WRITE_FILE, {
          ok: false,
          code: ERROR_CODE.RECOVERABLE_FILE_ALREADY_EXISTS,
          error: message,
          message,
          path: projectToolPathRef(pathRef),
          fileName: path.basename(resolvedPath),
        });
      }
      await workspaceIo.writeText(resolvedPath, content);
      const resource = await registerResource({
        agentContext,
        executionPath: resolvedPath,
        logicalPathRef: pathRef,
        capabilities: { read: true, write: true, scriptInput: true },
      });
      return toToolJsonResult(TOOL_NAME.WRITE_FILE, {
        ok: true,
        state: TOOL_RESULT_STATE.OK,
        path: projectToolPathRef(pathRef),
        fileName: resourceFileName(resource),
        resources: [resource],
        outputArtifacts: [
          {
            type: "text",
            name: path.basename(resolvedPath),
            mimeType: "text/plain",
            content,
          },
        ],
      });
    },
  });

  const searchTool = new DynamicStructuredTool({
    name: TOOL_NAME.SEARCH,
    metadata: { pathContract: TOOL_PATH_CONTRACTS.fileSearch },
    description: buildFileToolDescription(agentContext, "tools.search.description"),
    schema: z.object({
      source: z
        .enum(["files", "text"])
        .optional()
        .default("files")
        .describe(tTool(agentContext, "tools.search.fieldSource")),
      query: z.string().min(1).describe(tTool(agentContext, "tools.search.fieldQuery")),
      isRegex: z
        .boolean()
        .optional()
        .default(false)
        .describe(tTool(agentContext, "tools.search.fieldIsRegex")),
      caseSensitive: z
        .boolean()
        .optional()
        .default(false)
        .describe(tTool(agentContext, "tools.search.fieldCaseSensitive")),
      path: z.string().optional().describe(tTool(agentContext, "tools.search.fieldPath")),
      glob: z.string().optional().describe(tTool(agentContext, "tools.search.fieldGlob")),
      text: z.string().optional().describe(tTool(agentContext, "tools.search.fieldText")),
      contextLines: z
        .number()
        .int()
        .optional()
        .default(DEFAULT_SEARCH_CONTEXT_LINES)
        .describe(tTool(agentContext, "tools.search.fieldContextLines")),
      maxResults: z
        .number()
        .int()
        .optional()
        .default(DEFAULT_SEARCH_MAX_RESULTS)
        .describe(tTool(agentContext, "tools.search.fieldMaxResults")),
      riskLevel: createRiskLevelSchema(agentContext, "tools.search.fieldRiskLevel"),
    }),
    func: async ({
      source = "files",
      query,
      isRegex = false,
      caseSensitive = false,
      path: inputPath = ".",
      glob = "",
      text = "",
      contextLines = DEFAULT_SEARCH_CONTEXT_LINES,
      maxResults = DEFAULT_SEARCH_MAX_RESULTS,
      riskLevel,
    }) => {
      const normalizedSource = String(source || "files").trim() === "text" ? "text" : "files";
      const normalizedQuery = String(query || "");
      if (!normalizedQuery) {
        return toToolJsonResult(TOOL_NAME.SEARCH, {
          ok: false,
          message: tTool(agentContext, "tools.search.queryRequired"),
        });
      }
      if (normalizedSource === "text") {
        await confirmToolOperation({
          runtime,
          declaredRiskLevel: riskLevel,
          serverEvidence: {
            source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
            riskLevel: classifyResourceRisk({ operation: "search", scope: "workspace" }),
          },
          toolName: TOOL_NAME.SEARCH,
          operation: "search provided text",
          reason:
            "The model-declared risk and server-classified risk are combined at the highest level.",
        });
        const normalizedText = String(text || "");
        const result = searchInText({
          text: normalizedText,
          query: normalizedQuery,
          isRegex,
          caseSensitive,
          contextLines,
          maxResults,
        });
        return toToolJsonResult(TOOL_NAME.SEARCH, {
          ok: true,
          source: "text",
          query: normalizedQuery,
          resources: [],
          ...result,
        });
      }

      const searchResolution = await resolveAuthorizedUserWorkspaceFilePath({
        filePath: inputPath || ".",
        agentContext,
        fieldName: "path",
        mustExist: true,
        capability: PATH_CAPABILITIES.FILE_SEARCH,
      });
      const searchRoot = searchResolution.executionPath;
      const searchPathRef = searchResolution.pathRef;
      await confirmToolOperation({
        runtime,
        declaredRiskLevel: riskLevel,
        serverEvidence: {
          source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
          riskLevel: classifyResourceRisk({ operation: "search", scope: searchPathRef.view }),
        },
        toolName: TOOL_NAME.SEARCH,
        operation: "search local files",
        target: projectToolPathRef(searchPathRef),
        reason: "The final normalized resource requires confirmation under the server path policy.",
      });
      const workspaceResolution = await resolveAuthorizedUserWorkspaceFilePath({
        filePath: ".",
        agentContext,
        fieldName: "workspace",
        mustExist: true,
        capability: PATH_CAPABILITIES.FILE_SEARCH,
      });
      const mountedSearch = Boolean(searchResolution.toolPath.executionRoot);
      const searchProjectionRoot = mountedSearch ? searchRoot : workspaceResolution.executionPath;
      const maxCount = toPositiveInt(maxResults, DEFAULT_SEARCH_MAX_RESULTS, 1, 500);
      let fastSearchResult = null;
      if (await hasRipgrep()) {
        try {
          fastSearchResult = await searchFilesWithRipgrep({
            rootPath: searchRoot,
            workspacePath: searchProjectionRoot,
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
      let matches = Array.isArray(fastSearchResult?.matches) ? fastSearchResult.matches : [];
      let truncated = fastSearchResult?.truncated === true;
      if (!fastSearchResult) {
        const files = await collectSearchFiles({
          rootPath: searchRoot,
          workspacePath: searchProjectionRoot,
          glob,
          maxFiles: DEFAULT_MAX_SEARCH_FILES,
          abortSignal,
        });
        matches = [];
        for (const file of files) {
          if (abortSignal?.aborted)
            throw abortSignal.reason || new DOMException("The operation was aborted", "AbortError");
          if (matches.length >= maxCount) break;
          let content = "";
          try {
            content = await workspaceIo.readText(file.filePath);
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
      const resolvedMatches = await Promise.all(
        matches.map(async (match) => {
          const relativeMatchPath = String(match?.filePath || "").trim();
          const matchedPath = mountedSearch
            ? path.join(searchPathRef.path, relativeMatchPath)
            : relativeMatchPath;
          if (!matchedPath) return { match, resolution: null };
          const resolvedMatch = await resolveAuthorizedUserWorkspaceFilePath({
            filePath: matchedPath,
            agentContext,
            fieldName: "match.filePath",
            mustExist: true,
            capability: PATH_CAPABILITIES.FILE_READ,
          });
          return { match, resolution: resolvedMatch };
        }),
      );
      matches = resolvedMatches.map(({ match, resolution }) => {
        const { filePath: _internalFilePath, ...publicMatch } = match;
        return {
          ...publicMatch,
          ...(resolution ? { path: projectToolPathRef(resolution.pathRef) } : {}),
        };
      });
      const resources = await Promise.all(
        resolvedMatches
          .filter(({ resolution }) => resolution)
          .map(({ resolution }) =>
            registerResource({
              agentContext,
              executionPath: resolution.executionPath,
              logicalPathRef: resolution.pathRef,
              capabilities: { read: true, write: false, scriptInput: true },
            }),
          ),
      );
      return toToolJsonResult(TOOL_NAME.SEARCH, {
        ok: true,
        source: "files",
        query: normalizedQuery,
        path: projectToolPathRef(searchPathRef),
        glob: String(glob || ""),
        matches,
        resources,
        truncated,
      });
    },
  });

  const patchFileTool = new DynamicStructuredTool({
    name: TOOL_NAME.PATCH_FILE,
    metadata: { pathContract: TOOL_PATH_CONTRACTS.filePatch },
    description: buildFileToolDescription(agentContext, "tools.patch_file.description"),
    schema: z.object({
      format: z
        .enum(["unified_diff", "apply_patch"])
        .optional()
        .describe(tTool(agentContext, "tools.patch_file.fieldFormat")),
      patch: z.string().describe(buildPatchFieldDescription(agentContext, "fieldPatch")),
      strip: z
        .number()
        .int()
        .optional()
        .default(1)
        .describe(tTool(agentContext, "tools.patch_file.fieldStrip")),
      root: z
        .string()
        .optional()
        .default("")
        .describe(buildPatchFieldDescription(agentContext, "fieldRoot")),
      dryRun: z
        .boolean()
        .optional()
        .default(false)
        .describe(tTool(agentContext, "tools.patch_file.fieldDryRun")),
      riskLevel: createRiskLevelSchema(agentContext, "tools.patch_file.fieldRiskLevel"),
    }),
    func: async ({ format, patch = "", strip = 1, root = "", dryRun = false, riskLevel }) => {
      const prepared = await preparePatchExecution({ format, patch, strip, root, agentContext });
      const patchPathRefs = prepared.targets
        .flatMap((item) => [item.oldPathRef, item.newPathRef])
        .filter(Boolean)
        .map((item) => resolvePathRef({ input: item, workspaceRoot: runtime?.basePath || "" }));
      const pathView = patchPathRefs.some((item) => item.view === "host") ? "host" : "workspace";
      await confirmToolOperation({
        runtime,
        declaredRiskLevel: riskLevel,
        serverEvidence: {
          source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
          riskLevel: dryRun
            ? classifyResourceRisk({ operation: "read", scope: pathView })
            : classifyResourceRisk({ operation: "patch", scope: pathView }),
        },
        toolName: TOOL_NAME.PATCH_FILE,
        operation: dryRun ? "validate file patch" : "apply file patch",
        target: prepared.targets
          .map((item) => item.newPath || item.oldPath)
          .filter(Boolean)
          .join(", "),
        reason: "The final normalized resources require confirmation under the server path policy.",
      });
      const normalizedFormat = prepared.format;
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
          if (await workspaceIo.exists(item.resolvedNewPath)) {
            throw recoverableToolError(`target file already exists: ${item.newPath}`, {
              code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
              details: { field: "patch", filePath: item.newPath },
            });
          }
          const content = Object.prototype.hasOwnProperty.call(item, "content")
            ? item.content
            : applyUnifiedHunks("", item.hunks || []);
          writePlans.push({
            filePath: item.resolvedNewPath,
            content,
            pathRef: item.newPathRef,
          });
          continue;
        }
        if (item.mode === "delete") {
          deletePlans.push({ filePath: item.resolvedOldPath, pathRef: item.oldPathRef });
          continue;
        }
        const original = await workspaceIo.readText(item.resolvedOldPath);
        let nextContent = "";
        try {
          nextContent =
            normalizedFormat === "unified_diff" &&
            !(item.hunks || []).some((hunk) => hunk?.searchOnly)
              ? applyUnifiedHunks(original, item.hunks || [])
              : applySearchHunks(original, item.hunks || []);
        } catch (error) {
          return toToolJsonResult(
            TOOL_NAME.PATCH_FILE,
            buildPatchFailurePayload({
              error,
              original,
              pathRef: item.oldPathRef,
            }),
          );
        }
        const outputPath = item.resolvedNewPath || item.resolvedOldPath;
        writePlans.push({
          filePath: outputPath,
          content: nextContent,
          displayPath: item.newPath || item.oldPath,
          pathRef: item.newPathRef || item.oldPathRef,
        });
        if (item.mode === "move" && item.resolvedOldPath !== outputPath) {
          deletePlans.push({ filePath: item.resolvedOldPath, pathRef: item.oldPathRef });
        }
      }
      if (!dryRun) {
        for (const plan of writePlans) {
          await workspaceIo.writeText(plan.filePath, plan.content);
        }
        for (const plan of deletePlans) {
          if (writePlans.some((item) => item.filePath === plan.filePath)) continue;
          await workspaceIo.remove(plan.filePath);
        }
      }
      const resources = dryRun
        ? []
        : await Promise.all(
            writePlans.map((item) =>
              registerResource({
                agentContext,
                executionPath: item.filePath,
                logicalPathRef: item.pathRef,
                capabilities: { read: true, write: true, scriptInput: true },
              }),
            ),
          );
      return toToolJsonResult(TOOL_NAME.PATCH_FILE, {
        ok: true,
        format: normalizedFormat,
        strip: normalizedFormat === "unified_diff" ? resolvedStrip : undefined,
        dryRun: dryRun === true,
        root: projectToolPathRef(
          resolvePathRef({
            input: resolvedRoot,
            workspaceRoot: runtime?.basePath || "",
          }),
        ),
        changes: [
          ...writePlans.map((item) => ({
            path: projectToolPathRef(item.pathRef),
            action: "write",
          })),
          ...deletePlans.map((item) => ({
            path: projectToolPathRef(item.pathRef),
            action: "delete",
          })),
        ],
        resources,
      });
    },
  });

  return [readFileTool, writeFileTool, searchTool, patchFileTool];
}
