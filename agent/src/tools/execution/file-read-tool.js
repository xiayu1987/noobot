/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PATH_CAPABILITIES, TOOL_PATH_CONTRACTS } from "@noobot/path-resolver";
import { tool as structuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { assertValidFileNameFromPath, projectToolPathRef } from "../core/check-tool-input.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { registerResource } from "../core/resource-broker.js";
import { createFileSourceSchema, resolveFileInput } from "../core/file-input.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME } from "../constants/index.js";
import {
  DEFAULT_READ_MAX_LINES,
  READ_MAX_LINES_LIMIT,
  formatLinesWithNumbers,
  splitLines,
} from "./file-utils.js";
import {
  RESOURCE_OPERATION,
  SECURITY_EVIDENCE_SOURCE,
  classifyResourceRisk,
} from "@noobot/security-assessment-protocol";
import { confirmToolOperation, createRiskLevelSchema } from "./tool-risk.js";
import {
  buildFileToolDescription,
  resolveFileResourceRiskScope,
  resourceFileName,
} from "./file-tool-shared.js";

export function createReadFileTool({ agentContext, runtime, workspaceIo }) {
  return structuredTool(
    async ({ filePath, startLine, endLine, includeLineNumbers, maxLines, riskLevel }) => {
      if (typeof filePath === "string")
        assertValidFileNameFromPath({ filePath, fieldName: "filePath", agentContext });
      const resolvedInput = await resolveFileInput({
        source: filePath,
        agentContext,
        fieldName: "filePath",
        mustExist: true,
        capability: PATH_CAPABILITIES.FILE_READ,
      });
      const resolvedPath = resolvedInput.executionPath;
      const resourcePath = resolvedInput.resourcePath;
      const pathRef = resolvedInput.pathRef;
      await confirmToolOperation({
        agentContext,
        runtime,
        declaredRiskLevel: riskLevel,
        serverEvidence: {
          source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
          riskLevel: classifyResourceRisk({
            operation: RESOURCE_OPERATION.READ,
            scope: resolveFileResourceRiskScope({
              pathRef,
              resourcePath,
              runtime,
            }),
          }),
        },
        toolName: TOOL_NAME.READ_FILE,
        operation: "read file",
        target: projectToolPathRef(pathRef),
        reason: "The final normalized resource requires confirmation under the server path policy.",
      });
      const targetStat = await workspaceIo.stat(resolvedPath);
      if (targetStat?.isDirectory?.()) {
        throw recoverableToolError(tTool(runtime, "common.pathIsNotFile"), {
          code: ERROR_CODE.RECOVERABLE_PATH_NOT_FILE,
          details: { field: "filePath", path: projectToolPathRef(pathRef) },
        });
      }
      const rawContent = await workspaceIo.readText(resolvedPath);
      const allLines = splitLines(rawContent);
      if (rawContent.endsWith("\n")) allLines.pop();
      const totalLines = allLines.length;
      const requestedEnd = endLine ?? totalLines;
      const rangeError =
        startLine > Math.max(1, totalLines)
          ? { field: "startLine", reason: "start_line_after_eof" }
          : requestedEnd < startLine
            ? { field: "endLine", reason: "end_line_before_start_line" }
            : null;
      if (rangeError) {
        throw recoverableToolError(
          tTool(runtime, "tools.file.readLineRangeOutOfBounds", {
            startLine,
            endLine,
            totalLines,
          }),
          {
            code: ERROR_CODE.RECOVERABLE_LINE_RANGE_OUT_OF_BOUNDS,
            details: {
              ...rangeError,
              requestedStartLine: startLine,
              ...(endLine === undefined ? {} : { requestedEndLine: endLine }),
              totalLines,
            },
          },
        );
      }
      const end = Math.min(requestedEnd, startLine + maxLines - 1, totalLines);
      const selectedLines = allLines.slice(startLine - 1, end);
      const content = includeLineNumbers
        ? formatLinesWithNumbers(selectedLines, startLine)
        : selectedLines.join("\n");
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
        startLine,
        endLine: end,
        totalLines,
        includeLineNumbers,
        hasMore: end < totalLines,
        content,
      });
    },
    {
      name: TOOL_NAME.READ_FILE,
      metadata: { pathContract: TOOL_PATH_CONTRACTS.fileRead },
      description: buildFileToolDescription(runtime, "tools.file.readDescription"),
      schema: z.object({
        filePath: createFileSourceSchema({
          filePathDescription: tTool(runtime, "tools.file.readFilePathField"),
        }),
        startLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(1)
          .describe(tTool(runtime, "tools.file.readStartLineField")),
        endLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(tTool(runtime, "tools.file.readEndLineField")),
        includeLineNumbers: z
          .boolean()
          .optional()
          .default(true)
          .describe(tTool(runtime, "tools.file.readIncludeLineNumbersField")),
        maxLines: z
          .number()
          .int()
          .min(1)
          .max(READ_MAX_LINES_LIMIT)
          .optional()
          .default(DEFAULT_READ_MAX_LINES)
          .describe(tTool(runtime, "tools.file.readMaxLinesField")),
        riskLevel: createRiskLevelSchema(runtime, "tools.file.readRiskLevelField"),
      }),
    },
  );
}
