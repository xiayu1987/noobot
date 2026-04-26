/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { mergeConfig } from "../../config/index.js";
import { toToolJsonResult } from "../tool-json-result.js";
import { cleanConnectorOutputForLLM } from "../../utils/text-cleaner.js";

function pickObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeDatabaseType(input = "") {
  const value = String(input || "").trim().toLowerCase();
  if (["mysql", "mariadb"].includes(value)) return "mysql";
  if (["postgres", "postgresql", "pg"].includes(value)) return "postgres";
  if (["sqlite", "sqlite3"].includes(value)) return "sqlite";
  return "";
}

function normalizeTerminalType(input = "") {
  const value = String(input || "").trim().toLowerCase();
  if (["ssh", "linux_ssh", "server_ssh"].includes(value)) return "ssh";
  return "";
}

function databaseFields(databaseType = "") {
  if (databaseType === "sqlite") {
    return [{ name: "file_path", displayName: "SQLite 文件路径", required: true }];
  }
  return [
    { name: "host", displayName: "主机地址", required: true },
    { name: "port", displayName: "端口", required: false },
    { name: "username", displayName: "用户名", required: true },
    { name: "password", displayName: "密码", required: true },
    { name: "database", displayName: "数据库名", required: true },
  ];
}

function attachDefaultValuesToFields(fields = [], connectionInfo = {}) {
  const normalizedFields = Array.isArray(fields) ? fields : [];
  const normalizedConnectionInfo = pickObject(connectionInfo);
  return normalizedFields.map((fieldItem) => {
    const fieldName = String(fieldItem?.name || "").trim();
    if (!fieldName || fieldName === "password") return { ...fieldItem };
    const rawDefaultValue = normalizedConnectionInfo?.[fieldName];
    const defaultValue = String(rawDefaultValue ?? "").trim();
    if (!defaultValue) return { ...fieldItem };
    return {
      ...fieldItem,
      default_value: defaultValue,
      defaultValue,
    };
  });
}

function collectNonSensitiveDefaults(connectionInfo = {}) {
  const normalizedConnectionInfo = pickObject(connectionInfo);
  const defaults = {};
  for (const [key, value] of Object.entries(normalizedConnectionInfo)) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || normalizedKey.toLowerCase() === "password") continue;
    const normalizedValue = String(value ?? "").trim();
    if (!normalizedValue) continue;
    defaults[normalizedKey] = normalizedValue;
  }
  return defaults;
}

function parseOptionalObjectInput(inputValue = {}) {
  const source =
    typeof inputValue === "string"
      ? (() => {
          try {
            return JSON.parse(inputValue || "{}");
          } catch {
            return {};
          }
        })()
      : pickObject(inputValue);
  return pickObject(source);
}

function normalizeProvidedDefaults(defaultValuesInput = {}, allowedKeys = []) {
  const source = parseOptionalObjectInput(defaultValuesInput);
  const allowedKeySet = new Set(
    (Array.isArray(allowedKeys) ? allowedKeys : [])
      .map((key) => String(key || "").trim())
      .filter(Boolean),
  );
  const normalizedDefaults = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = String(rawKey || "").trim();
    if (!key || !allowedKeySet.has(key)) continue;
    if (key.toLowerCase() === "password") continue;
    const value = String(rawValue ?? "").trim();
    if (!value) continue;
    normalizedDefaults[key] = value;
  }
  return normalizedDefaults;
}

function normalizeProvidedDatabaseDefaults(defaultValuesInput = {}) {
  return normalizeProvidedDefaults(defaultValuesInput, [
    "host",
    "port",
    "username",
    "database",
    "file_path",
    "database_type",
  ]);
}

function normalizeProvidedTerminalDefaults(defaultValuesInput = {}) {
  return normalizeProvidedDefaults(defaultValuesInput, [
    "host",
    "port",
    "username",
    "terminal_type",
  ]);
}

function terminalFields(terminalType = "") {
  if (terminalType !== "ssh") return [];
  return [
    { name: "host", displayName: "服务器IP/域名", required: true },
    { name: "port", displayName: "端口(默认22)", required: false },
    { name: "username", displayName: "用户名", required: true },
    { name: "password", displayName: "密码", required: true },
  ];
}

function mergeConnectionInfo(base = {}, patch = {}) {
  return { ...pickObject(base), ...pickObject(patch) };
}

function getMissingFieldNames(fields = [], connectionInfo = {}) {
  const info = pickObject(connectionInfo);
  return fields
    .filter((item) => item?.required)
    .map((item) => String(item?.name || "").trim())
    .filter(Boolean)
    .filter((key) => !String(info?.[key] ?? "").trim());
}

