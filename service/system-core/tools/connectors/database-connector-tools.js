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
} from "./connector-toolkit.js";

export function createDatabaseConnectorTools(context = {}) {
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

  const databaseConnectConnectorTool = new DynamicStructuredTool({
    name: "database_connect_connector",
    description:
      "数据库连接器连接工具，可以创建并连接。输入连接器名称和数据库类型。",
    schema: z.object({
      connector_name: z.string().describe("连接器名称"),
      database_type: z.string().describe("数据库类型：mysql/postgres/sqlite"),
      default_values: z
        .union([z.string(), z.object({}).passthrough()])
        .optional()
        .describe("可选：数据库连接默认值，可传 JSON 字符串或对象"),
    }),
    func: async ({ connector_name, database_type, default_values }) => {
      if (!store || typeof store.connectConnector !== "function") {
        return toToolJsonResult("database_connect_connector", {
          ok: false,
          error: "connector channel store missing",
        });
      }
      if (!rootSessionId) {
        return toToolJsonResult("database_connect_connector", {
          ok: false,
          error: "rootSessionId missing in systemRuntime",
        });
      }
      const connectorName = String(connector_name || "").trim();
      const databaseType = normalizeDatabaseType(database_type);
      if (!connectorName) {
        return toToolJsonResult("database_connect_connector", {
          ok: false,
          error: "connector_name required",
        });
      }
      if (!databaseType) {
        return toToolJsonResult("database_connect_connector", {
          ok: false,
          error: "database_type must be mysql|postgres|sqlite",
        });
      }
      const existingConnected = findConnectedConnector({
        store,
        rootSessionId,
        connectorName,
        connectorType: "database",
      });
      if (existingConnected) {
        return buildAlreadyConnectedResponse(
          "database_connect_connector",
          existingConnected,
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
          databaseFields(databaseType),
          connectionInfo,
        ),
        connectionInfo,
      );
      const fields = [
        {
          name: "connector_name",
          displayName: "连接器名称",
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
            error: "缺少连接信息，且当前会话已禁用用户交互",
          });
        }
        if (!bridge?.requestUserInteraction) {
          return toToolJsonResult("database_connect_connector", {
            ok: false,
            error: "user interaction bridge missing for connection info completion",
          });
        }
        const interactionResult = await bridge.requestUserInteraction({
          content: `请补全数据库连接信息（${databaseType}）`,
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
            error: "用户取消了操作",
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
      if (
        historyStore &&
        typeof historyStore.upsertConnectedConnector === "function"
      ) {
        await historyStore.upsertConnectedConnector({
          userId: String(runtime?.userId || "").trim(),
          sessionId: rootSessionId,
          connectorType: "database",
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
            content: `数据库连接器连接成功：${connectorName}`,
            fields: [],
            dialogProcessId,
            requireEncryption: false,
            sessionId,
            toolName: "database_connect_connector",
            connectorName,
            connectorType: "database",
            interactionType: "connector_connected",
            interactionData: {
              connectorName,
              connectorType: "database",
              status: "connected",
            },
          });
        } catch {}
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
    },
  });

  return [databaseConnectConnectorTool];
}
