/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { CONNECTOR_TYPES } from "../../shared/constants/chatConstants";
import {
  createConnectorPanelState,
  normalizeSelectedConnectors,
  resolveSelectedConnectorsWithDefaults,
} from "../../shared/models/sessionModel";

function normalizeConnectorType(connectorType = "") {
  return String(connectorType || "").trim();
}

function normalizeConnectorGroupItems(connectors = []) {
  const sourceItems = Array.isArray(connectors) ? connectors : [];
  return sourceItems.map((connectorItem) => ({
    connectorName: String(
      connectorItem?.connector_name || connectorItem?.connectorName || "",
    ).trim(),
    connectorType: String(
      connectorItem?.connector_type || connectorItem?.connectorType || "",
    ).trim(),
    status: String(connectorItem?.status || "unknown").trim(),
    statusCode: Number(connectorItem?.status_code ?? connectorItem?.statusCode ?? 0),
    statusMessage: String(
      connectorItem?.status_message || connectorItem?.statusMessage || "",
    ).trim(),
    checkedAt: String(connectorItem?.checked_at || connectorItem?.checkedAt || "").trim(),
    connectionMeta:
      connectorItem?.connection_meta && typeof connectorItem.connection_meta === "object"
        ? connectorItem.connection_meta
        : connectorItem?.connectionMeta && typeof connectorItem.connectionMeta === "object"
          ? connectorItem.connectionMeta
          : {},
  }));
}

