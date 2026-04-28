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
  emailFields,
  findConnectedConnector,
  getMissingFieldNames,
  isUserCancelledInteraction,
  maskConnectionInfo,
  mergeConnectionInfo,
  normalizeProvidedEmailDefaults,
  resolveRememberedConnectorInfo,
  resolveConfiguredConnectorInfo,
} from "./connector-toolkit.js";

export function createEmailConnectorTools(context = {}) {
  const {
    runtime,
    store,
    historyStore,
    rootSessionId,
    allowUserInteraction,
    bridge,
    dialogProcessId,
    sessionId,
    effectiveConfig,
  } = context;

  const emailConnectConnectorTool = new DynamicStructuredTool({
    name: "email_connect_connector",
    description:
      "邮件连接器连接工具。用于配置 SMTP/IMAP 连接，可后续通过 access_connector 收发邮件。",
    schema: z.object({
      connector_name: z.string().describe("连接器名称"),
      default_values: z
        .union([z.string(), z.object({}).passthrough()])
        .optional()
        .describe("可选：邮件连接默认值（不含 password），可传 JSON 字符串或对象"),
    }),
    func: async ({ connector_name, default_values }) => {
      if (!store || typeof store.connectConnector !== "function") {
        return toToolJsonResult("email_connect_connector", {
          ok: false,
          error: "connector channel store missing",
        });
      }
      if (!rootSessionId) {
        return toToolJsonResult("email_connect_connector", {
          ok: false,
          error: "rootSessionId missing in systemRuntime",
        });
      }
      const connectorName = String(connector_name || "").trim();
      if (!connectorName) {
        return toToolJsonResult("email_connect_connector", {
          ok: false,
          error: "connector_name required",
        });
      }
      const existingConnected = findConnectedConnector({
        store,
        rootSessionId,
        connectorName,
        connectorType: "email",
      });
      if (existingConnected) {
        return buildAlreadyConnectedResponse(
          "email_connect_connector",
          existingConnected,
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
      const fields = attachDefaultValuesToFields(
        alignFieldsWithConnectionInfo(emailFields(), connectionInfo),
        connectionInfo,
      );
      const missing = getMissingFieldNames(fields, connectionInfo);
      const needConnectionInfo = missing.length > 0;

      if (needConnectionInfo) {
        if (!allowUserInteraction) {
          return toToolJsonResult("email_connect_connector", {
            ok: false,
            error: "缺少连接信息，且当前会话已禁用用户交互",
          });
        }
        if (!bridge?.requestUserInteraction) {
          return toToolJsonResult("email_connect_connector", {
            ok: false,
            error: "user interaction bridge missing for connection info completion",
          });
        }
        const interactionResult = await bridge.requestUserInteraction({
          content: "请补全邮件连接信息（SMTP/IMAP）",
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
            error: "用户取消了操作",
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
      if (
        historyStore &&
        typeof historyStore.upsertConnectedConnector === "function"
      ) {
        await historyStore.upsertConnectedConnector({
          userId: String(runtime?.userId || "").trim(),
          sessionId: rootSessionId,
          connectorType: "email",
          connectorName,
          connectionInfo,
          connectionMeta:
            connected?.connectionMeta && typeof connected.connectionMeta === "object"
              ? connected.connectionMeta
              : {},
        });
      }
      if (bridge?.requestUserInteraction) {
        try {
          await bridge.requestUserInteraction({
            content: `邮件连接器连接成功：${connectorName}`,
            fields: [],
            dialogProcessId,
            requireEncryption: false,
            sessionId,
            toolName: "email_connect_connector",
            connectorName,
            connectorType: "email",
            interactionType: "connector_connected",
            interactionData: {
              connectorName,
              connectorType: "email",
              status: "connected",
            },
          });
        } catch {}
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
    },
  });

  return [emailConnectConnectorTool];
}
