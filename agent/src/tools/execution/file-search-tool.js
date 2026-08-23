/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path, PATH_CAPABILITIES, TOOL_PATH_CONTRACTS } from "@noobot/path-resolver";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  projectToolPathRef,
  resolveAuthorizedUserWorkspaceFilePath,
} from "../core/check-tool-input.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { registerResource } from "../core/resource-broker.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME } from "../constants/index.js";
import {
  DEFAULT_MAX_SEARCH_FILES,
  DEFAULT_SEARCH_CONTEXT_LINES,
  DEFAULT_SEARCH_MAX_RESULTS,
  toPositiveInt,
} from "./file-utils.js";
import {
  collectSearchFiles,
  hasRipgrep,
  searchFilesWithRipgrep,
  searchInText,
} from "./file-search.js";
import {
  SECURITY_EVIDENCE_SOURCE,
  classifyResourceRisk,
} from "@noobot/security-assessment-protocol";
import { confirmToolOperation, createRiskLevelSchema } from "./tool-risk.js";
import { buildFileToolDescription } from "./file-tool-shared.js";

function buildSearchSchema(agentContext) {
  return z.object({
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
  });
}

async function searchTextSource({
  runtime,
  query,
  text,
  isRegex,
  caseSensitive,
  contextLines,
  maxResults,
  riskLevel,
}) {
  await confirmToolOperation({
    runtime,
    declaredRiskLevel: riskLevel,
    serverEvidence: {
      source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
      riskLevel: classifyResourceRisk({ operation: "search", scope: "workspace" }),
    },
    toolName: TOOL_NAME.SEARCH,
    operation: "search provided text",
    reason: "The model-declared risk and server-classified risk are combined at the highest level.",
  });
  const result = searchInText({
    text: String(text || ""),
    query,
    isRegex,
    caseSensitive,
    contextLines,
    maxResults,
  });
  return toToolJsonResult(TOOL_NAME.SEARCH, {
    ok: true,
    source: "text",
    query,
    resources: [],
    ...result,
  });
}

async function collectFallbackMatches({
  rootPath,
  workspacePath,
  glob,
  query,
  isRegex,
  caseSensitive,
  contextLines,
  maxCount,
  abortSignal,
  workspaceIo,
}) {
  const files = await collectSearchFiles({
    rootPath,
    workspacePath,
    glob,
    maxFiles: DEFAULT_MAX_SEARCH_FILES,
    abortSignal,
  });
  const matches = [];
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
      query,
      isRegex,
      caseSensitive,
      contextLines,
      maxResults: maxCount - matches.length,
      filePath: file.relativePath,
    });
    matches.push(...result.matches);
  }
  return { matches, truncated: matches.length >= maxCount };
}

async function resolveSearchMatches({ matches, mountedSearch, searchPathRef, agentContext }) {
  const resolvedMatches = await Promise.all(
    matches.map(async (match) => {
      const relativeMatchPath = String(match?.filePath || "").trim();
      const matchedPath = mountedSearch
        ? path.join(searchPathRef.path, relativeMatchPath)
        : relativeMatchPath;
      if (!matchedPath) return { match, resolution: null };
      const resolution = await resolveAuthorizedUserWorkspaceFilePath({
        filePath: matchedPath,
        agentContext,
        fieldName: "match.filePath",
        mustExist: true,
        capability: PATH_CAPABILITIES.FILE_READ,
      });
      return { match, resolution };
    }),
  );
  const publicMatches = resolvedMatches.map(({ match, resolution }) => {
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
  return { matches: publicMatches, resources };
}

async function searchFilesSource({
  agentContext,
  runtime,
  workspaceIo,
  abortSignal,
  inputPath,
  query,
  isRegex,
  caseSensitive,
  glob,
  contextLines,
  maxResults,
  riskLevel,
}) {
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
  let result = null;
  if (await hasRipgrep()) {
    try {
      result = await searchFilesWithRipgrep({
        rootPath: searchRoot,
        workspacePath: searchProjectionRoot,
        query,
        isRegex,
        caseSensitive,
        glob,
        contextLines,
        maxResults: maxCount,
        abortSignal,
      });
    } catch {
      result = null;
    }
  }
  result ||= await collectFallbackMatches({
    rootPath: searchRoot,
    workspacePath: searchProjectionRoot,
    glob,
    query,
    isRegex,
    caseSensitive,
    contextLines,
    maxCount,
    abortSignal,
    workspaceIo,
  });
  const resolved = await resolveSearchMatches({
    matches: result.matches || [],
    mountedSearch,
    searchPathRef,
    agentContext,
  });
  return toToolJsonResult(TOOL_NAME.SEARCH, {
    ok: true,
    source: "files",
    query,
    path: projectToolPathRef(searchPathRef),
    glob: String(glob || ""),
    ...resolved,
    truncated: result.truncated === true,
  });
}

async function runSearch({ agentContext, runtime, workspaceIo, args }) {
  const {
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
  } = args;
  const normalizedSource = String(source || "files").trim() === "text" ? "text" : "files";
  const normalizedQuery = String(query || "");
  if (!normalizedQuery) {
    return toToolJsonResult(TOOL_NAME.SEARCH, {
      ok: false,
      message: tTool(agentContext, "tools.search.queryRequired"),
    });
  }
  if (normalizedSource === "text") {
    return searchTextSource({
      runtime,
      query: normalizedQuery,
      text,
      isRegex,
      caseSensitive,
      contextLines,
      maxResults,
      riskLevel,
    });
  }
  return searchFilesSource({
    agentContext,
    runtime,
    workspaceIo,
    abortSignal: runtime?.abortSignal || null,
    inputPath,
    query: normalizedQuery,
    isRegex,
    caseSensitive,
    glob,
    contextLines,
    maxResults,
    riskLevel,
  });
}

export function createSearchTool({ agentContext, runtime, workspaceIo }) {
  return new DynamicStructuredTool({
    name: TOOL_NAME.SEARCH,
    metadata: { pathContract: TOOL_PATH_CONTRACTS.fileSearch },
    description: buildFileToolDescription(agentContext, "tools.search.description"),
    schema: buildSearchSchema(agentContext),
    func: (args) => runSearch({ agentContext, runtime, workspaceIo, args }),
  });
}
