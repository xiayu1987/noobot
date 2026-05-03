/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { toToolJsonResult } from "../tool-json-result.js";
import {
  tToolDescription,
  tToolParamDescription,
} from "../tool-schema-i18n.js";
import {
  addRuntimeConnectorChannel,
  alignFieldsWithConnectionInfo,
  attachDefaultValuesToFields,
  buildAlreadyConnectedResponse,
  buildConnectionStatusPayload,
  buildRuntimeConnectorStatus,
  collectNonSensitiveDefaults,
  databaseFields,
  findConnectedConnector,
  getMissingFieldNames,
  isUserCancelledInteraction,
  maskConnectionInfo,
  mergeConnectionInfo,
  normalizeDatabaseType,
  normalizeProvidedDatabaseDefaults,
  resolveRememberedConnectorInfo,
  resolveConfiguredConnectorInfo,
  resolveRuntimeLocale,
  tConnector,
} from "./connector-toolkit.js";
import { tTool } from "../tool-i18n.js";

export function createDatabaseConnectorTools(context = {}) {
  const {
    runtime,
    store,
    historyStore,
    connectorEventListener,
    rootSessionId,
    allowUserInteraction,
    bridge,
    dialogProcessId,
    sessionId,
    effectiveConfig,
  } = context;

  const databaseConnectConnectorTool = new DynamicStructuredTool({
    name: "database_connect_connector",
    description: tToolDescription(runtime, "database_connect_connector"),
    schema: z.object({
      connector_name: z
        .string()
        .describe(
          tToolParamDescription(runtime, "database_connect_connector", "connector_name"),
        ),
      database_type: z
        .string()
        .describe(
          tToolParamDescription(runtime, "database_connect_connector", "database_type"),
        ),
      default_values: z
        .union([z.string(), z.object({}).passthrough()])
        .optional()
        .describe(
          tToolParamDescription(runtime, "database_connect_connector", "default_values"),
        ),
    }),
    func: async ({ connector_name, database_type, default_values }) => {
      const runtimeLocale = resolveRuntimeLocale(runtime);
      if (!store || typeof store.connectConnector !== "function") {
        return toToolJsonResult("database_connect_connector", {
          ok: false,
          error: tTool(runtime, "connectors.storeMissing"),
        });
      }
      if (!rootSessionId) {
        return toToolJsonResult("database_connect_connector", {
          ok: false,
          error: tTool(runtime, "connectors.rootSessionMissing"),
        });
      }
      const connectorName = String(connector_name || "").trim();
      const databaseType = normalizeDatabaseType(database_type);
      if (!connectorName) {
        return toToolJsonResult("database_connect_connector", {
          ok: false,
          error: tTool(runtime, "connectors.connectorNameRequired"),
        });
      }
      if (!databaseType) {
        return toToolJsonResult("database_connect_connector", {
          ok: false,
          error: tTool(runtime, "tools.database_connector.errorInvalidType"),
        });
      }
      const existingConnected = findConnectedConnector({
        store,
        rootSessionId,
        connectorName,
        connectorType: "database",
      });
      if (existingConnected) {
        connectorEventListener?.onConnectorAlreadyConnected?.({
          connectorType: "database",
          connectorName,
        });
        return buildAlreadyConnectedResponse(
          "database_connect_connector",
          existingConnected,
          runtime,
        );
      }

      let connectionInfo = resolveConfiguredConnectorInfo({
        effectiveConfig,
        connectorName,
        connectorType: "database",
      });
      const rememberedConnectionInfo = await resolveRememberedConnectorInfo({
        historyStore,
        userId: runtime?.userId || "",
        rootSessionId,
        connectorType: "database",
        connectorName,
      });
      const providedDefaults = normalizeProvidedDatabaseDefaults(default_values);
      connectionInfo = mergeConnectionInfo(connectionInfo, rememberedConnectionInfo);
      connectionInfo = mergeConnectionInfo(connectionInfo, providedDefaults);
      connectionInfo = mergeConnectionInfo(connectionInfo, {
        database_type: databaseType,
      });
      const baseFields = attachDefaultValuesToFields(
        alignFieldsWithConnectionInfo(
          databaseFields(databaseType, runtimeLocale),
          connectionInfo,
        ),
        connectionInfo,
      );
      const fields = [
        {
          name: "connector_name",
          displayName: tConnector(runtime, "connectorNameLabel"),
          required: false,
          default_value: connectorName,
          defaultValue: connectorName,
        },
        ...baseFields.filter(
          (fieldItem) => String(fieldItem?.name || "").trim() !== "connector_name",
        ),
      ];
      const missing = getMissingFieldNames(fields, connectionInfo);
      const needConnectionInfo = missing.length > 0;

      if (needConnectionInfo) {
        if (!allowUserInteraction) {
          return toToolJsonResult("database_connect_connector", {
            ok: false,
            error: tConnector(runtime, "missingConnectionInfoNoInteraction"),
          });
        }
        if (!bridge?.requestUserInteraction) {
          return toToolJsonResult("database_connect_connector", {
            ok: false,
            error: tTool(runtime, "tools.connectors.errorUserInteractionBridgeMissing"),
          });
        }
        const interactionResult = await bridge.requestUserInteraction({
          content: tConnector(runtime, "fillDatabaseConnectionInfo", {
            databaseType,
          }),
          fields,
          dialogProcessId,
          requireEncryption: true,
          sessionId,
          toolName: "database_connect_connector",
          needConnectionInfo: true,
          connectorName,
          connectorType: "database",
        });
        if (isUserCancelledInteraction(interactionResult)) {
          return toToolJsonResult("database_connect_connector", {
            ok: false,
            cancelled: true,
            error: tConnector(runtime, "userCancelledAction"),
          });
        }
        connectionInfo = mergeConnectionInfo(connectionInfo, interactionResult);
      }

      const connected = store.connectConnector({
        sessionId: rootSessionId,
        connectorName,
        connectorType: "database",
        connectionInfo,
      });
      const runtimeStatus = await buildRuntimeConnectorStatus({
        runtime,
        store,
        rootSessionId,
        connectorName,
        connectorType: "database",
      });
      const connectedSuccess = String(runtimeStatus?.status || "") === "connected";
      if (!connectedSuccess) {
        if (typeof store.disconnectConnector === "function") {
          store.disconnectConnector({
            sessionId: rootSessionId,
            connectorName,
            connectorType: "database",
          });
        }
        return toToolJsonResult(
          "database_connect_connector",
          buildConnectionStatusPayload({
            runtimeStatus,
            connector: connected,
            extra: {
              need_connection_info: needConnectionInfo,
              database_type: databaseType,
              connection_info_masked: maskConnectionInfo(connectionInfo),
              connection_defaults: collectNonSensitiveDefaults(connectionInfo),
            },
          }),
          true,
        );
      }
      addRuntimeConnectorChannel(runtime, connected);
      await connectorEventListener?.onConnectorConnected?.({
        connectorType: "database",
        connectorName,
        connectionInfo,
        connector: connected,
      });
      return toToolJsonResult(
        "database_connect_connector",
        buildConnectionStatusPayload({
          runtimeStatus,
          connector: connected,
          extra: {
            need_connection_info: needConnectionInfo,
            database_type: databaseType,
            connection_info_masked: maskConnectionInfo(connectionInfo),
            connection_defaults: collectNonSensitiveDefaults(connectionInfo),
          },
        }),
        true,
      );
    },
  });

  return [databaseConnectConnectorTool];
}