function resolveConfiguredConnectorInfo({
  effectiveConfig = {},
  connectorName = "",
  connectorType = "",
} = {}) {
  const normalizedName = String(connectorName || "").trim();
  const normalizedType = String(connectorType || "").trim().toLowerCase();
  const connectorToolConfigKey =
    normalizedType === "database"
      ? "database_connect_connector"
      : normalizedType === "terminal"
        ? "terminal_connect_connector"
        : "";
  const scopedConnectors = pickObject(
    connectorToolConfigKey
      ? effectiveConfig?.tools?.[connectorToolConfigKey]?.connectors
      : {},
  );
  const globalConnectors = pickObject(effectiveConfig?.connectors);
  const all = Object.keys(scopedConnectors).length
    ? scopedConnectors
    : globalConnectors;
  return mergeConnectionInfo(
    mergeConnectionInfo(
      mergeConnectionInfo(
        pickObject(all?.[normalizedName]),
        pickObject(all?.[normalizedType]?.[normalizedName]),
      ),
      pickObject(all?.[`${normalizedType}s`]?.[normalizedName]),
    ),
    pickObject(all?.by_name?.[normalizedName]),
  );
}

function maskConnectionInfo(info = {}) {
  const out = { ...pickObject(info) };
  for (const key of ["password", "connection_string", "connectionString"]) {
    if (out[key]) out[key] = "***";
  }
  return out;
}

function toSafeConnector(connector = {}) {
  const connectorType = String(connector?.connectorType || "")
    .trim()
    .toLowerCase();
  const meta = pickObject(connector?.connectionMeta);
  const safeMeta = {};
  if (connectorType === "database") {
    safeMeta.database_type = String(
      meta?.databaseType || meta?.database_type || "",
    ).trim();
  } else if (connectorType === "terminal") {
    const port = Number(meta?.port);
    if (Number.isFinite(port) && port > 0) safeMeta.port = port;
  }
  return {
    connector_name: String(connector?.connectorName || "").trim(),
    connector_type: connectorType,
    status: "connected",
    status_code: 0,
    connected_at: String(connector?.connectedAt || "").trim(),
    connection_meta: safeMeta,
  };
}

async function resolveConnectorRuntimeStatus({
  store = null,
  rootSessionId = "",
  connector = {},
} = {}) {
  const safeConnector = toSafeConnector(connector);
  if (!store || typeof store.executeConnectorCommand !== "function") {
    return {
      ...safeConnector,
      status: "unknown",
      status_code: 503,
      status_message: "connector channel store unavailable",
    };
  }
  const connectorName = String(safeConnector?.connector_name || "").trim();
  const connectorType = String(safeConnector?.connector_type || "").trim();
  if (!connectorName || !connectorType) {
    return {
      ...safeConnector,
      status: "invalid",
      status_code: 400,
      status_message: "invalid connector identity",
    };
  }
  const healthCommand =
    connectorType === "database"
      ? "SELECT 1 WHERE 1=1"
      : connectorType === "terminal"
        ? "printf __NOOBOT_CONNECTOR_HEALTH__"
        : "";
  if (!healthCommand) {
    return {
      ...safeConnector,
      status: "unknown",
      status_code: 400,
      status_message: "unsupported connector type",
    };
  }
  try {
    const executionResult = await store.executeConnectorCommand({
      sessionId: String(rootSessionId || "").trim(),
      connectorName,
      connectorType,
      command: healthCommand,
      timeoutMs: 8000,
    });
    const statusCode = Number(executionResult?.output?.code ?? 0);
    const success = executionResult?.ok === true;
    return {
      ...safeConnector,
      status: success ? "connected" : "error",
      status_code: Number.isFinite(statusCode) ? statusCode : success ? 0 : 1,
      status_message: success ? "ok" : String(executionResult?.output?.stderr || "").trim(),
      checked_at: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ...safeConnector,
      status: "error",
      status_code: 500,
      status_message: String(error?.message || error || "health check failed"),
      checked_at: new Date().toISOString(),
    };
  }
}

function addRuntimeConnectorChannel(runtime = {}, connector = {}) {
  const normalizedType = String(connector?.connectorType || "")
    .trim()
    .toLowerCase();
  if (!["database", "terminal"].includes(normalizedType)) return;
  const bucketKey = normalizedType === "database" ? "databases" : "terminals";
  const current = pickObject(runtime?.connectorChannels);
  const next = {
    databases: Array.isArray(current?.databases) ? [...current.databases] : [],
    terminals: Array.isArray(current?.terminals) ? [...current.terminals] : [],
  };
  const list = next[bucketKey];
  const targetName = String(connector?.connectorName || "").trim();
  const hitIndex = list.findIndex(
    (item) => String(item?.connectorName || "").trim() === targetName,
  );
  if (hitIndex >= 0) list[hitIndex] = connector;
  else list.push(connector);
  runtime.connectorChannels = next;
}

