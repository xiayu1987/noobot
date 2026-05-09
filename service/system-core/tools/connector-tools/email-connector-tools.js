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
  emailFields,
  findConnectedConnector,
  getMissingFieldNames,
  isUserCancelledInteraction,
  maskConnectionInfo,
  mergeConnectionInfo,
  normalizeProvidedEmailDefaults,
  resolveRememberedConnectorInfo,
  resolveConfiguredConnectorInfo,
  resolveRuntimeLocale,
  tConnector,
} from "./connector-toolkit.js";
import { tTool } from "../tool-i18n.js";

export function createEmailConnectorTools(context = {}) {
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

  const emailConnectConnectorTool = new DynamicStructuredTool({
    name: "email_connect_connector",
    description: tToolDescription(runtime, "email_connect_connector"),
    schema: z.object({
      connector_name: z
        .string()
        .describe(
          tToolParamDescription(runtime, "email_connect_connector", "connector_name"),
        ),
      default_values: z
        .union([z.string(), z.object({}).passthrough()])
        .optional()
        .describe(
          tToolParamDescription(runtime, "email_connect_connector", "default_values"),
        ),
    }),
    func: async ({ connector_name, default_values }) => {
      const runtimeLocale = resolveRuntimeLocale(runtime);
      if (!store || typeof store.connectConnector !== "function") {
        return toToolJsonResult("email_connect_connector", {
          ok: false,
          error: tTool(runtime, "connectors.storeMissing"),
        });
      }
      if (!rootSessionId) {
        return toToolJsonResult("email_connect_connector", {
          ok: false,
          error: tTool(runtime, "connectors.rootSessionMissing"),
        });
      }
      const connectorName = String(connector_name || "").trim();
      if (!connectorName) {
        return toToolJsonResult("email_connect_connector", {
          ok: false,
          error: tTool(runtime, "connectors.connectorNameRequired"),
        });
      }
      const existingConnected = findConnectedConnector({
        store,
        rootSessionId,
        connectorName,
        connectorType: "email",
      });
      if (existingConnected) {
        connectorEventListener?.onConnectorAlreadyConnected?.({
          connectorType: "email",
          connectorName,
        });
        return buildAlreadyConnectedResponse(
          "email_connect_connector",
          existingConnected,
          runtime,
        );
      }

      let connectionInfo = resolveConfiguredConnectorInfo({
        effectiveConfig,
        connectorName,
        connectorType: "email",
      });
      const rememberedConnectionInfo = await resolveRememberedConnectorInfo({
        historyStore,
        userId: runtime?.userId || "",
        rootSessionId,
        connectorType: "email",
        connectorName,
      });
      const providedDefaults = normalizeProvidedEmailDefaults(default_values);
      connectionInfo = mergeConnectionInfo(connectionInfo, rememberedConnectionInfo);
      connectionInfo = mergeConnectionInfo(connectionInfo, providedDefaults);
      const baseFields = attachDefaultValuesToFields(
        alignFieldsWithConnectionInfo(
          emailFields(runtimeLocale),
          connectionInfo,
          runtimeLocale,
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
          return toToolJsonResult("email_connect_connector", {
            ok: false,
            error: tConnector(runtime, "missingConnectionInfoNoInteraction"),
          });
        }
        if (!bridge?.requestUserInteraction) {
          return toToolJsonResult("email_connect_connector", {
            ok: false,
            error: tTool(runtime, "tools.connectors.errorUserInteractionBridgeMissing"),
          });
        }
        const interactionResult = await bridge.requestUserInteraction({
          content: tConnector(runtime, "fillEmailConnectionInfo"),
          fields,
          dialogProcessId,
          requireEncryption: true,
          sessionId,
          toolName: "email_connect_connector",
          needConnectionInfo: true,
          connectorName,
          connectorType: "email",
        });
        if (isUserCancelledInteraction(interactionResult)) {
          return toToolJsonResult("email_connect_connector", {
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
        connectorType: "email",
        connectionInfo,
      });
      const runtimeStatus = await buildRuntimeConnectorStatus({
        runtime,
        store,
        rootSessionId,
        connectorName,
        connectorType: "email",
      });
      const connectedSuccess = String(runtimeStatus?.status || "") === "connected";
      if (!connectedSuccess) {
        if (typeof store.disconnectConnector === "function") {
          store.disconnectConnector({
            sessionId: rootSessionId,
            connectorName,
            connectorType: "email",
          });
        }
        return toToolJsonResult(
          "email_connect_connector",
          buildConnectionStatusPayload({
            runtimeStatus,
            connector: connected,
            extra: {
              need_connection_info: needConnectionInfo,
              connection_info_masked: maskConnectionInfo(connectionInfo),
              connection_defaults: collectNonSensitiveDefaults(connectionInfo),
            },
          }),
          true,
        );
      }
      addRuntimeConnectorChannel(runtime, connected);
      await connectorEventListener?.onConnectorConnected?.({
        connectorType: "email",
        connectorName,
        connectionInfo,
        connector: connected,
      });
      return toToolJsonResult(
        "email_connect_connector",
        buildConnectionStatusPayload({
          runtimeStatus,
          connector: connected,
          extra: {
            need_connection_info: needConnectionInfo,
            connection_info_masked: maskConnectionInfo(connectionInfo),
            connection_defaults: collectNonSensitiveDefaults(connectionInfo),
          },
        }),
        true,
      );
    },
  });

  return [emailConnectConnectorTool];
}
