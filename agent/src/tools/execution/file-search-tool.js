/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  filePath as path,
  PATH_CAPABILITIES,
  PATH_ENTRY_KIND,
  TOOL_PATH_CONTRACTS,
} from "@noobot/path-resolver";
import { tool as structuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  projectToolPathRef,
  resolveAuthorizedUserWorkspaceFilePath,
} from "../core/check-tool-input.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { registerResource } from "../core/resource-broker.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME } from "../constants/index.js";
import {
  DEFAULT_SEARCH_CONTEXT_LINES,
  DEFAULT_SEARCH_MAX_RESULTS,
  SEARCH_CONTEXT_LINES_LIMIT,
  SEARCH_MAX_RESULTS_LIMIT,
} from "./file-utils.js";
import { searchFilesWithRipgrep, searchInText } from "./file-search.js";
import {
  RESOURCE_OPERATION,
  RESOURCE_SCOPE,
  SECURITY_EVIDENCE_SOURCE,
  classifyResourceRisk,
} from "@noobot/security-assessment-protocol";
import { confirmToolOperation, createRiskLevelSchema } from "./tool-risk.js";
import { buildFileToolDescription, resolveFileResourceRiskScope } from "./file-tool-shared.js";

function buildSearchSchema(runtime) {
  return z.object({
    source: z
      .enum(["files", "text"])
      .optional()
      .default("files")
      .describe(tTool(runtime, "tools.search.fieldSource")),
    query: z.string().min(1).describe(tTool(runtime, "tools.search.fieldQuery")),
    isRegex: z
      .boolean()
      .optional()
      .default(false)
      .describe(tTool(runtime, "tools.search.fieldIsRegex")),
    caseSensitive: z
      .boolean()
      .optional()
      .default(false)
      .describe(tTool(runtime, "tools.search.fieldCaseSensitive")),
    path: z.string().optional().default(".").describe(tTool(runtime, "tools.search.fieldPath")),
    glob: z.string().optional().default("").describe(tTool(runtime, "tools.search.fieldGlob")),
    text: z.string().optional().describe(tTool(runtime, "tools.search.fieldText")),
    contextLines: z
      .number()
      .int()
      .min(0)
      .max(SEARCH_CONTEXT_LINES_LIMIT)
      .optional()
      .default(DEFAULT_SEARCH_CONTEXT_LINES)
      .describe(tTool(runtime, "tools.search.fieldContextLines")),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(SEARCH_MAX_RESULTS_LIMIT)
      .optional()
      .default(DEFAULT_SEARCH_MAX_RESULTS)
      .describe(tTool(runtime, "tools.search.fieldMaxResults")),
    riskLevel: createRiskLevelSchema(runtime, "tools.search.fieldRiskLevel"),
  });
}

async function searchTextSource({
  agentContext,
  runtime,
  query,
  text: inputText,
  isRegex,
  caseSensitive,
  contextLines,
  maxResults,
  riskLevel,
}) {
  await confirmToolOperation({
    agentContext,
    runtime,
    declaredRiskLevel: riskLevel,
    serverEvidence: {
      source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
      riskLevel: classifyResourceRisk({
        operation: RESOURCE_OPERATION.SEARCH,
        scope: RESOURCE_SCOPE.WORKSPACE,
      }),
    },
    toolName: TOOL_NAME.SEARCH,
    operation: "search provided text",
    reason: "The model-declared risk and server-classified risk are combined at the highest level.",
  });
  const result = searchInText({
    text: inputText,
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

function logicalSearchPath(pathRef) {
  return pathRef.view === "mount" ? path.join(pathRef.mount, pathRef.path) : pathRef.path;
}

function resolveSearchScope(searchResolution, runtime) {
  const { entryKind, executionPath, pathRef } = searchResolution;
  const logicalPath = logicalSearchPath(pathRef);
  if (entryKind === PATH_ENTRY_KIND.DIRECTORY) {
    return { rootPath: executionPath, target: ".", logicalBase: logicalPath };
  }
  if (entryKind === PATH_ENTRY_KIND.FILE) {
    return {
      rootPath: path.dirname(executionPath),
      target: path.basename(executionPath),
      logicalBase: path.dirname(logicalPath),
    };
  }
  throw recoverableToolError(tTool(runtime, "tools.search.pathKindUnsupported"), {
    code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
    details: { field: "path", entryKind },
  });
}

async function resolveSearchMatches({ matches, scope, searchPathRef, agentContext }) {
  const resolvedMatches = await Promise.all(
    matches.map(async (match) => {
      const matchedPath =
        searchPathRef.view === "host"
          ? path.resolve(scope.rootPath, match.filePath)
          : path.join(scope.logicalBase, match.filePath);
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
    return { ...publicMatch, path: projectToolPathRef(resolution.pathRef) };
  });
  const resources = await Promise.all(
    resolvedMatches.map(({ resolution }) =>
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
    filePath: inputPath,
    agentContext,
    fieldName: "path",
    mustExist: true,
    capability: PATH_CAPABILITIES.FILE_SEARCH,
  });
  const scope = resolveSearchScope(searchResolution, runtime);
  const searchResourcePath = searchResolution.resourcePath;
  const searchPathRef = searchResolution.pathRef;
  await confirmToolOperation({
    agentContext,
    runtime,
    declaredRiskLevel: riskLevel,
    serverEvidence: {
      source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
      riskLevel: classifyResourceRisk({
        operation: RESOURCE_OPERATION.SEARCH,
        scope: resolveFileResourceRiskScope({
          pathRef: searchPathRef,
          resourcePath: searchResourcePath,
          runtime,
        }),
      }),
    },
    toolName: TOOL_NAME.SEARCH,
    operation: "search local files",
    target: projectToolPathRef(searchPathRef),
    reason: "The final normalized resource requires confirmation under the server path policy.",
  });

  const result = await searchFilesWithRipgrep({
    rootPath: scope.rootPath,
    target: scope.target,
    query,
    isRegex,
    caseSensitive,
    glob,
    contextLines,
    maxResults,
    abortSignal,
  });
  const resolved = await resolveSearchMatches({
    matches: result.matches,
    scope,
    searchPathRef,
    agentContext,
  });
  return toToolJsonResult(TOOL_NAME.SEARCH, {
    ok: true,
    source: "files",
    query,
    path: projectToolPathRef(searchPathRef),
    glob,
    ...resolved,
    truncated: result.truncated,
  });
}

async function runSearch({ agentContext, runtime, args, abortSignal }) {
  const {
    source,
    query,
    isRegex,
    caseSensitive,
    path: inputPath,
    glob,
    text: inputText,
    contextLines,
    maxResults,
    riskLevel,
  } = args;
  if (source === "text") {
    if (!inputText) {
      throw recoverableToolError(tTool(runtime, "tools.search.textRequired"), {
        code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
        details: { field: "text" },
      });
    }
    return searchTextSource({
      agentContext,
      runtime,
      query,
      text: inputText,
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
    abortSignal,
    inputPath,
    query,
    isRegex,
    caseSensitive,
    glob,
    contextLines,
    maxResults,
    riskLevel,
  });
}

export function createSearchTool({ agentContext, runtime }) {
  return structuredTool(
    (args, toolConfig) =>
      runSearch({ agentContext, runtime, args, abortSignal: toolConfig.signal }),
    {
      name: TOOL_NAME.SEARCH,
      metadata: { pathContract: TOOL_PATH_CONTRACTS.fileSearch },
      description: buildFileToolDescription(runtime, "tools.search.description"),
      schema: buildSearchSchema(runtime),
    },
  );
}
