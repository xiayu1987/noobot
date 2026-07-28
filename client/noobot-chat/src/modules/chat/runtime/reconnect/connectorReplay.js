/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function applyReconnectConnectorStatus({
  eventData,
  activeSession,
  connectorTypeSet,
  resolveConnectorStatusPayload,
  upsertConnectedConnectorInPanelState,
  refreshSessionConnectorsAsync,
} = {}) {
  const { connectorType, connectorName, status } =
    resolveConnectorStatusPayload?.(eventData) || {};
  if (
    connectorTypeSet?.has?.(connectorType) &&
    connectorName &&
    typeof upsertConnectedConnectorInPanelState === "function"
  ) {
    upsertConnectedConnectorInPanelState(activeSession?.value, {
      connectorType,
      connectorName,
      status,
    });
    if (typeof refreshSessionConnectorsAsync === "function") {
      refreshSessionConnectorsAsync(activeSession?.value?.id || "");
    }
  }
}
