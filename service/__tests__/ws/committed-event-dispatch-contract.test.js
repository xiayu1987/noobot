/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMessageRunEventListener } from "../../ws/chat-websocket/message-run/event-listener-stage.js";
import { createTestLifecycleEnvelope } from "../routes/chat-websocket-server.turn-lifecycle.fixtures.js";
import { useProvisionedRuntimeEventsWorkspace } from "../runtime-events-root.test-helpers.js";

useProvisionedRuntimeEventsWorkspace(["u1"]);

function listener(dispatchAuthorityEvents) {
  return createMessageRunEventListener(
    { dispatchAuthorityEvents },
    { userId: "u1", sessionId: "root-session", turnScopeId: "root-turn" },
    {},
    { runHandle: {}, runMeta: {} },
  ).eventListener;
}

for (const event of ["authority_event_committed", "turn_lifecycle_committed"]) {
  const commit = (
    eventListener,
    envelope = createTestLifecycleEnvelope({ eventId: `dispatch-contract-${event}` }),
  ) => eventListener.onEvent({ event, data: { envelope, persistenceScope: null } });

  test(`${event} propagates a dispatcher exception without replacing its identity`, async () => {
    const error = new Error("outbox write failed");
    error.code = "OUTBOX_WRITE_FAILED";
    await assert.rejects(
      commit(
        listener(async () => {
          throw error;
        }),
      ),
      (actual) => actual === error,
    );
  });

  test(`${event} rejects non-replayable dispatcher failures`, async () => {
    await assert.rejects(
      commit(
        listener(async () => ({
          dispatched: false,
          reason: "authority_outbox_unavailable",
          delivered: 0,
        })),
      ),
      /authority_outbox_unavailable/,
    );
  });

  test(`${event} reports a replayable send failure`, async () => {
    const result = await commit(
      listener(async () => ({
        dispatched: false,
        reason: "authority_event_send_failed",
        delivered: 0,
      })),
    );
    assert.equal(result.deliveryDegraded, true);
    assert.equal(result.reason, "authority_event_send_failed");
  });

  test(`${event} rejects an invalid envelope before invoking the dispatcher`, () => {
    let called = false;
    const eventListener = listener(() => {
      called = true;
    });
    assert.throws(() => commit(eventListener, {}), /invalid committed authority event/);
    assert.equal(called, false);
  });
}
