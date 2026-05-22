/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  normalizeDatabaseType,
  normalizeTerminalType,
  normalizeConnectorType,
} from "../../config/index.js";
import { recoverableToolError } from "../../error/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tToolDescription } from "../core/tool-schema-i18n.js";
import { tTool } from "../core/tool-i18n.js";
import {
  pickObject,
  parseOptionalObjectInput,
  databaseFields,
  terminalFields,
  emailFields,
  attachDefaultValuesToFields,
  collectNonSensitiveDefaults,
  normalizeProvidedDatabaseDefaults,
  normalizeProvidedTerminalDefaults,
  normalizeProvidedEmailDefaults,
  getMissingFieldNames,
  alignFieldsWithConnectionInfo,
} from "./connector-toolkit/connector-fields.js";
import {
  mergeConnectionInfo,
  resolveConfiguredConnectorInfo,
} from "./connector-toolkit/connector-resolver.js";
import {
  tConnector,
  maskConnectionInfo,
  addRuntimeConnectorChannel,
  findConnectedConnector,
  isUserCancelledInteraction,
  buildAlreadyConnectedResponse,
  buildConnectionStatusPayload,
  buildRuntimeConnectorStatus,
  upsertRuntimeSelectedConnector,
} from "./connector-toolkit/connector-runtime.js";
import {
  createConnectorToolContext,
  resolveRememberedConnectorInfo,
  resolveRuntimeLocale,
} from "./connector-toolkit/connector-context.js";
import { buildAccessConnectorTool } from "./connector-toolkit/tool-access-connector.js";
import { createDatabaseConnectorTools } from "./connector-toolkit/tool-connect-database.js";
import { createTerminalConnectorTools } from "./connector-toolkit/tool-connect-terminal.js";
import { createEmailConnectorTools } from "./connector-toolkit/tool-connect-email.js";
import { ERROR_CODE } from "../../error/constants.js";
import { TOOL_NAME, TOOL_RESULT_STATUS } from "../constants/index.js";

function createConnectorTools({ agentContext } = {}) {
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
      command: z.string().optional().describe(
        accessConnectorDescriptor.schemaShape.command.description,
      ),
      command_file_path: z.string().optional().describe(
        accessConnectorDescriptor.schemaShape.command_file_path.description,
      ),
    }),
    func: accessConnectorDescriptor.func,
  });

  const inspectConnectorsTool = new DynamicStructuredTool({
    name: TOOL_NAME.INSPECT_CONNECTORS,
    description: tToolDescription(runtime, TOOL_NAME.INSPECT_CONNECTORS),
    schema: z.object({}),
    func: async () => {
      if (!store || typeof store.inspectSessionConnectors !== "function") {
        throw recoverableToolError(tTool(runtime, "connectors.storeMissing"), {
          code: ERROR_CODE.RECOVERABLE_CONNECTOR_STORE_MISSING,
        });
      }
      if (!rootSessionId) {
        throw recoverableToolError(tTool(runtime, "connectors.rootSessionMissing"), {
          code: ERROR_CODE.RECOVERABLE_ROOT_SESSION_MISSING,
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
            code: ERROR_CODE.RECOVERABLE_NO_CONNECTORS_FOUND,
            details: {
              status: TOOL_RESULT_STATUS.NO_CONNECTORS,
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
        TOOL_NAME.INSPECT_CONNECTORS,
        {
          ok: true,
          status: TOOL_RESULT_STATUS.COMPLETED,
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

export {
  createConnectorTools,
  pickObject,
  parseOptionalObjectInput,
  normalizeDatabaseType,
  normalizeTerminalType,
  normalizeConnectorType,
  databaseFields,
  terminalFields,
  emailFields,
  attachDefaultValuesToFields,
  collectNonSensitiveDefaults,
  normalizeProvidedDatabaseDefaults,
  normalizeProvidedTerminalDefaults,
  normalizeProvidedEmailDefaults,
  mergeConnectionInfo,
  getMissingFieldNames,
  resolveConfiguredConnectorInfo,
  alignFieldsWithConnectionInfo,
  maskConnectionInfo,
  addRuntimeConnectorChannel,
  findConnectedConnector,
  isUserCancelledInteraction,
  buildAlreadyConnectedResponse,
  buildConnectionStatusPayload,
  buildRuntimeConnectorStatus,
  createConnectorToolContext,
  resolveRememberedConnectorInfo,
  buildAccessConnectorTool,
  upsertRuntimeSelectedConnector,
  resolveRuntimeLocale,
  tConnector,
};