function findConnectedConnector({
  store = null,
  rootSessionId = "",
  connectorName = "",
  connectorType = "",
} = {}) {
  if (!store || typeof store.getSessionConnectors !== "function") return null;
  const allConnectors = store.getSessionConnectors(String(rootSessionId || "").trim());
  const bucket = String(connectorType || "").trim() === "database" ? "databases" : "terminals";
  const sourceList = Array.isArray(allConnectors?.[bucket]) ? allConnectors[bucket] : [];
  const normalizedName = String(connectorName || "").trim();
  return (
    sourceList.find(
      (item) => String(item?.connectorName || "").trim() === normalizedName,
    ) || null
  );
}

function isUserCancelledInteraction(interactionResult = {}) {
  return Boolean(
    interactionResult &&
      typeof interactionResult === "object" &&
      !Array.isArray(interactionResult) &&
      interactionResult.confirmed === false,
  );
}

function buildAlreadyConnectedResponse(toolName = "", connector = {}) {
  return toToolJsonResult(toolName, {
    ok: true,
    status: "already_connected",
    connector,
    message: "连接器已连接，请通过 access_connector 执行命令",
  });
}

function buildConnectionStatusPayload({
  runtimeStatus = {},
  connector = {},
  extra = {},
} = {}) {
  return {
    ok: runtimeStatus?.status === "connected",
    status: runtimeStatus?.status || "unknown",
    status_code: Number(runtimeStatus?.status_code ?? 0),
    status_message: String(runtimeStatus?.status_message || ""),
    checked_at: String(runtimeStatus?.checked_at || ""),
    connector,
    ...(pickObject(extra) || {}),
  };
}

