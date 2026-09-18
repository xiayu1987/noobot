/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  attachRunTransport,
  buildRunRegistryKeys,
  closeUserInterjectionQueue,
  consumeUserInterjections,
  detachRunTransport,
  enqueueUserInterjection,
  findActiveRun,
  isRunTransportAttached,
  publishRunEvent,
  registerActiveRun,
  sealUserInterjectionQueueIfEmpty,
  unregisterActiveRun,
} from "../../ws/chat-websocket/run-registry.js";

test("user interjection queue consumes FIFO and retains the batch when persistence fails", async () => {
  const handle = registerActiveRun({
    userId: "owner-interjection",
    sessionId: "session-interjection",
    turnScopeId: "turn-interjection",
  });
  try {
    const commitAuthority = async () => {};
    await enqueueUserInterjection(
      handle,
      { commandId: "command-1", message: "first" },
      commitAuthority,
    );
    await enqueueUserInterjection(
      handle,
      { commandId: "command-2", message: "second" },
      commitAuthority,
    );
    assert.equal(
      await enqueueUserInterjection(
        handle,
        { commandId: "command-1", message: "duplicate" },
        commitAuthority,
      ),
      null,
    );
    await assert.rejects(
      consumeUserInterjections(handle, async (batch) => {
        assert.deepEqual(
          batch.map((item) => item.message),
          ["first", "second"],
        );
        throw new Error("persistence failed");
      }),
      /persistence failed/,
    );
    assert.deepEqual(
      handle.userInterjectionQueue.map((item) => item.message),
      ["first", "second"],
    );
    const consumed = await consumeUserInterjections(handle, async () => {});
    assert.deepEqual(
      consumed.map((item) => item.message),
      ["first", "second"],
    );
    assert.deepEqual(handle.userInterjectionQueue, []);
  } finally {
    unregisterActiveRun(handle);
  }
});

test("closing user interjections rejects new messages and preserves the accepted FIFO batch", async () => {
  const handle = registerActiveRun({
    userId: "owner-interjection-stop",
    sessionId: "session-interjection-stop",
    turnScopeId: "turn-interjection-stop",
  });
  try {
    await enqueueUserInterjection(
      handle,
      { commandId: "command-before-stop", message: "accepted" },
      async () => {},
    );
    closeUserInterjectionQueue(handle);

    await assert.rejects(
      async () =>
        enqueueUserInterjection(
          handle,
          { commandId: "command-after-stop", message: "late" },
          async () => {},
        ),
      (error) => error?.code === "active_turn_stopping",
    );
    const consumed = await consumeUserInterjections(handle, async () => {});
    assert.deepEqual(
      consumed.map((item) => item.message),
      ["accepted"],
    );
  } finally {
    unregisterActiveRun(handle);
  }
});

test("authority acceptance serializes FIFO and advances sequence only after commit", async () => {
  const handle = registerActiveRun({
    userId: "owner-interjection-authority",
    sessionId: "session-interjection-authority",
    turnScopeId: "turn-interjection-authority",
  });
  try {
    await assert.rejects(
      enqueueUserInterjection(
        handle,
        { commandId: "command-rejected", message: "rejected" },
        async (item) => {
          assert.equal(item.interjectionSequence, 1);
          throw new Error("authority commit failed");
        },
      ),
      /authority commit failed/,
    );

    const accepted = await enqueueUserInterjection(
      handle,
      { commandId: "command-accepted", message: "accepted" },
      async (item) => assert.equal(item.interjectionSequence, 1),
    );
    assert.equal(accepted.interjectionSequence, 1);
    assert.equal(handle.userInterjectionSequence, 1);
  } finally {
    unregisterActiveRun(handle);
  }
});

test("pending authority acceptance keeps the interjection queue open", async () => {
  const handle = registerActiveRun({
    userId: "owner-interjection-pending",
    sessionId: "session-interjection-pending",
    turnScopeId: "turn-interjection-pending",
  });
  let releaseCommit;
  const commitBlocked = new Promise((resolve) => {
    releaseCommit = resolve;
  });
  try {
    const acceptance = enqueueUserInterjection(
      handle,
      { commandId: "command-pending", message: "pending" },
      async () => commitBlocked,
    );
    assert.equal(sealUserInterjectionQueueIfEmpty(handle), false);
    releaseCommit();
    await acceptance;
    assert.equal(sealUserInterjectionQueueIfEmpty(handle), false);
  } finally {
    unregisterActiveRun(handle);
  }
});

