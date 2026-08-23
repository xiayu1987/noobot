/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path, PATH_CAPABILITIES, TOOL_PATH_CONTRACTS } from "@noobot/path-resolver";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { assertValidFileNameFromPath, projectToolPathRef } from "../core/check-tool-input.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { registerResource } from "../core/resource-broker.js";
import { createFileSourceSchema, resolveFileInput } from "../core/file-input.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME, TOOL_RESULT_STATE } from "../constants/index.js";
import {
  SECURITY_EVIDENCE_SOURCE,
  classifyResourceRisk,
} from "@noobot/security-assessment-protocol";
import { confirmToolOperation, createRiskLevelSchema } from "./tool-risk.js";
import { applyFileMutation } from "./file-mutation-service.js";
import {
  buildFileToolDescription,
  mutationLogicalPath,
  resolveRuntimeFileMutationRoot,
  resourceFileName,
} from "./file-tool-shared.js";

export function createWriteFileTool({ agentContext, runtime, workspaceIo }) {
  return new DynamicStructuredTool({
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
      const mutation = await applyFileMutation({
        filePath: resolvedPath,
        logicalPath: mutationLogicalPath(pathRef),
        content,
        operation: "replace",
        mutationRoot: resolveRuntimeFileMutationRoot(runtime),
        sessionScope: runtime?.systemRuntime?.persistenceScope || null,
        writeText: (target, value) => workspaceIo.writeText(target, value),
      });
      const resource = await registerResource({
        agentContext,
        executionPath: resolvedPath,
        logicalPathRef: pathRef,
        capabilities: { read: true, write: true, scriptInput: true },
      });
      return toToolJsonResult(TOOL_NAME.WRITE_FILE, {
        ...mutation,
        state: TOOL_RESULT_STATE.OK,
        path: projectToolPathRef(pathRef),
        fileName: resourceFileName(resource),
        resources: [resource],
      });
    },
  });
}
