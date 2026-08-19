/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectors } from "@noobot/agent-config-protocol/enums";
import { mergeConnectorStatusItems } from "@noobot/agent-config-protocol/connector-status-projection";
import { tSystem } from "noobot-i18n/agent/system-text";
import { CONNECTOR_TYPE } from "@noobot/agent-config-protocol";
import { CONNECTOR_RUNTIME_STATUS } from "../../integrations/connectors/constants.js";
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
      String(connectorItem?.status || CONNECTOR_RUNTIME_STATUS.CONNECTED).trim() ||
      CONNECTOR_RUNTIME_STATUS.CONNECTED,
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
  return mergeConnectorStatusItems({
    runtimeConnectors,
    historyConnectors,
    connectedStatus: CONNECTOR_RUNTIME_STATUS.CONNECTED,
    connectedMessage: tSystem("connectors.statusOk"),
    disconnectedStatus: CONNECTOR_RUNTIME_STATUS.DISCONNECTED,
    disconnectedMessage: tSystem("status.disconnectedFromHistory"),
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
  const normalizedSelectedConnectors = normalizeSelectedConnectors(selectedConnectors);
  const buildCurrentConnectors = ({
    databaseSourceList = [],
    terminalSourceList = [],
    emailSourceList = [],
  } = {}) =>
    Object.fromEntries(
      Object.entries(normalizedSelectedConnectors).map(([connectorType, connectorName]) => [
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
      ]),
    );
  if (!normalizedRootSessionId || !connectorChannelStore) {
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
    connectorHistoryStore && typeof connectorHistoryStore.listSessionConnectors === "function"
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
  const compactEmails = mergedEmails.map((connectorItem) => toCompactConnectorInfo(connectorItem));
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
