/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Private Agent -> Service run callback contract.
 *
 * These are control/commit notifications, not domain events and not websocket
 * wire events. Domain facts carried by AUTHORITY_EVENT_COMMITTED are already
 * canonical Event Protocol envelopes persisted in the Authority Outbox.
 */
export const AGENT_RUN_EVENT = Object.freeze({
  AUTHORITY_EVENT_COMMITTED: "authority_event_committed",
  TURN_LIFECYCLE_COMMITTED: "turn_lifecycle_committed",
  TURN_COMMITTED: "turn_committed",
  TURN_ATTACHMENTS_BOUND: "turn_attachments_bound",
  LIFECYCLE_STATE_CHANGED: "agent_lifecycle_state_changed",
});

export const AGENT_RUN_EVENTS = Object.freeze(new Set(Object.values(AGENT_RUN_EVENT)));