export function createConnectorService({
  ensureConnected = () => false,
  getSessionConnectorsApi,
  userId,
  authFetch,
  translateText = (key = "") => String(key || ""),
} = {}) {
  const connectorRefreshTasksBySessionId = new Map();
  const connectorTypeSet = new Set(CONNECTOR_TYPES);

  function applySessionConnectorPayload(sessionItem, payload = {}) {
    if (!sessionItem) return;
    const currentSelectedConnectors = normalizeSelectedConnectors(
      sessionItem?.connectorPanelState?.selectedConnectors || {},
    );
    const selectedSource =
      payload?.selectedConnectors && typeof payload.selectedConnectors === "object"
        ? payload.selectedConnectors
        : payload?.selected_connectors && typeof payload.selected_connectors === "object"
          ? payload.selected_connectors
          : {};
    const nextGroups = {
      database: normalizeConnectorGroupItems(
        payload?.connectors?.databases || payload?.groups?.database || [],
      ),
      terminal: normalizeConnectorGroupItems(
        payload?.connectors?.terminals || payload?.groups?.terminal || [],
      ),
      email: normalizeConnectorGroupItems(
        payload?.connectors?.emails || payload?.groups?.email || [],
      ),
    };
    const nextSelectedConnectors = resolveSelectedConnectorsWithDefaults({
      groups: nextGroups,
      selectedConnectors: {
        ...currentSelectedConnectors,
        ...normalizeSelectedConnectors(selectedSource),
      },
    });
    sessionItem.connectorPanelState = createConnectorPanelState({
      rootSessionId:
        payload?.rootSessionId || payload?.root_session_id || payload?.sessionId || "",
      groups: nextGroups,
      selectedConnectors: nextSelectedConnectors,
    });
  }

  function upsertConnectedConnectorInPanelState(
    sessionItem,
    {
      connectorType = "",
      connectorName = "",
      status = "connected",
    } = {},
  ) {
    if (!sessionItem) return;
    const normalizedConnectorType = normalizeConnectorType(connectorType);
    const normalizedConnectorName = String(connectorName || "").trim();
    if (!connectorTypeSet.has(normalizedConnectorType) || !normalizedConnectorName) {
      return;
    }
    const panelState =
      sessionItem.connectorPanelState &&
      typeof sessionItem.connectorPanelState === "object"
        ? sessionItem.connectorPanelState
        : createConnectorPanelState();
    const groupItems = Array.isArray(panelState?.groups?.[normalizedConnectorType])
      ? [...panelState.groups[normalizedConnectorType]]
      : [];
    const hitIndex = groupItems.findIndex(
      (connectorItem) =>
        String(connectorItem?.connectorName || "").trim() === normalizedConnectorName,
    );
    const connectorStatus = String(status || "connected").trim() || "connected";
    const nextConnectorItem = {
      connectorName: normalizedConnectorName,
      connectorType: normalizedConnectorType,
      status: connectorStatus,
      statusCode: connectorStatus === "connected" ? 0 : 1,
      statusMessage: connectorStatus,
      checkedAt: new Date().toISOString(),
      connectionMeta: {},
    };
    if (hitIndex >= 0) {
      groupItems[hitIndex] = {
        ...groupItems[hitIndex],
        ...nextConnectorItem,
      };
    } else {
      groupItems.push(nextConnectorItem);
    }
    const selectedConnectors = normalizeSelectedConnectors(
      panelState?.selectedConnectors || {},
    );
    const nextSelectedConnectors = {
      ...selectedConnectors,
      [normalizedConnectorType]: normalizedConnectorName,
    };
    sessionItem.connectorPanelState = createConnectorPanelState({
      ...panelState,
      groups: {
        database: Array.isArray(panelState?.groups?.database)
          ? panelState.groups.database
          : [],
        terminal: Array.isArray(panelState?.groups?.terminal)
          ? panelState.groups.terminal
          : [],
        email: Array.isArray(panelState?.groups?.email)
          ? panelState.groups.email
          : [],
        [normalizedConnectorType]: groupItems,
      },
      selectedConnectors: nextSelectedConnectors,
    });
  }

  async function refreshSessionConnectors({ sessionId = "", sessions = [] } = {}) {
    if (!ensureConnected()) return;
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return;
    const sessionItem = (Array.isArray(sessions) ? sessions : []).find(
      (candidateSessionItem) =>
        String(candidateSessionItem?.id || "").trim() === normalizedSessionId,
    );
    if (!sessionItem) return;
    try {
      const response = await getSessionConnectorsApi(
        {
          userId: userId?.value,
          sessionId:
            sessionItem.backendSessionId || sessionItem.id || normalizedSessionId,
        },
        { fetcher: authFetch },
      );
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true) {
        throw new Error(
          payload?.error || translateText("infra.connectorStatusFetchFailed"),
        );
      }
      applySessionConnectorPayload(sessionItem, payload);
    } catch (error) {
      console.warn("refresh session connectors failed", error);
      sessionItem.connectorPanelState = createConnectorPanelState(
        sessionItem.connectorPanelState || {},
      );
    }
  }

  function refreshSessionConnectorsAsync({ sessionId = "", sessions = [] } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return Promise.resolve();
    const pendingTask = connectorRefreshTasksBySessionId.get(normalizedSessionId);
    if (pendingTask) return pendingTask;
    const taskPromise = (async () => {
      try {
        await refreshSessionConnectors({
          sessionId: normalizedSessionId,
          sessions,
        });
      } finally {
        connectorRefreshTasksBySessionId.delete(normalizedSessionId);
      }
    })();
    connectorRefreshTasksBySessionId.set(normalizedSessionId, taskPromise);
    return taskPromise;
  }

  async function updateSessionSelectedConnector({
    activeSession,
    connectorType = "",
    connectorName = "",
  } = {}) {
    if (!activeSession) return false;
    const normalizedType = normalizeConnectorType(connectorType);
    if (!connectorTypeSet.has(normalizedType)) return false;
    const normalizedName = String(connectorName || "").trim();
    const currentSelectedConnectors = normalizeSelectedConnectors(
      activeSession.connectorPanelState?.selectedConnectors || {},
    );
    const nextSelectedConnectors = {
      ...currentSelectedConnectors,
      [normalizedType]: normalizedName,
    };
    activeSession.connectorPanelState = createConnectorPanelState({
      ...(activeSession.connectorPanelState || {}),
      selectedConnectors: normalizeSelectedConnectors(nextSelectedConnectors),
    });
    return true;
  }

  return {
    connectorTypeSet,
    normalizeConnectorType,
    createConnectorPanelState,
    applySessionConnectorPayload,
    upsertConnectedConnectorInPanelState,
    refreshSessionConnectors,
    refreshSessionConnectorsAsync,
    updateSessionSelectedConnector,
  };
}
