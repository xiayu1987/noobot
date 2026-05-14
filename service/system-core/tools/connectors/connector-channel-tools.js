/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { recoverableToolError } from "../../error/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tToolDescription } from "../core/tool-schema-i18n.js";
import { tTool } from "../core/tool-i18n.js";
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
    description: tToolDescription(runtime, "inspect_connectors"),
    schema: z.object({}),
    func: async () => {
      if (!store || typeof store.inspectSessionConnectors !== "function") {
        throw recoverableToolError(tTool(runtime, "connectors.storeMissing"), {
          code: "RECOVERABLE_CONNECTOR_STORE_MISSING",
        });
      }
      if (!rootSessionId) {
        throw recoverableToolError(tTool(runtime, "connectors.rootSessionMissing"), {
          code: "RECOVERABLE_ROOT_SESSION_MISSING",
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
        throw recoverableToolError(noConnectorMessage, {
          code: "RECOVERABLE_NO_CONNECTORS_FOUND",
          details: {
            status: "no_connectors",
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
        });
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
