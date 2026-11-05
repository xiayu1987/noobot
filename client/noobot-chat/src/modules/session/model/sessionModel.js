/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSecureUuid } from "@noobot/shared/secure-identity";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { text } from "@noobot/shared/value";

export function createConnectorPanelState(overrides = {}) {
  return {
    rootSessionId: text(overrides?.rootSessionId),
    connectors: Array.isArray(overrides?.connectors) ? overrides.connectors : [],
    selectedConnectorIds: normalizeSelectedConnectorIds(overrides?.selectedConnectorIds),
  };
}

export function generateSessionId() {
  return createSecureUuid();
}
