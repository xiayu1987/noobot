/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { safeNum, normalizeSelectedConnectors } from "../../utils/shared-utils.js";
import { tSystem } from "../../i18n/system-text.js";
import { CONNECTOR_TYPE } from "../../config/core/enums.js";
import { CONNECTOR_RUNTIME_STATUS } from "../../connectors/constants.js";
function normalizeHistoryConnectorItems(items = []) {
  return (Array.isArray(items) ? items : []).map((connectorItem) => ({
    connector_name: String(connectorItem?.connector_name || "").trim(),
    connector_type: String(connectorItem?.connector_type || "").trim(),
    connected_at: String(connectorItem?.last_connected_at || "").trim(),
    connection_meta:
      connectorItem?.connection_meta && typeof connectorItem.connection_meta === "object"
        ? connectorItem.connection_meta
        : {},
    status:
      String(
        connectorItem?.status || CONNECTOR_RUNTIME_STATUS.DISCONNECTED,
      ).trim() || CONNECTOR_RUNTIME_STATUS.DISCONNECTED,
    status_code: Number(connectorItem?.status_code ?? 410),
    status_message:
      String(connectorItem?.status_message || "").trim() ||
      tSystem("status.disconnectedFromHistory"),
    checked_at:
      String(connectorItem?.checked_at || connectorItem?.last_connected_at || "").trim(),
    last_connected_at: String(connectorItem?.last_connected_at || "").trim(),
    connect_count: safeNum(connectorItem?.connect_count),
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
    connector_name: String(connectorItem?.connectorName || "").trim(),
    connector_type:
      String(connectorItem?.connectorType || normalizedConnectorType).trim() ||
      normalizedConnectorType,
    connected_at: String(connectorItem?.connectedAt || "").trim(),
    connection_meta:
      connectorItem?.connectionMeta && typeof connectorItem.connectionMeta === "object"
        ? connectorItem.connectionMeta
        : {},
    status:
      String(
        connectorItem?.status || CONNECTOR_RUNTIME_STATUS.CONNECTED,
      ).trim() || CONNECTOR_RUNTIME_STATUS.CONNECTED,
    status_code: Number(connectorItem?.statusCode ?? 0),
    status_message:
      String(connectorItem?.statusMessage || tSystem("connectors.statusOk")).trim() ||
      tSystem("connectors.statusOk"),
    checked_at: String(connectorItem?.checkedAt || connectorItem?.connectedAt || "").trim(),
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
      status:
        String(
          runtimeItem?.status || CONNECTOR_RUNTIME_STATUS.CONNECTED,
        ).trim() || CONNECTOR_RUNTIME_STATUS.CONNECTED,
      status_code: Number(runtimeItem?.status_code ?? 0),
      status_message: String(runtimeItem?.status_message || tSystem("connectors.statusOk")).trim(),
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
    connectionMeta?.terminalType,
    connectionMeta?.emailType,
    connectionMeta?.subType,
  ];
  for (const subTypeCandidate of subTypeCandidates) {
    const normalizedSubType = String(subTypeCandidate || "").trim();
    if (normalizedSubType) return normalizedSubType;
  }
  const connectorType = String(connectorItem?.connector_type || "").trim();
  if (connectorType === CONNECTOR_TYPE.EMAIL) return "smtp_imap";
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
              connectorType === CONNECTOR_TYPE.DATABASE
                ? databaseSourceList
                : connectorType === CONNECTOR_TYPE.TERMINAL
                  ? terminalSourceList
                  : connectorType === CONNECTOR_TYPE.EMAIL
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
    CONNECTOR_TYPE.DATABASE,
  );
  const runtimeTerminals = normalizeRuntimeConnectorItems(
    runtimeConnectorSnapshot?.terminals || [],
    CONNECTOR_TYPE.TERMINAL,
  );
  const runtimeEmails = normalizeRuntimeConnectorItems(
    runtimeConnectorSnapshot?.emails || [],
    CONNECTOR_TYPE.EMAIL,
  );
  const historyConnectors =
    connectorHistoryStore &&
    typeof connectorHistoryStore.listSessionConnectors === "function"
      ? await connectorHistoryStore.listSessionConnectors({
          userId,
          sessionId: normalizedRootSessionId,
        })
      : {
          [CONNECTOR_TYPE.DATABASE]: [],
          [CONNECTOR_TYPE.TERMINAL]: [],
          [CONNECTOR_TYPE.EMAIL]: [],
        };
  const mergedDatabases = mergeRuntimeAndHistoryConnectorGroup({
    runtimeConnectors: runtimeDatabases,
    historyConnectors: historyConnectors?.[CONNECTOR_TYPE.DATABASE] || [],
  });
  const mergedTerminals = mergeRuntimeAndHistoryConnectorGroup({
    runtimeConnectors: runtimeTerminals,
    historyConnectors: historyConnectors?.[CONNECTOR_TYPE.TERMINAL] || [],
  });
  const mergedEmails = mergeRuntimeAndHistoryConnectorGroup({
    runtimeConnectors: runtimeEmails,
    historyConnectors: historyConnectors?.[CONNECTOR_TYPE.EMAIL] || [],
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
