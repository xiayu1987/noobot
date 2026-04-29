/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function normalizeHistoryConnectorItems(items = []) {
  return (Array.isArray(items) ? items : []).map((connectorItem) => ({
    connector_name: String(connectorItem?.connector_name || "").trim(),
    connector_type: String(connectorItem?.connector_type || "").trim(),
    connected_at: String(connectorItem?.last_connected_at || "").trim(),
    connection_meta:
      connectorItem?.connection_meta && typeof connectorItem.connection_meta === "object"
        ? connectorItem.connection_meta
        : {},
    status: String(connectorItem?.status || "disconnected").trim() || "disconnected",
    status_code: Number(connectorItem?.status_code ?? 410),
    status_message:
      String(connectorItem?.status_message || "").trim() || "未连接（历史记录）",
    checked_at:
      String(connectorItem?.checked_at || connectorItem?.last_connected_at || "").trim(),
    last_connected_at: String(connectorItem?.last_connected_at || "").trim(),
    connect_count: Number(connectorItem?.connect_count || 0),
    connection_defaults:
      connectorItem?.connection_defaults &&
      typeof connectorItem.connection_defaults === "object"
        ? connectorItem.connection_defaults
        : {},
  }));
}

function normalizeRuntimeConnectorItems(items = [], connectorType = "") {
  const normalizedConnectorType = String(connectorType || "").trim();
  return (Array.isArray(items) ? items : []).map((connectorItem) => ({
    connector_name: String(
      connectorItem?.connector_name || connectorItem?.connectorName || "",
    ).trim(),
    connector_type:
      String(
        connectorItem?.connector_type ||
          connectorItem?.connectorType ||
          normalizedConnectorType,
      ).trim() || normalizedConnectorType,
    connected_at: String(
      connectorItem?.connected_at || connectorItem?.connectedAt || "",
    ).trim(),
    connection_meta:
      connectorItem?.connection_meta && typeof connectorItem.connection_meta === "object"
        ? connectorItem.connection_meta
        : connectorItem?.connectionMeta && typeof connectorItem.connectionMeta === "object"
          ? connectorItem.connectionMeta
          : {},
    status: String(connectorItem?.status || "connected").trim() || "connected",
    status_code: Number(connectorItem?.status_code ?? connectorItem?.statusCode ?? 0),
    status_message:
      String(
        connectorItem?.status_message || connectorItem?.statusMessage || "ok",
      ).trim() || "ok",
    checked_at: String(
      connectorItem?.checked_at ||
        connectorItem?.checkedAt ||
        connectorItem?.connected_at ||
        connectorItem?.connectedAt ||
        "",
    ).trim(),
  }));
}

function mergeRuntimeAndHistoryConnectorGroup({
  runtimeConnectors = [],
  historyConnectors = [],
} = {}) {
  const runtimeList = Array.isArray(runtimeConnectors) ? runtimeConnectors : [];
  const historyList = normalizeHistoryConnectorItems(historyConnectors);
  const mergedByName = new Map();
  for (const historyItem of historyList) {
    const connectorName = String(historyItem?.connector_name || "").trim();
    if (!connectorName) continue;
    mergedByName.set(connectorName, historyItem);
  }
  for (const runtimeItem of runtimeList) {
    const connectorName = String(runtimeItem?.connector_name || "").trim();
    if (!connectorName) continue;
    const previousItem = mergedByName.get(connectorName) || {};
    mergedByName.set(connectorName, {
      ...previousItem,
      ...runtimeItem,
      status: String(runtimeItem?.status || "connected").trim() || "connected",
      status_code: Number(runtimeItem?.status_code ?? 0),
      status_message: String(runtimeItem?.status_message || "ok").trim(),
      checked_at:
        String(runtimeItem?.checked_at || runtimeItem?.connected_at || "").trim() ||
        String(previousItem?.checked_at || "").trim(),
      last_connected_at:
        String(runtimeItem?.connected_at || "").trim() ||
        String(previousItem?.last_connected_at || "").trim(),
    });
  }
  return Array.from(mergedByName.values()).sort((leftConnector, rightConnector) => {
    const leftTime = new Date(
      leftConnector?.last_connected_at || leftConnector?.checked_at || 0,
    ).getTime();
    const rightTime = new Date(
      rightConnector?.last_connected_at || rightConnector?.checked_at || 0,
    ).getTime();
    return rightTime - leftTime;
  });
}

function resolveConnectorSubType(connectorItem = {}) {
  const connectionMeta =
    connectorItem?.connection_meta && typeof connectorItem.connection_meta === "object"
      ? connectorItem.connection_meta
      : {};
  const subTypeCandidates = [
    connectionMeta?.databaseType,
    connectionMeta?.database_type,
    connectionMeta?.terminalType,
    connectionMeta?.terminal_type,
    connectionMeta?.emailType,
    connectionMeta?.email_type,
    connectionMeta?.subType,
    connectionMeta?.sub_type,
  ];
  for (const subTypeCandidate of subTypeCandidates) {
    const normalizedSubType = String(subTypeCandidate || "").trim();
    if (normalizedSubType) return normalizedSubType;
  }
  const connectorType = String(connectorItem?.connector_type || "").trim();
  if (connectorType === "email") return "smtp_imap";
  return "";
}

