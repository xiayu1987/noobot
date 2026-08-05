/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import { TURN_LIFECYCLE_PROTOCOL_VERSION } from "@noobot/session-protocol";

export function assertLifecycleSequence(events = []) {
  expect(events.length).toBeGreaterThan(0);
  const eventIds = new Set();
  let sequence = -1;
  let revision = -1;
  for (const event of events) {
    expect(event.protocolVersion).toBe(TURN_LIFECYCLE_PROTOCOL_VERSION);
    expect(event.eventId).toBeTruthy();
    expect(eventIds.has(event.eventId)).toBe(false);
    expect(event.sequence).toBeGreaterThan(sequence);
    expect(event.revision).toBeGreaterThanOrEqual(revision);
    eventIds.add(event.eventId);
    sequence = event.sequence;
    revision = event.revision;
  }
}

export function assertSingleTerminal(events = []) {
  const terminal = events.filter((event) => ["turn.completed", "turn.stop_completed", "turn.failed"].includes(event.eventType));
  expect(terminal).toHaveLength(1);
}
