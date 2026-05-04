/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createConnectorService } from "../../services/connector/connectorService";
import { useLocale } from "../../shared/i18n/useLocale";

export function useConnectorPanel({
  ensureConnected,
  getSessionConnectorsApi,
  userId,
  authFetch,
  sessions,
  activeSession,
} = {}) {
  const { t } = useLocale();
  const connectorService = createConnectorService({
    ensureConnected,
    getSessionConnectorsApi,
    userId,
    authFetch,
    t,
  });

  function applySessionConnectorPayload(sessionItem, payload = {}) {
    return connectorService.applySessionConnectorPayload(sessionItem, payload);
  }

  function upsertConnectedConnectorInPanelState(
    sessionItem,
    {
      connectorType = "",
      connectorName = "",
      status = "connected",
    } = {},
  ) {
    return connectorService.upsertConnectedConnectorInPanelState(sessionItem, {
      connectorType,
      connectorName,
      status,
    });
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

  async function updateSessionSelectedConnector({
    connectorType = "",
    connectorName = "",
  } = {}) {
    return connectorService.updateSessionSelectedConnector({
      activeSession: activeSession?.value,
      connectorType,
      connectorName,
    });
  }

  return {
    connectorTypeSet: connectorService.connectorTypeSet,
    applySessionConnectorPayload,
    upsertConnectedConnectorInPanelState,
    refreshSessionConnectors,
    refreshSessionConnectorsAsync,
    updateSessionSelectedConnector,
  };
}
