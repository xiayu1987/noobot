/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { _trimStr } from "./utils";
import { applyReconnectInteractionRequest } from "./interactionReplay";
import { applyReconnectConnectorStatus } from "./connectorReplay";

export function tryAutoResolveReconnectInteraction({
  rawRequest = {},
  activeSession,
  interactionSubmitting,
  connectorTypeSet,
  normalizeInteractionRequestPayload,
  isAutoResolvedInteraction,
  resolveConnectorConnectedPayload,
  upsertConnectedConnectorInPanelState,
  refreshSessionConnectorsAsync,
  clearPendingInteraction,
} = {}) {
  const request = normalizeInteractionRequestPayload?.(rawRequest || {}) || rawRequest || {};
  if (!isAutoResolvedInteraction?.(request)) return false;
  if (_trimStr(request?.interactionType) === "connector_connected") {
    const { connectorType, connectorName, status } = resolveConnectorConnectedPayload?.(request) || {};
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
  clearPendingInteraction?.(request);
  if (interactionSubmitting?.value !== undefined) {
    interactionSubmitting.value = false;
  }
  return true;
}

export function createReconnectInteractionEnvelopeCallbacks({
  buildReconnectReplayEnvelopeCallbacks,
  missingInteractionPayloadTimers,
  normalizeInteractionRequestPayload,
  tryAutoResolveInteraction,
  isInteractionRequestHandled,
  setPendingInteractionRequest,
  activeSession,
  connectorTypeSet,
  resolveConnectorStatusPayload,
  upsertConnectedConnectorInPanelState,
  refreshSessionConnectorsAsync,
  onAttachments,
  onDoneMessages,
} = {}) {
  return buildReconnectReplayEnvelopeCallbacks({
    onInteractionRequest: (eventData) => {
      applyReconnectInteractionRequest({
        eventData,
        missingInteractionPayloadTimers,
        normalizeInteractionRequestPayload,
        tryAutoResolveInteraction,
        isInteractionRequestHandled,
        setPendingInteractionRequest,
      });
    },
    onConnectorStatus: (eventData) => {
      applyReconnectConnectorStatus({
        eventData,
        activeSession,
        connectorTypeSet,
        resolveConnectorStatusPayload,
        upsertConnectedConnectorInPanelState,
        refreshSessionConnectorsAsync,
      });
    },
    onAttachments,
    onDoneMessages,
  });
}
