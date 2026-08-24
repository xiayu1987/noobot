/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import {
  assertConnectorAccessPort,
  normalizeSelectedConnectorIds,
} from "@noobot/connector-protocol";
import { z } from "zod";
import { mergeConfig } from "../../config/index.js";
import { mapAttachmentRecordsToMetas } from "../../artifacts/meta-ops.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { MIME_TYPE } from "../../shared/constants/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tToolDescription, tToolParamDescription } from "../core/tool-schema-i18n.js";
import {
  ARTIFACT_GENERATION_SOURCE,
  TOOL_ATTACHMENT_SOURCE,
  TOOL_NAME,
  TOOL_RESULT_STATUS,
} from "../constants/index.js";

function assertSelectedConnector(selectedConnectorIds = [], connectorId = "") {
  const normalizedId = String(connectorId || "").trim();
  if (!normalizedId || !selectedConnectorIds.includes(normalizedId)) {
    throw recoverableToolError("connector_id is not selected for this session", {
      code: ERROR_CODE.RECOVERABLE_SELECTED_CONNECTOR_MISMATCH,
    });
  }
  return normalizedId;
}

function createArtifactSink(runtime = {}) {
  const userId = String(runtime?.userId || "").trim();
  const sessionId = String(runtime?.systemRuntime?.sessionId || "").trim();
  const attachmentService = runtime?.attachmentService || null;
  if (!userId || !sessionId || !attachmentService) return null;
  return async (artifacts = [], options = {}) => {
    if (!Array.isArray(artifacts) || !artifacts.length) return [];
    const generationSource = String(
      options.generationSource || ARTIFACT_GENERATION_SOURCE.EMAIL_CONNECTOR_READ,
    ).trim();
    const records = await attachmentService.ingestGeneratedArtifacts({
      userId,
      sessionId,
      attachmentSource: TOOL_ATTACHMENT_SOURCE.EMAIL,
      generationSource,
      artifacts,
    });
    return {
      attachments: mapAttachmentRecordsToMetas(records, {
        fallbackMimeType: MIME_TYPE.APPLICATION_OCTET_STREAM,
        fallbackGenerationSource: generationSource,
      }),
      transferEnvelopes: [],
    };
  };
}

export function createConnectorAccessTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const effectiveConfig = mergeConfig(runtime?.globalConfig || {}, runtime?.userConfig || {});
  if (effectiveConfig?.tools?.[TOOL_NAME.ACCESS_CONNECTOR]?.enabled === false) return [];
  const userId = String(runtime?.userId || agentContext?.userId || "").trim();
  const selectedConnectorIds = normalizeSelectedConnectorIds(
    runtime?.systemRuntime?.config?.selectedConnectorIds,
  );
  const tool = new DynamicStructuredTool({
    name: TOOL_NAME.ACCESS_CONNECTOR,
    description: tToolDescription(runtime, TOOL_NAME.ACCESS_CONNECTOR),
    schema: z.object({
      connector_id: z
        .string()
        .describe(tToolParamDescription(runtime, TOOL_NAME.ACCESS_CONNECTOR, "connector_id")),
      operation: z
        .string()
        .describe(tToolParamDescription(runtime, TOOL_NAME.ACCESS_CONNECTOR, "operation")),
      input: z
        .record(z.string(), z.unknown())
        .describe(tToolParamDescription(runtime, TOOL_NAME.ACCESS_CONNECTOR, "input")),
    }),
    func: async ({ connector_id, operation, input }) => {
      const connectorId = assertSelectedConnector(selectedConnectorIds, connector_id);
      if (!userId) {
        throw recoverableToolError("connector owner userId is unavailable", {
          code: ERROR_CODE.RECOVERABLE_RUNTIME_CONTEXT_MISSING,
        });
      }
      const connectorAccessPort = runtime?.sharedTools?.connectorAccess;
      if (!connectorAccessPort) {
        throw recoverableToolError("connector access port is unavailable", {
          code: ERROR_CODE.RECOVERABLE_CONNECTOR_STORE_MISSING,
        });
      }
      try {
        const result = await assertConnectorAccessPort(connectorAccessPort).access({
          userId,
          request: { connectorId, operation, input },
          context: {
            artifactSink: createArtifactSink(runtime),
            sessionId: String(runtime?.systemRuntime?.sessionId || "").trim(),
          },
        });
        return toToolJsonResult(
          TOOL_NAME.ACCESS_CONNECTOR,
          {
            ...result,
            status: result.ok ? TOOL_RESULT_STATUS.COMPLETED : TOOL_RESULT_STATUS.FAILED,
          },
          true,
        );
      } catch (error) {
        throw recoverableToolError(error?.message || String(error), {
          code: String(error?.code || ERROR_CODE.RECOVERABLE_PROCESS_CONNECTOR_FAILED),
        });
      }
    },
  });
  return [tool];
}