export function createConnectorChannelTools({ agentContext }) {
  const runtime = agentContext?.runtime || {};
  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const systemRuntime = runtime?.systemRuntime || {};
  const sessionId = String(systemRuntime?.sessionId || "").trim();
  const rootSessionId = String(systemRuntime?.rootSessionId || "").trim();
  const dialogProcessId = String(systemRuntime?.dialogProcessId || "").trim();
  const allowUserInteraction = systemRuntime?.config?.allowUserInteraction !== false;
  const bridge = runtime?.userInteractionBridge || null;
  const store = runtime?.sharedTools?.connectorChannelStore || null;
  const maxAccessOutputChars = Number(
    effectiveConfig?.tools?.access_connector?.max_output_chars ??
      effectiveConfig?.tools?.access_connector?.maxOutputChars ??
      8000,
  );

  const databaseConnectConnectorTool = new DynamicStructuredTool({
    name: "database_connect_connector",
    description:
      "数据库连接器连接工具。输入连接器名称和数据库类型。",
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
      const providedDefaults = normalizeProvidedDatabaseDefaults(default_values);
      connectionInfo = mergeConnectionInfo(connectionInfo, providedDefaults);
      connectionInfo = mergeConnectionInfo(connectionInfo, {
        database_type: databaseType,
      });
      const fields = attachDefaultValuesToFields(
        databaseFields(databaseType),
        connectionInfo,
      );
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
      addRuntimeConnectorChannel(runtime, connected);
      const runtimeStatus = await resolveConnectorRuntimeStatus({
        store,
        rootSessionId,
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

  const terminalConnectConnectorTool = new DynamicStructuredTool({
    name: "terminal_connect_connector",
    description:
      "终端连接器连接工具。输入连接器名称和终端类型。",
    schema: z.object({
      connector_name: z.string().describe("连接器名称"),
      terminal_type: z.string().describe("终端类型：ssh"),
      default_values: z
        .union([z.string(), z.object({}).passthrough()])
        .optional()
        .describe("可选：终端连接默认值（不含 password），可传 JSON 字符串或对象"),
    }),
    func: async ({ connector_name, terminal_type, default_values }) => {
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
        return buildAlreadyConnectedResponse(
          "terminal_connect_connector",
          existingConnected,
        );
      }

      let connectionInfo = resolveConfiguredConnectorInfo({
        effectiveConfig,
        connectorName,
        connectorType: "terminal",
      });
      const providedDefaults = normalizeProvidedTerminalDefaults(default_values);
      connectionInfo = mergeConnectionInfo(connectionInfo, providedDefaults);
      connectionInfo = mergeConnectionInfo(connectionInfo, {
        terminal_type: terminalType,
      });
      const fields = attachDefaultValuesToFields(
        terminalFields(terminalType),
        connectionInfo,
      );
      const missing = getMissingFieldNames(fields, connectionInfo);
      const needConnectionInfo = missing.length > 0;

      if (needConnectionInfo) {
        if (!allowUserInteraction) {
          return toToolJsonResult("terminal_connect_connector", {
            ok: false,
            error: "缺少连接信息，且当前会话已禁用用户交互",
          });
        }
        if (!bridge?.requestUserInteraction) {
          return toToolJsonResult("terminal_connect_connector", {
            ok: false,
            error: "user interaction bridge missing for connection info completion",
          });
        }
        const interactionResult = await bridge.requestUserInteraction({
          content: `请补全终端连接信息（${terminalType}）`,
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
            error: "用户取消了操作",
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
      addRuntimeConnectorChannel(runtime, connected);
      const runtimeStatus = await resolveConnectorRuntimeStatus({
        store,
        rootSessionId,
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

  const accessConnectorTool = new DynamicStructuredTool({
    name: "access_connector",
    description:
      "访问已连接连接器。输入连接器名称、类型和命令，返回执行结果。仅可访问当前 session 绑定的连接器。命令需安全可审计：数据库场景中 UPDATE/DELETE 必须带 WHERE 条件，避免全表更新/删除；优先先执行 SELECT 校验再执行写操作。",
    schema: z.object({
      connector_name: z.string().describe("连接器名称"),
      connector_type: z.string().describe("连接器类型：database 或 terminal"),
      command: z
        .string()
        .describe(
          "要执行的命令。要求：1) 数据库 SQL 中 UPDATE/DELETE 必须带 WHERE；2) 禁止无条件全表修改；3) 建议先 SELECT 校验命中范围，再执行写入；4) 终端命令避免危险批量删除操作。",
        ),
    }),
    func: async ({ connector_name, connector_type, command }) => {
      if (!store || typeof store.executeConnectorCommand !== "function") {
        return toToolJsonResult("access_connector", {
          ok: false,
          error: "connector channel store missing",
        });
      }
      if (!rootSessionId) {
        return toToolJsonResult("access_connector", {
          ok: false,
          error: "rootSessionId missing in systemRuntime",
        });
      }
      const connectorName = String(connector_name || "").trim();
      const connectorType = String(connector_type || "").trim().toLowerCase();
      if (!connectorName || !["database", "terminal"].includes(connectorType)) {
        return toToolJsonResult("access_connector", {
          ok: false,
          error: "connector_name and connector_type(database|terminal) required",
        });
      }
      try {
        const result = await store.executeConnectorCommand({
          sessionId: rootSessionId,
          connectorName,
          connectorType,
          command: String(command || "").trim(),
        });
        runtime.connectorChannels = store.getSessionConnectors(rootSessionId);
        return toToolJsonResult(
          "access_connector",
          {
            ok: result?.ok === true,
            status: result?.ok ? "completed" : "failed",
            message: result?.ok ? "执行完成" : "执行失败",
            connector: result?.connector || {},
            output: cleanConnectorOutputForLLM(
              {
                connectorType,
                output: result?.output || {},
              },
              { maxChars: maxAccessOutputChars },
            ),
          },
          true,
        );
      } catch (error) {
        return toToolJsonResult("access_connector", {
          ok: false,
          error: error?.message || String(error),
        });
      }
    },
  });

  const inspectConnectorsTool = new DynamicStructuredTool({
    name: "inspect_connectors",
    description: "查看当前 session 的全部连接器（仅返回脱敏后的连接信息）。",
    schema: z.object({}),
    func: async () => {
      if (!store || typeof store.getSessionConnectors !== "function") {
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
      const all = store.getSessionConnectors(rootSessionId);
      const databaseSource = Array.isArray(all?.databases) ? all.databases : [];
      const terminalSource = Array.isArray(all?.terminals) ? all.terminals : [];
      const databases = await Promise.all(
        databaseSource.map((connector) =>
          resolveConnectorRuntimeStatus({
            store,
            rootSessionId,
            connector,
          }),
        ),
      );
      const terminals = await Promise.all(
        terminalSource.map((connector) =>
          resolveConnectorRuntimeStatus({
            store,
            rootSessionId,
            connector,
          }),
        ),
      );
      runtime.connectorChannels = {
        databases: Array.isArray(all?.databases) ? all.databases : [],
        terminals: Array.isArray(all?.terminals) ? all.terminals : [],
      };
      return toToolJsonResult(
        "inspect_connectors",
        {
          ok: true,
          status: "completed",
          connectors: {
            databases,
            terminals,
          },
          summary: {
            database_count: databases.length,
            terminal_count: terminals.length,
            total_count: databases.length + terminals.length,
          },
        },
        true,
      );
    },
  });

  return [
    databaseConnectConnectorTool,
    terminalConnectConnectorTool,
    accessConnectorTool,
    inspectConnectorsTool,
  ];
}