function toCompactConnectorInfo(connectorItem = {}) {
  return {
    connector_name: String(connectorItem?.connector_name || "").trim(),
    connector_type: String(connectorItem?.connector_type || "").trim(),
    connector_sub_type: resolveConnectorSubType(connectorItem),
  };
}

function buildSelectedCompactConnector({
  connectorType = "",
  connectorName = "",
  sourceList = [],
} = {}) {
  const normalizedConnectorType = String(connectorType || "").trim();
  const normalizedConnectorName = String(connectorName || "").trim();
  if (!normalizedConnectorName) return null;
  const hitConnector =
    (Array.isArray(sourceList) ? sourceList : []).find(
      (connectorItem) =>
        String(connectorItem?.connector_name || "").trim() === normalizedConnectorName,
    ) || null;
  return {
    connector_name: normalizedConnectorName,
    connector_type: normalizedConnectorType,
    connector_sub_type: String(hitConnector?.connector_sub_type || "").trim(),
  };
}

function normalizeSelectedConnectors(selectedConnectors = {}) {
  const source =
    selectedConnectors && typeof selectedConnectors === "object"
      ? selectedConnectors
      : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([connectorType, connectorName]) => [
        String(connectorType || "").trim(),
        String(connectorName || "").trim(),
      ])
      .filter(([connectorType]) => Boolean(connectorType)),
  );
}

export async function resolveConnectorStatusSection({
  rootSessionId = "",
  userId = "",
  selectedConnectors = {},
  connectorChannelStore = null,
  connectorHistoryStore = null,
} = {}) {
  const normalizedRootSessionId = String(rootSessionId || "").trim();
  const normalizedSelectedConnectors = normalizeSelectedConnectors(
    selectedConnectors,
  );
  const buildCurrentConnectors = ({
    databaseSourceList = [],
    terminalSourceList = [],
    emailSourceList = [],
  } = {}) =>
    Object.fromEntries(
      Object.entries(normalizedSelectedConnectors).map(
        ([connectorType, connectorName]) => [
          connectorType,
          buildSelectedCompactConnector({
            connectorType,
            connectorName,
            sourceList:
              connectorType === "database"
                ? databaseSourceList
                : connectorType === "terminal"
                  ? terminalSourceList
                  : connectorType === "email"
                    ? emailSourceList
                    : [],
          }),
        ],
      ),
    );
  if (
    !normalizedRootSessionId ||
    !connectorChannelStore
  ) {
    return {
      root_session_id: normalizedRootSessionId,
      connectors: { databases: [], terminals: [], emails: [] },
      current_connectors: buildCurrentConnectors(),
    };
  }
  const runtimeConnectorSnapshot =
    typeof connectorChannelStore.getSessionConnectors === "function"
      ? connectorChannelStore.getSessionConnectors(normalizedRootSessionId)
      : { databases: [], terminals: [], emails: [] };
  const runtimeDatabases = normalizeRuntimeConnectorItems(
    runtimeConnectorSnapshot?.databases || [],
    "database",
  );
  const runtimeTerminals = normalizeRuntimeConnectorItems(
    runtimeConnectorSnapshot?.terminals || [],
    "terminal",
  );
  const runtimeEmails = normalizeRuntimeConnectorItems(
    runtimeConnectorSnapshot?.emails || [],
    "email",
  );
  const historyConnectors =
    connectorHistoryStore &&
    typeof connectorHistoryStore.listSessionConnectors === "function"
      ? await connectorHistoryStore.listSessionConnectors({
          userId,
          sessionId: normalizedRootSessionId,
        })
      : { database: [], terminal: [], email: [] };
  const mergedDatabases = mergeRuntimeAndHistoryConnectorGroup({
    runtimeConnectors: runtimeDatabases,
    historyConnectors: historyConnectors?.database || [],
  });
  const mergedTerminals = mergeRuntimeAndHistoryConnectorGroup({
    runtimeConnectors: runtimeTerminals,
    historyConnectors: historyConnectors?.terminal || [],
  });
  const mergedEmails = mergeRuntimeAndHistoryConnectorGroup({
    runtimeConnectors: runtimeEmails,
    historyConnectors: historyConnectors?.email || [],
  });
  const compactDatabases = mergedDatabases.map((connectorItem) =>
    toCompactConnectorInfo(connectorItem),
  );
  const compactTerminals = mergedTerminals.map((connectorItem) =>
    toCompactConnectorInfo(connectorItem),
  );
  const compactEmails = mergedEmails.map((connectorItem) =>
    toCompactConnectorInfo(connectorItem),
  );
  return {
    root_session_id: normalizedRootSessionId,
    connectors: {
      databases: compactDatabases,
      terminals: compactTerminals,
      emails: compactEmails,
    },
    current_connectors: buildCurrentConnectors({
      databaseSourceList: compactDatabases,
      terminalSourceList: compactTerminals,
      emailSourceList: compactEmails,
    }),
  };
}
