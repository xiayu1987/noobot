/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PATH_CAPABILITIES, TOOL_PATH_CONTRACTS } from "@noobot/path-resolver";
import { DynamicStructuredTool } from "@langchain/core/tools";
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
  formatLinesWithNumbers,
  splitLines,
  toPositiveInt,
} from "./file-utils.js";
import {
  SECURITY_EVIDENCE_SOURCE,
  classifyResourceRisk,
} from "@noobot/security-assessment-protocol";
import { confirmToolOperation, createRiskLevelSchema } from "./tool-risk.js";
import { buildFileToolDescription, resourceFileName } from "./file-tool-shared.js";

export function createReadFileTool({ agentContext, runtime, workspaceIo }) {
  return new DynamicStructuredTool({
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
}
