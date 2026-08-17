/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createAgentTransportEvent,
  getAgentTransportEventSessionId,
} from "../src/events.js";

test("transport event keeps routing identity separate from authoritative data", () => {
  const data = Object.freeze({ eventType: "attachment.parsed" });
  const envelope = createAgentTransportEvent({
    event: "attachment_lifecycle",
    data,
    channelSessionId: "session-1",
  });

  assert.equal(envelope.data, data);
  assert.deepEqual(envelope.data, { eventType: "attachment.parsed" });
  assert.equal(getAgentTransportEventSessionId(envelope), "session-1");
});

test("transport event rejects missing event identity and non-object data", () => {
  assert.throws(() => createAgentTransportEvent({ event: "", data: {} }), /missing_transport_event/);
  assert.throws(
    () => createAgentTransportEvent({ event: "delta", data: [] }),
    /invalid_transport_event_data/,
  );
});
