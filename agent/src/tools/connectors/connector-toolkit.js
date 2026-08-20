/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { normalizeSelectedConnectorIds, projectPublicConnector } from "@noobot/connector-protocol";
import { z } from "zod";
import { recoverableToolError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tToolDescription, tToolParamDescription } from "../core/tool-schema-i18n.js";
import { TOOL_NAME, TOOL_RESULT_STATUS } from "../constants/index.js";
import { buildAccessConnectorTool } from "./connector-toolkit/tool-access-connector.js";

function createConnectorToolContext(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  return {
    agentContext,
    runtime,
    userId: String(runtime?.userId || agentContext?.userId || "").trim(),
    selectedConnectorIds: normalizeSelectedConnectorIds(
      runtime?.systemRuntime?.config?.selectedConnectorIds,
    ),
    channelStore: runtime?.sharedTools?.connectorChannelStore || null,
    registry: runtime?.sharedTools?.connectorRegistry || null,
  };
}

function assertConnectorRuntime(context = {}) {
  if (!context.userId || !context.channelStore || !context.registry) {
    throw recoverableToolError("connector runtime is unavailable", {
      code: ERROR_CODE.RECOVERABLE_CONNECTOR_STORE_MISSING,
    });
  }
}

function createConnectorTools({ agentContext } = {}) {
  const context = createConnectorToolContext(agentContext);
  const accessDescriptor = buildAccessConnectorTool(context);
  const accessConnectorTool = new DynamicStructuredTool({
    name: TOOL_NAME.ACCESS_CONNECTOR,
    description: tToolDescription(context.runtime, TOOL_NAME.ACCESS_CONNECTOR),
    schema: z.object({
      connector_id: z
        .string()
        .describe(
          tToolParamDescription(context.runtime, TOOL_NAME.ACCESS_CONNECTOR, "connector_id"),
        ),
      command: z
        .string()
        .optional()
        .describe(tToolParamDescription(context.runtime, TOOL_NAME.ACCESS_CONNECTOR, "command")),
      command_file_path: z
        .string()
        .optional()
        .describe(
          tToolParamDescription(context.runtime, TOOL_NAME.ACCESS_CONNECTOR, "command_file_path"),
        ),
    }),
    func: accessDescriptor.func,
  });

  const inspectConnectorsTool = new DynamicStructuredTool({
    name: TOOL_NAME.INSPECT_CONNECTORS,
    description: tToolDescription(context.runtime, TOOL_NAME.INSPECT_CONNECTORS),
    schema: z.object({}),
    func: async () => {
      assertConnectorRuntime(context);
      const selected = new Set(context.selectedConnectorIds);
      const records = (await context.registry.list(context.userId)).filter((item) =>
        selected.has(item.connectorId),
      );
      const runtimeById = new Map(
        context.channelStore
          .getUserConnectors(context.userId)
          .map((item) => [String(item.connectorId || "").trim(), item]),
      );
      const connectors = records.map((record) =>
        projectPublicConnector(record, runtimeById.get(record.connectorId)),
      );
      return toToolJsonResult(
        TOOL_NAME.INSPECT_CONNECTORS,
        {
          ok: true,
          status: TOOL_RESULT_STATUS.COMPLETED,
          connectors,
          summary: {
            selected_count: context.selectedConnectorIds.length,
            connected_count: connectors.filter((item) => item.status === "connected").length,
          },
        },
        true,
      );
    },
  });

  return [accessConnectorTool, inspectConnectorsTool];
}

export { createConnectorTools };
