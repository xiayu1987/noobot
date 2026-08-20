/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { createConnectorPanelState } from "../../../modules/session/model/sessionModel.js";

export function createConnectorService({
  ensureConnected = () => false,
  getSessionConnectorsApi,
  putSessionConnectorSelectionApi,
  userId,
  authFetch,
  translateText = (key = "") => String(key || ""),
} = {}) {
  const refreshTasks = new Map();

  function applySessionConnectorPayload(sessionItem, payload = {}) {
    if (!sessionItem) return;
    sessionItem.connectorPanelState = createConnectorPanelState({
      rootSessionId: payload?.sessionId,
      connectors: Array.isArray(payload?.connectors) ? payload.connectors : [],
      selectedConnectorIds: payload?.selectedConnectorIds,
    });
  }

  async function refreshSessionConnectors({ sessionId = "", sessions = [] } = {}) {
    if (!ensureConnected()) return;
    const normalizedSessionId = String(sessionId || "").trim();
    const sessionItem = sessions.find((item) => item?.sessionId === normalizedSessionId);
    if (!normalizedSessionId || !sessionItem) return;
    const response = await getSessionConnectorsApi(
      { userId: userId?.value, sessionId: normalizedSessionId },
      { fetcher: authFetch },
    );
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.error || translateText("infra.connectorStatusFetchFailed"));
    }
    applySessionConnectorPayload(sessionItem, payload);
  }

  function refreshSessionConnectorsAsync(options = {}) {
    const sessionId = String(options.sessionId || "").trim();
    if (!sessionId) return Promise.resolve();
    if (refreshTasks.has(sessionId)) return refreshTasks.get(sessionId);
    const task = refreshSessionConnectors(options).finally(() => refreshTasks.delete(sessionId));
    refreshTasks.set(sessionId, task);
    return task;
  }

  async function updateSessionSelectedConnectors({
    activeSession,
    selectedConnectorIds = [],
  } = {}) {
    if (!activeSession?.sessionId) return false;
    const normalizedIds = normalizeSelectedConnectorIds(selectedConnectorIds);
    if (activeSession.isLocal === true) {
      activeSession.connectorPanelState = createConnectorPanelState({
        ...activeSession.connectorPanelState,
        rootSessionId: activeSession.sessionId,
        selectedConnectorIds: normalizedIds,
      });
      return true;
    }
    const response = await putSessionConnectorSelectionApi(
      {
        userId: userId?.value,
        sessionId: activeSession.sessionId,
        selectedConnectorIds: normalizedIds,
      },
      { fetcher: authFetch },
    );
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.error || translateText("common.updateConnectorFailed"));
    }
    activeSession.connectorPanelState = createConnectorPanelState({
      ...activeSession.connectorPanelState,
      selectedConnectorIds: payload.selectedConnectorIds,
    });
    return true;
  }

  return {
    applySessionConnectorPayload,
    refreshSessionConnectors,
    refreshSessionConnectorsAsync,
    updateSessionSelectedConnectors,
  };
}
