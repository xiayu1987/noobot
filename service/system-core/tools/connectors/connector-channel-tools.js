/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { toToolJsonResult } from "../tool-json-result.js";
import {
  buildAccessConnectorTool,
  createConnectorToolContext,
  tConnector,
} from "./connector-toolkit.js";
import { createDatabaseConnectorTools } from "./database-connector-tools.js";
import { createTerminalConnectorTools } from "./terminal-connector-tools.js";
import { createEmailConnectorTools } from "./email-connector-tools.js";

export function createConnectorChannelTools({ agentContext }) {
  const connectorToolContext = createConnectorToolContext(agentContext);
  const {
    store,
    rootSessionId,
    runtime,
    connectorEventListener,
  } = connectorToolContext;

  const accessConnectorDescriptor = buildAccessConnectorTool(connectorToolContext);
  const accessConnectorTool = new DynamicStructuredTool({
    name: accessConnectorDescriptor.name,
    description: accessConnectorDescriptor.description,
    schema: z.object({
      connector_name: z.string().optional().describe(
        accessConnectorDescriptor.schemaShape.connector_name.description,
      ),
      connector_type: z.string().describe(
        accessConnectorDescriptor.schemaShape.connector_type.description,
      ),
      command: z.string().describe(
        accessConnectorDescriptor.schemaShape.command.description,
      ),
    }),
    func: accessConnectorDescriptor.func,
  });

  const inspectConnectorsTool = new DynamicStructuredTool({
    name: "inspect_connectors",
    description: "查看当前 session 的全部连接器（仅返回脱敏后的连接信息）。",
    schema: z.object({}),
    func: async () => {
      if (!store || typeof store.inspectSessionConnectors !== "function") {
        return toToolJsonResult("inspect_connectors", {
          ok: false,
          error: "connector channel store missing",
        });
      }
      if (!rootSessionId) {
        return toToolJsonResult("inspect_connectors", {
          ok: false,
          error: "rootSessionId missing in systemRuntime",
        });
      }
      const inspected = await store.inspectSessionConnectors({
        sessionId: rootSessionId,
        timeoutMs: 8000,
      });
      const databases = Array.isArray(inspected?.connectors?.databases)
        ? inspected.connectors.databases
        : [];
      const terminals = Array.isArray(inspected?.connectors?.terminals)
        ? inspected.connectors.terminals
        : [];
      const emails = Array.isArray(inspected?.connectors?.emails)
        ? inspected.connectors.emails
        : [];
      const totalCount = Number(
        inspected?.summary?.total_count ??
          databases.length + terminals.length + emails.length,
      );
      runtime.connectorChannels = store.getSessionConnectors(rootSessionId);
      if (
        connectorEventListener &&
        typeof connectorEventListener.syncRuntimeConnectorChannels === "function"
      ) {
        connectorEventListener.syncRuntimeConnectorChannels();
      }
      if (totalCount <= 0) {
        const noConnectorMessage = tConnector(runtime, "noConnectorsFound");
        return toToolJsonResult(
          "inspect_connectors",
          {
            ok: false,
            status: "no_connectors",
            error: noConnectorMessage,
            message: noConnectorMessage,
            connectors: {
              databases,
              terminals,
              emails,
            },
            summary: {
              database_count: 0,
              terminal_count: 0,
              email_count: 0,
              total_count: 0,
            },
          },
          true,
        );
      }
      return toToolJsonResult(
        "inspect_connectors",
        {
          ok: true,
          status: "completed",
          connectors: {
            databases,
            terminals,
            emails,
          },
          summary: {
            database_count: databases.length,
            terminal_count: terminals.length,
            email_count: emails.length,
            total_count: totalCount,
          },
        },
        true,
      );
    },
  });

  return [
    ...createDatabaseConnectorTools(connectorToolContext),
    ...createTerminalConnectorTools(connectorToolContext),
    ...createEmailConnectorTools(connectorToolContext),
    accessConnectorTool,
    inspectConnectorsTool,
  ];
}
