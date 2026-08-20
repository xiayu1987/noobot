/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createConnectorService } from "../../../infrastructure/api/connectors/connectorService.js";
import { useLocale } from "../../../shared/i18n/useLocale.js";

export function useConnectorPanel({
  ensureConnected,
  getSessionConnectorsApi,
  putSessionConnectorSelectionApi,
  userId,
  authFetch,
  sessions,
  activeSession,
} = {}) {
  const { translate } = useLocale();
  const connectorService = createConnectorService({
    ensureConnected,
    getSessionConnectorsApi,
    putSessionConnectorSelectionApi,
    userId,
    authFetch,
    translateText: translate,
  });

  function applySessionConnectorPayload(sessionItem, payload = {}) {
    return connectorService.applySessionConnectorPayload(sessionItem, payload);
  }

  async function refreshSessionConnectors(sessionId = "") {
    return connectorService.refreshSessionConnectors({
      sessionId,
      sessions: sessions?.value,
    });
  }

  function refreshSessionConnectorsAsync(sessionId = "") {
    return connectorService.refreshSessionConnectorsAsync({
      sessionId,
      sessions: sessions?.value,
    });
  }

  async function updateSessionSelectedConnectors(selectedConnectorIds = []) {
    return connectorService.updateSessionSelectedConnectors({
      activeSession: activeSession?.value,
      selectedConnectorIds,
    });
  }

  return {
    applySessionConnectorPayload,
    refreshSessionConnectors,
    refreshSessionConnectorsAsync,
    updateSessionSelectedConnectors,
  };
}
