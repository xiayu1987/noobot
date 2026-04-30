/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { toToolJsonResult } from "../tool-json-result.js";
import {
  addRuntimeConnectorChannel,
  alignFieldsWithConnectionInfo,
  attachDefaultValuesToFields,
  buildAlreadyConnectedResponse,
  buildConnectionStatusPayload,
  buildRuntimeConnectorStatus,
  collectNonSensitiveDefaults,
  findConnectedConnector,
  getMissingFieldNames,
  isUserCancelledInteraction,
  maskConnectionInfo,
  mergeConnectionInfo,
  normalizeProvidedTerminalDefaults,
  resolveRememberedConnectorInfo,
  normalizeTerminalType,
  resolveConfiguredConnectorInfo,
  terminalFields,
  resolveRuntimeLocale,
  tConnector,
} from "./connector-toolkit.js";

export function createTerminalConnectorTools(context = {}) {
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

  const terminalConnectConnectorTool = new DynamicStructuredTool({
    name: "terminal_connect_connector",
    description:
      "终端连接器连接工具，可以创建并连接。输入连接器名称和终端类型。",
    schema: z.object({
      connector_name: z.string().describe("连接器名称"),
      terminal_type: z.string().describe("终端类型：ssh"),
      default_values: z
        .union([z.string(), z.object({}).passthrough()])
        .optional()
        .describe("可选：终端连接默认值（不含 password），可传 JSON 字符串或对象"),
    }),
    func: async ({ connector_name, terminal_type, default_values }) => {
      const runtimeLocale = resolveRuntimeLocale(runtime);
      if (!store || typeof store.connectConnector !== "function") {
        return toToolJsonResult("terminal_connect_connector", {
          ok: false,
          error: "connector channel store missing",
        });
      }
      if (!rootSessionId) {
        return toToolJsonResult("terminal_connect_connector", {
          ok: false,
          error: "rootSessionId missing in systemRuntime",
        });
      }
      const connectorName = String(connector_name || "").trim();
      const terminalType = normalizeTerminalType(terminal_type);
      if (!connectorName) {
        return toToolJsonResult("terminal_connect_connector", {
          ok: false,
          error: "connector_name required",
        });
      }
      if (!terminalType) {
        return toToolJsonResult("terminal_connect_connector", {
          ok: false,
          error: "terminal_type currently only supports ssh",
        });
      }
      const existingConnected = findConnectedConnector({
        store,
        rootSessionId,
        connectorName,
        connectorType: "terminal",
      });
      if (existingConnected) {
        connectorEventListener?.onConnectorAlreadyConnected?.({
          connectorType: "terminal",
          connectorName,
        });
        return buildAlreadyConnectedResponse(
          "terminal_connect_connector",
          existingConnected,
          runtime,
        );
      }

      let connectionInfo = resolveConfiguredConnectorInfo({
        effectiveConfig,
        connectorName,
        connectorType: "terminal",
      });
      const rememberedConnectionInfo = await resolveRememberedConnectorInfo({
        historyStore,
        userId: runtime?.userId || "",
        rootSessionId,
        connectorType: "terminal",
        connectorName,
      });
      const providedDefaults = normalizeProvidedTerminalDefaults(default_values);
      connectionInfo = mergeConnectionInfo(connectionInfo, rememberedConnectionInfo);
      connectionInfo = mergeConnectionInfo(connectionInfo, providedDefaults);
      connectionInfo = mergeConnectionInfo(connectionInfo, {
        terminal_type: terminalType,
      });
      const baseFields = attachDefaultValuesToFields(
        alignFieldsWithConnectionInfo(
          terminalFields(terminalType, runtimeLocale),
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
          return toToolJsonResult("terminal_connect_connector", {
            ok: false,
            error: tConnector(runtime, "missingConnectionInfoNoInteraction"),
          });
        }
        if (!bridge?.requestUserInteraction) {
          return toToolJsonResult("terminal_connect_connector", {
            ok: false,
            error: "user interaction bridge missing for connection info completion",
          });
        }
        const interactionResult = await bridge.requestUserInteraction({
          content: tConnector(runtime, "fillTerminalConnectionInfo", {
            terminalType,
          }),
          fields,
          dialogProcessId,
          requireEncryption: true,
          sessionId,
          toolName: "terminal_connect_connector",
          needConnectionInfo: true,
          connectorName,
          connectorType: "terminal",
        });
        if (isUserCancelledInteraction(interactionResult)) {
          return toToolJsonResult("terminal_connect_connector", {
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
        connectorType: "terminal",
        connectionInfo,
      });
      const runtimeStatus = await buildRuntimeConnectorStatus({
        store,
        rootSessionId,
        connectorName,
        connectorType: "terminal",
      });
      const connectedSuccess = String(runtimeStatus?.status || "") === "connected";
      if (!connectedSuccess) {
        if (typeof store.disconnectConnector === "function") {
          store.disconnectConnector({
            sessionId: rootSessionId,
            connectorName,
            connectorType: "terminal",
          });
        }
        return toToolJsonResult(
          "terminal_connect_connector",
          buildConnectionStatusPayload({
            runtimeStatus,
            connector: connected,
            extra: {
              need_connection_info: needConnectionInfo,
              terminal_type: terminalType,
              connection_info_masked: maskConnectionInfo(connectionInfo),
              connection_defaults: collectNonSensitiveDefaults(connectionInfo),
            },
          }),
          true,
        );
      }
      addRuntimeConnectorChannel(runtime, connected);
      await connectorEventListener?.onConnectorConnected?.({
        connectorType: "terminal",
        connectorName,
        connectionInfo,
        connector: connected,
      });
      return toToolJsonResult(
        "terminal_connect_connector",
        buildConnectionStatusPayload({
          runtimeStatus,
          connector: connected,
          extra: {
            need_connection_info: needConnectionInfo,
            terminal_type: terminalType,
            connection_info_masked: maskConnectionInfo(connectionInfo),
            connection_defaults: collectNonSensitiveDefaults(connectionInfo),
          },
        }),
        true,
      );
    },
  });

  return [terminalConnectConnectorTool];
}