test("sealing succeeds only for an empty queue and rejects interjections after completion", async () => {
  const handle = registerActiveRun({
    userId: "owner-interjection-seal",
    sessionId: "session-interjection-seal",
    turnScopeId: "turn-interjection-seal",
  });
  try {
    await enqueueUserInterjection(
      handle,
      { commandId: "command-before-seal", message: "accepted" },
      async () => {},
    );
    assert.equal(sealUserInterjectionQueueIfEmpty(handle), false);
    await consumeUserInterjections(handle, async () => {});
    assert.equal(sealUserInterjectionQueueIfEmpty(handle), true);
    await assert.rejects(
      async () =>
        enqueueUserInterjection(
          handle,
          { commandId: "command-after-seal", message: "late" },
          async () => {},
        ),
      (error) => error?.code === "active_turn_stopping",
    );
  } finally {
    unregisterActiveRun(handle);
  }
});

test("run-registry scopes every identity key to the canonical owner", () => {
  const keys = buildRunRegistryKeys({
    userId: "owner-a",
    sessionId: "session-owner-scope",
    turnScopeId: "turn-owner-scope",
    dialogProcessId: "dialog-owner-scope",
  });
  assert.ok(keys.length >= 3);
  assert.ok(keys.every((key) => key.startsWith("user:owner-a:")));
});

test("run-registry finds a run only for the same canonical owner", () => {
  const handle = registerActiveRun({
    userId: "owner-a",
    sessionId: "session-active-owner",
    turnScopeId: "turn-active-owner",
    dialogProcessId: "dialog-active-owner",
  });
  try {
    assert.equal(
      findActiveRun({
        userId: "owner-a",
        sessionId: handle.sessionId,
        turnScopeId: handle.turnScopeId,
      }),
      handle,
    );
    assert.equal(
      findActiveRun({
        userId: "owner-b",
        sessionId: handle.sessionId,
        turnScopeId: handle.turnScopeId,
      }),
      null,
    );
    assert.equal(
      findActiveRun({ sessionId: handle.sessionId, turnScopeId: handle.turnScopeId }),
      null,
    );
  } finally {
    unregisterActiveRun(handle);
  }
});

test("run transport rebound keeps the stable Run Handle and routes late events only to the current binding", async () => {
  const firstFrames = [];
  const reboundFrames = [];
  const diagnostics = [];
  const handle = registerActiveRun({
    userId: "owner-rebound",
    sessionId: "session-rebound",
    turnScopeId: "turn-rebound",
  });
  const stableRunHandleId = handle.runHandleId;
  const firstBinding = attachRunTransport(
    handle,
    async (event, data, context) => {
      firstFrames.push({ event, data, context });
      return true;
    },
    { onDiagnostic: (data) => diagnostics.push(data) },
  );
  const reboundBinding = attachRunTransport(
    handle,
    async (event, data, context) => {
      reboundFrames.push({ event, data, context });
      return true;
    },
    { onDiagnostic: (data) => diagnostics.push(data) },
  );

  assert.equal(handle.runHandleId, stableRunHandleId);
  assert.equal(isRunTransportAttached(handle, firstBinding), false);
  assert.equal(isRunTransportAttached(handle, reboundBinding), true);
  assert.equal(detachRunTransport(handle, firstBinding), false);
  assert.equal(
    await publishRunEvent(handle, "message_event", {
      event: {
        eventId: "event-after-rebound",
        eventType: "authoritative_final_content",
        messageId: "message-after-rebound",
        presentationMessageId: "presentation-after-rebound",
      },
    }),
    true,
  );

  assert.equal(firstFrames.length, 0);
  assert.equal(reboundFrames.length, 1);
  assert.equal(reboundFrames[0].context.runHandleId, stableRunHandleId);
  assert.equal(reboundFrames[0].context.bindingId, reboundBinding.id);
  assert.deepEqual(
    diagnostics.map((item) => item.stage),
    ["publish_started", "publish_completed"],
  );
  assert.ok(diagnostics.every((item) => item.runHandleId === stableRunHandleId));
  assert.ok(diagnostics.every((item) => item.bindingId === reboundBinding.id));
  unregisterActiveRun(handle);
});

test("terminal unregister detaches the current transport and rejects late publication", async () => {
  const frames = [];
  const handle = registerActiveRun({
    userId: "owner-terminal",
    sessionId: "session-terminal",
    turnScopeId: "turn-terminal",
  });
  const binding = attachRunTransport(handle, async (...args) => {
    frames.push(args);
    return true;
  });
  assert.equal(isRunTransportAttached(handle, binding), true);

  unregisterActiveRun(handle);

  assert.equal(isRunTransportAttached(handle, binding), false);
  assert.equal(
    await publishRunEvent(handle, "message_event", {
      event: { eventId: "late-terminal-event" },
    }),
    false,
  );
  assert.equal(frames.length, 0);
});
