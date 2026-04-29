/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig } from "../../config/index.js";
import { toToolJsonResult } from "../tool-json-result.js";
import { cleanConnectorOutputForLLM } from "../../utils/text-cleaner.js";

function pickObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function normalizeConnectorType(input = "") {
  const value = String(input || "").trim().toLowerCase();
  if (["database", "db"].includes(value)) return "database";
  if (["terminal", "server_terminal", "shell"].includes(value)) return "terminal";
  if (["email", "mail", "smtp_imap"].includes(value)) return "email";
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

function terminalFields(terminalType = "") {
  if (terminalType !== "ssh") return [];
  return [
    { name: "host", displayName: "服务器IP/域名", required: true },
    { name: "port", displayName: "端口(默认22)", required: false },
    { name: "username", displayName: "用户名", required: true },
    { name: "password", displayName: "密码", required: true },
  ];
}

function emailFields() {
  return [
    { name: "smtp_host", displayName: "SMTP 主机", required: true },
    { name: "smtp_port", displayName: "SMTP 端口", required: false },
    { name: "imap_host", displayName: "IMAP 主机", required: true },
    { name: "imap_port", displayName: "IMAP 端口", required: false },
    { name: "username", displayName: "邮箱账号", required: true },
    { name: "password", displayName: "邮箱密码/授权码", required: true },
    { name: "from_email", displayName: "发件地址", required: false },
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

function normalizeProvidedEmailDefaults(defaultValuesInput = {}) {
  return normalizeProvidedDefaults(defaultValuesInput, [
    "smtp_host",
    "smtp_port",
    "smtp_secure",
    "imap_host",
    "imap_port",
    "imap_secure",
    "username",
    "from_email",
  ]);
}

function normalizeLookupKey(input = "") {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_");
}

function resolveConnectorFromMapByName(connectorMap = {}, connectorName = "") {
  const normalizedMap = pickObject(connectorMap);
  const targetName = String(connectorName || "").trim();
  if (!targetName) return {};
  const exactValue = pickObject(normalizedMap[targetName]);
  if (Object.keys(exactValue).length) return exactValue;
  const normalizedTargetName = normalizeLookupKey(targetName);
  for (const [mapKey, mapValue] of Object.entries(normalizedMap)) {
    if (normalizeLookupKey(mapKey) !== normalizedTargetName) continue;
    const candidate = pickObject(mapValue);
    if (Object.keys(candidate).length) return candidate;
  }
  return {};
}

function resolveConnectorFallbackFromMap(connectorMap = {}) {
  const normalizedMap = pickObject(connectorMap);
  const defaultKeys = ["default", "默认", "connector_default"];
  for (const defaultKey of defaultKeys) {
    const value = resolveConnectorFromMapByName(normalizedMap, defaultKey);
    if (Object.keys(value).length) return value;
  }
  const entries = Object.entries(normalizedMap).filter(([, mapValue]) =>
    Object.keys(pickObject(mapValue)).length > 0,
  );
  return entries.length === 1 ? pickObject(entries[0][1]) : {};
}

function collectConnectorMapsByType({
  effectiveConfig = {},
  connectorType = "",
} = {}) {
  const normalizedType = String(connectorType || "").trim().toLowerCase();
  const connectorToolConfigKey =
    normalizedType === "database"
      ? "database_connect_connector"
      : normalizedType === "terminal"
        ? "terminal_connect_connector"
        : normalizedType === "email"
          ? "email_connect_connector"
          : "";
  const scopedConnectorMap = pickObject(
    connectorToolConfigKey
      ? effectiveConfig?.tools?.[connectorToolConfigKey]?.connectors
      : {},
  );
  const globalConnectorMap = pickObject(effectiveConfig?.connectors);
  const typedConnectorMap = pickObject(globalConnectorMap?.[normalizedType]);
  const typedPluralConnectorMap = pickObject(
    globalConnectorMap?.[`${normalizedType}s`],
  );
  const byNameConnectorMap = pickObject(globalConnectorMap?.by_name);
  return [
    { connectorMap: scopedConnectorMap, allowFallback: true },
    { connectorMap: globalConnectorMap, allowFallback: false },
    { connectorMap: typedConnectorMap, allowFallback: true },
    { connectorMap: typedPluralConnectorMap, allowFallback: true },
    { connectorMap: byNameConnectorMap, allowFallback: true },
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
  const connectorMaps = collectConnectorMapsByType({
    effectiveConfig,
    connectorType,
  });
  let resolvedInfo = {};
  for (const connectorMapItem of connectorMaps) {
    const connectorMap = pickObject(connectorMapItem?.connectorMap);
    const exactInfo = resolveConnectorFromMapByName(connectorMap, connectorName);
    if (Object.keys(exactInfo).length) {
      resolvedInfo = mergeConnectionInfo(resolvedInfo, exactInfo);
      continue;
    }
    if (connectorMapItem?.allowFallback !== true) continue;
    const fallbackInfo = resolveConnectorFallbackFromMap(connectorMap);
    if (Object.keys(fallbackInfo).length) {
      resolvedInfo = mergeConnectionInfo(resolvedInfo, fallbackInfo);
    }
  }
  return resolvedInfo;
}

function alignFieldsWithConnectionInfo(fields = [], connectionInfo = {}) {
  const normalizedFields = Array.isArray(fields) ? fields : [];
  const normalizedConnectionInfo = pickObject(connectionInfo);
  const existingFieldNames = new Set(
    normalizedFields
      .map((fieldItem) => String(fieldItem?.name || "").trim())
      .filter(Boolean),
  );
  const appendedFields = [];
  for (const [rawKey, rawValue] of Object.entries(normalizedConnectionInfo)) {
    const fieldName = String(rawKey || "").trim();
    if (!fieldName || existingFieldNames.has(fieldName)) continue;
    if (fieldName.toLowerCase() === "password") continue;
    if (rawValue === null || rawValue === undefined) continue;
    appendedFields.push({
      name: fieldName,
      displayName: fieldName,
      required: false,
    });
  }
  return [...normalizedFields, ...appendedFields];
}

function maskConnectionInfo(info = {}) {
  const out = { ...pickObject(info) };
  for (const key of ["password", "connection_string", "connectionString"]) {
    if (out[key]) out[key] = "***";
  }
  return out;
}

function addRuntimeConnectorChannel(runtime = {}, connector = {}) {
  const normalizedType = String(connector?.connectorType || "")
    .trim()
    .toLowerCase();
  if (!["database", "terminal", "email"].includes(normalizedType)) return;
  const bucketKey =
    normalizedType === "database"
      ? "databases"
      : normalizedType === "terminal"
        ? "terminals"
        : "emails";
  const current = pickObject(runtime?.connectorChannels);
  const next = {
    databases: Array.isArray(current?.databases) ? [...current.databases] : [],
    terminals: Array.isArray(current?.terminals) ? [...current.terminals] : [],
    emails: Array.isArray(current?.emails) ? [...current.emails] : [],
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
  const bucket =
    String(connectorType || "").trim() === "database"
      ? "databases"
      : String(connectorType || "").trim() === "terminal"
        ? "terminals"
        : "emails";
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

function buildRuntimeConnectorStatus({
  store,
  rootSessionId,
  connectorName,
  connectorType,
}) {
  return typeof store?.inspectConnectorRuntimeStatus === "function"
    ? store.inspectConnectorRuntimeStatus({
        sessionId: rootSessionId,
        connectorName,
        connectorType,
        timeoutMs: 8000,
      })
    : Promise.resolve({
        connector_name: connectorName,
        connector_type: connectorType,
        status: "unknown",
        status_code: 503,
        status_message: "connector runtime status inspector unavailable",
      });
}

function createConnectorToolContext(agentContext = {}) {
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
  const historyStore = runtime?.sharedTools?.connectorHistoryStore || null;
  const maxAccessOutputChars = Number(
    effectiveConfig?.tools?.access_connector?.max_output_chars ??
      effectiveConfig?.tools?.access_connector?.maxOutputChars ??
      8000,
  );
  return {
    runtime,
    effectiveConfig,
    sessionId,
    rootSessionId,
    dialogProcessId,
    allowUserInteraction,
    bridge,
    store,
    historyStore,
    maxAccessOutputChars,
  };
}

async function resolveRememberedConnectorInfo({
  historyStore = null,
  userId = "",
  rootSessionId = "",
  connectorType = "",
  connectorName = "",
} = {}) {
  if (
    !historyStore ||
    typeof historyStore.listSessionConnectors !== "function"
  ) {
    return {};
  }
  const normalizedUserId = String(userId || "").trim();
  const normalizedRootSessionId = String(rootSessionId || "").trim();
  const normalizedConnectorType = normalizeConnectorType(connectorType);
  const normalizedConnectorName = String(connectorName || "").trim();
  if (
    !normalizedUserId ||
    !normalizedRootSessionId ||
    !normalizedConnectorType ||
    !normalizedConnectorName
  ) {
    return {};
  }
  const groupedHistory = await historyStore.listSessionConnectors({
    userId: normalizedUserId,
    sessionId: normalizedRootSessionId,
  });
  const historyList = Array.isArray(groupedHistory?.[normalizedConnectorType])
    ? groupedHistory[normalizedConnectorType]
    : [];
  const hitConnector =
    historyList.find(
      (connectorItem) =>
        String(connectorItem?.connector_name || "").trim() ===
        normalizedConnectorName,
    ) || null;
  const defaults =
    hitConnector?.connection_defaults &&
    typeof hitConnector.connection_defaults === "object"
      ? hitConnector.connection_defaults
      : {};
  return collectNonSensitiveDefaults(defaults);
}

function buildAccessConnectorTool(context = {}) {
  const {
    runtime,
    effectiveConfig,
    store,
    historyStore,
    rootSessionId,
    allowUserInteraction,
    bridge,
    dialogProcessId,
    sessionId,
    maxAccessOutputChars,
  } = context;
  const resolveReconnectToolName = (connectorType = "") =>
    connectorType === "database"
      ? "database_connect_connector"
      : connectorType === "terminal"
        ? "terminal_connect_connector"
        : "email_connect_connector";
  const buildEmailAttachmentHandler = () => {
    const userId = String(runtime?.userId || "").trim();
    const attachmentService = runtime?.attachmentService || null;
    if (!userId || !attachmentService) return null;
    return async (artifacts = [], options = {}) => {
      const sourceArtifacts = Array.isArray(artifacts) ? artifacts : [];
      if (!sourceArtifacts.length) return [];
      const runtimeSessionId = String(
        runtime?.systemRuntime?.sessionId ||
          runtime?.systemRuntime?.rootSessionId ||
          "",
      ).trim();
      const generationSource = String(
        options?.generationSource || "email_connector_read",
      ).trim();
      const savedRecords =
        generationSource === "email_connector_read" &&
        typeof attachmentService.ingestEmailArtifacts === "function"
          ? await attachmentService.ingestEmailArtifacts({
              userId,
              sessionId: runtimeSessionId,
              artifacts: sourceArtifacts,
            })
          : await attachmentService.ingestGeneratedArtifacts({
              userId,
              sessionId: runtimeSessionId,
              attachmentSource:
                generationSource === "email_connector_read" ? "email" : "model",
              artifacts: sourceArtifacts,
              generationSource,
            });
      return (Array.isArray(savedRecords) ? savedRecords : []).map(
        (attachmentItem, attachmentIndex) => ({
          attachmentId: String(attachmentItem?.attachmentId || "").trim(),
          sessionId: String(attachmentItem?.sessionId || runtimeSessionId).trim(),
          attachmentSource: String(
            attachmentItem?.attachmentSource ||
              (generationSource === "email_connector_read" ? "email" : "model"),
          ).trim(),
          name: String(attachmentItem?.name || "").trim(),
          mimeType: String(
            attachmentItem?.mimeType || "application/octet-stream",
          ).trim(),
          size: Number(attachmentItem?.size || 0),
          generatedByModel: attachmentItem?.generatedByModel === true,
          generationSource: String(
            attachmentItem?.generationSource || generationSource,
          ).trim(),
          email_attachment_type: String(
            sourceArtifacts?.[attachmentIndex]?.email_attachment_type || "",
          ).trim(),
          email_content_id: String(
            sourceArtifacts?.[attachmentIndex]?.email_content_id || "",
          ).trim(),
          email_is_inline:
            sourceArtifacts?.[attachmentIndex]?.email_is_inline === true,
        }),
      );
    };
  };
  return {
    name: "access_connector",
    description:
      "访问已连接连接器。输入连接器名称、类型和命令，返回执行结果。仅可访问当前 session 绑定的连接器。",
    schemaShape: {
      connector_name: { description: "连接器名称（可选，留空时使用当前上下文勾选连接器）" },
      connector_type: { description: "连接器类型：database 或 terminal 或 email" },
      command: {
        description:
          "要执行的命令：database 为 SQL，terminal 为 shell，email 为 JSON（action=send|list|read）。",
      },
    },
    async func({ connector_name, connector_type, command }) {
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
      const connectorType = normalizeConnectorType(connector_type);
      if (!["database", "terminal", "email"].includes(connectorType)) {
        return toToolJsonResult("access_connector", {
          ok: false,
          error: "connector_type(database|terminal|email) required",
        });
      }
      const selectedConnectors =
        runtime?.systemRuntime?.config?.selectedConnectors &&
        typeof runtime.systemRuntime.config.selectedConnectors === "object"
          ? runtime.systemRuntime.config.selectedConnectors
          : {};
      const selectedConnectorName = String(selectedConnectors?.[connectorType] || "").trim();
      if (!selectedConnectorName) {
        return toToolJsonResult("access_connector", {
          ok: false,
          error: `当前上下文未勾选${connectorType}连接器，无法执行 access_connector`,
        });
      }
      const requestedConnectorName = String(connector_name || "").trim();
      if (
        requestedConnectorName &&
        requestedConnectorName !== selectedConnectorName
      ) {
        return toToolJsonResult("access_connector", {
          ok: false,
          error: `当前上下文仅允许使用已勾选连接器：${selectedConnectorName}`,
        });
      }
      const connectorName = selectedConnectorName;
      const connectedConnector = findConnectedConnector({
        store,
        rootSessionId,
        connectorName,
        connectorType,
      });
      if (!connectedConnector) {
        const configuredConnectionInfo = resolveConfiguredConnectorInfo({
          effectiveConfig,
          connectorName,
          connectorType,
        });
        const rememberedConnectionInfo = await resolveRememberedConnectorInfo({
          historyStore,
          userId: runtime?.userId || "",
          rootSessionId,
          connectorType,
          connectorName,
        });
        const connectionDefaults = {
          ...collectNonSensitiveDefaults(configuredConnectionInfo),
          ...rememberedConnectionInfo,
        };
        const reconnectToolName = resolveReconnectToolName(connectorType);
        const reconnectMessage = `当前已勾选连接器「${connectorName}」未连接，请先重新连接后再执行命令`;
        if (allowUserInteraction && bridge?.requestUserInteraction) {
          try {
            await bridge.requestUserInteraction({
              content: reconnectMessage,
              fields: [],
              dialogProcessId,
              requireEncryption: false,
              sessionId,
              toolName: reconnectToolName,
              connectorName,
              connectorType,
              interactionType: "connector_reconnect_required",
              interactionData: {
                connectorName,
                connectorType,
                reconnectToolName,
                defaultValues: connectionDefaults,
              },
            });
          } catch {}
        }
        return toToolJsonResult(
          "access_connector",
          {
            ok: false,
            status: "needs_reconnect",
            error: `selected connector not connected: ${connectorType}/${connectorName}`,
            message: reconnectMessage,
            reconnect_required: true,
            reconnect_tool: reconnectToolName,
            connector: {
              connector_name: connectorName,
              connector_type: connectorType,
            },
            default_values: connectionDefaults,
          },
          true,
        );
      }
      try {
        const result = await store.executeConnectorCommand({
          sessionId: rootSessionId,
          connectorName,
          connectorType,
          command: String(command || "").trim(),
          emailAttachmentHandler: buildEmailAttachmentHandler(),
        });
        runtime.connectorChannels = store.getSessionConnectors(rootSessionId);
        const executionFailedMessage = String(
          result?.output?.stderr || result?.output?.stdout || "",
        ).trim();
        return toToolJsonResult(
          "access_connector",
          {
            ok: result?.ok === true,
            status: result?.ok ? "completed" : "failed",
            message: result?.ok
              ? "执行完成"
              : `执行失败${executionFailedMessage ? `: ${executionFailedMessage}` : ""}`,
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
  };
}

export {
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
};
