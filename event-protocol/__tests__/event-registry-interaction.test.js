/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_AUTHORITY,
  EVENT_FAMILY,
  EVENT_REDUCER_TARGET,
  getEventFamily,
  getEventFamilyByWireEvent,
  validateInteractionRequestPayload,
  isPendingInteractionReplay,
  INTERACTION_LIFECYCLE,
  isTerminalInteractionLifecycle,
} from "../src/index.js";

test("event family registry delegates authoritative domain events only", () => {
  assert.equal(getEventFamilyByWireEvent("turn.completed"), null);
  assert.equal(getEventFamilyByWireEvent("delta"), null);
  assert.equal(getEventFamilyByWireEvent("reconnect_data"), null);
  const interaction = getEventFamily(EVENT_FAMILY.INTERACTION_REQUEST);
  assert.equal(interaction.authority, EVENT_AUTHORITY.AUTHORITATIVE);
  assert.equal(interaction.reducerTarget, EVENT_REDUCER_TARGET.INTERACTION);
  assert.equal(getEventFamilyByWireEvent("interaction_request"), interaction);
});

test("interaction lifecycle is canonical and terminal states require resolvedBy", () => {
  assert.equal(INTERACTION_LIFECYCLE.FAILED, "failed");
  assert.equal(isTerminalInteractionLifecycle("failed"), true);
  assert.equal(isTerminalInteractionLifecycle("pending"), false);
  const base = {
    requestId: "request-1",
    sessionId: "session-1",
    dialogProcessId: "process-1",
    turnScopeId: "turn-1",
    interactionType: "approval",
  };
  assert.equal(validateInteractionRequestPayload({ ...base, lifecycle: "failed" }).valid, false);
  assert.equal(
    validateInteractionRequestPayload({ ...base, lifecycle: "failed", resolvedBy: "system" }).valid,
    true,
  );
});

test("replay interaction records are atomic and complete", () => {
  const valid = {
    identity: { eventType: "interaction_request" },
    payload: {
      requestId: "request-1",
      sessionId: "session-1",
      dialogProcessId: "process-1",
      turnScopeId: "turn-1",
      interactionType: "approval",
    },
  };
  assert.equal(isPendingInteractionReplay(valid), true);
  assert.equal(
    isPendingInteractionReplay({
      ...valid,
      payload: { ...valid.payload, requestId: "" },
    }),
    false,
  );
  assert.equal(isPendingInteractionReplay({ identity: { eventType: "delta" }, payload: valid.payload }), false);
  assert.equal(
    isPendingInteractionReplay({
      ...valid,
      payload: { ...valid.payload, lifecycle: "failed", resolvedBy: "system" },
    }),
    false,
  );
});

test("interaction request requires stable identity and a complete payload", () => {
  const base = {
    requestId: "request-1",
    sessionId: "session-1",
    dialogProcessId: "process-1",
    turnScopeId: "turn-1",
    interactionType: "approval",
  };
  assert.equal(validateInteractionRequestPayload(base).valid, true);
  assert.equal(validateInteractionRequestPayload({ ...base, requestId: "" }).valid, false);
  assert.equal(validateInteractionRequestPayload({ ...base, interactionType: "" }).valid, false);
  assert.equal(
    validateInteractionRequestPayload({
      requestId: "request-1",
      sessionId: "session-1",
      dialogProcessId: "process-1",
      turnScopeId: "turn-1",
    }).valid,
    false,
  );
  assert.equal(validateInteractionRequestPayload({ ...base, timeoutMs: 0 }).valid, false);
  assert.equal(validateInteractionRequestPayload({ ...base, timeoutMs: 1000 }).valid, true);
});
