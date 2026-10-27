/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { createConnectorPanelState } from "../../../modules/session/model/sessionModel.js";
import { requireFunctionDependencies, text } from "@noobot/shared/value";
import { readApiResponseEnvelope } from "@noobot/shared/request-error";

export function createConnectorService({
  ensureConnected,
  listUserConnectorsApi,
  getSessionConnectorsApi,
  putSessionConnectorSelectionApi,
  userId,
  authFetch,
}) {
  requireFunctionDependencies("createConnectorService", {
    ensureConnected,
    listUserConnectorsApi,
    getSessionConnectorsApi,
    putSessionConnectorSelectionApi,
    authFetch,
  });
  const sessionTasks = new Map();

  function applyPersistedSessionConnectorPayload(sessionItem, payload = {}) {
    if (!sessionItem) return;
    sessionItem.connectorPanelState = createConnectorPanelState({
      rootSessionId: payload?.sessionId,
      connectors: Array.isArray(payload?.connectors) ? payload.connectors : [],
      selectedConnectorIds: payload?.selectedConnectorIds,
    });
  }

  function applyLocalConnectorCatalog(sessionItem, payload = {}) {
    if (!sessionItem) return;
    sessionItem.connectorPanelState = createConnectorPanelState({
      ...sessionItem.connectorPanelState,
      rootSessionId: sessionItem.sessionId,
      connectors: Array.isArray(payload?.connectors) ? payload.connectors : [],
    });
  }

  function enqueueSessionTask(sessionId = "", operation) {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId || typeof operation !== "function") return Promise.resolve();
    const previous = sessionTasks.get(normalizedSessionId) || Promise.resolve();
    const task = previous.then(operation).finally(() => {
      if (sessionTasks.get(normalizedSessionId) === task) {
        sessionTasks.delete(normalizedSessionId);
      }
    });
    sessionTasks.set(normalizedSessionId, task);
    return task;
  }

  async function refreshSessionConnectors({ sessionId = "", sessions = [] } = {}) {
    if (!ensureConnected()) return;
    const normalizedSessionId = text(sessionId);
    const sessionItem = sessions.find((item) => item?.sessionId === normalizedSessionId);
    if (!normalizedSessionId || !sessionItem) return;
    return enqueueSessionTask(normalizedSessionId, async () => {
      const response =
        sessionItem.isLocal === true
          ? await listUserConnectorsApi({ userId: userId?.value, fetcher: authFetch })
          : await getSessionConnectorsApi(
              { userId: userId?.value, sessionId: normalizedSessionId },
              { fetcher: authFetch },
            );
      const payload = await readApiResponseEnvelope(response);
      if (sessionItem.isLocal === true) applyLocalConnectorCatalog(sessionItem, payload);
      else applyPersistedSessionConnectorPayload(sessionItem, payload);
    });
  }

  function refreshSessionConnectorsAsync(options = {}) {
    const sessionId = text(options.sessionId);
    if (!sessionId) return Promise.resolve();
    return refreshSessionConnectors(options);
  }

  async function updateSessionSelectedConnectors({ activeSession, selectedConnectorIds }) {
    const normalizedIds = normalizeSelectedConnectorIds(selectedConnectorIds);
    if (activeSession.isLocal === true) {
      activeSession.connectorPanelState = createConnectorPanelState({
        ...activeSession.connectorPanelState,
        rootSessionId: activeSession.sessionId,
        selectedConnectorIds: normalizedIds,
      });
      return true;
    }
    const sessionId = String(activeSession.sessionId).trim();
    return enqueueSessionTask(sessionId, async () => {
      const response = await putSessionConnectorSelectionApi(
        {
          userId: userId?.value,
          sessionId,
          selectedConnectorIds: normalizedIds,
        },
        { fetcher: authFetch },
      );
      const payload = await readApiResponseEnvelope(response);
      activeSession.connectorPanelState = createConnectorPanelState({
        ...activeSession.connectorPanelState,
        selectedConnectorIds: payload.selectedConnectorIds,
      });
      return true;
    });
  }

  function waitForSessionConnectorState(sessionId = "") {
    const normalizedSessionId = text(sessionId);
    return normalizedSessionId ? sessionTasks.get(normalizedSessionId) : undefined;
  }

  return {
    refreshSessionConnectors,
    refreshSessionConnectorsAsync,
    updateSessionSelectedConnectors,
    waitForSessionConnectorState,
  };
}
