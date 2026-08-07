/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_CATEGORY,
  EVENT_DEFINITION_CATEGORY,
  EVENT_TYPE,
  getEventDefinition,
  validateEventType,
  validateInteractionRequestPayload,
  isPendingInteractionReplay,
  INTERACTION_LIFECYCLE,
  isTerminalInteractionLifecycle,
} from "../src/index.mjs";

test("event registry classifies interaction, data and transport events", () => {
  assert.equal(getEventDefinition("turn.completed"), null);
  assert.equal(getEventDefinition(EVENT_TYPE.INTERACTION_REQUEST).category, EVENT_CATEGORY.INTERACTION);
  assert.equal(getEventDefinition(EVENT_TYPE.DELTA).category, EVENT_CATEGORY.DATA);
  assert.equal(getEventDefinition(EVENT_TYPE.RECONNECT_DATA).category, EVENT_CATEGORY.TRANSPORT);
  assert.equal(validateEventType("unknown").valid, false);
});

test("interaction lifecycle is canonical and terminal states require resolvedBy", () => {
  assert.equal(INTERACTION_LIFECYCLE.FAILED, "failed");
  assert.equal(isTerminalInteractionLifecycle("failed"), true);
  assert.equal(isTerminalInteractionLifecycle("pending"), false);
  const base = {
    requestId: "request-1", sessionId: "session-1", dialogProcessId: "process-1",
    turnScopeId: "turn-1", interactionType: "approval",
  };
  assert.equal(validateInteractionRequestPayload({ ...base, lifecycle: "failed" }).valid, false);
  assert.equal(validateInteractionRequestPayload({ ...base, lifecycle: "failed", resolvedBy: "system" }).valid, true);
});

test("replay interaction records are atomic and complete", () => {
  const valid = {
    event: "interaction_request",
    data: {
      requestId: "request-1",
      sessionId: "session-1",
      dialogProcessId: "process-1",
      turnScopeId: "turn-1",
      interactionType: "approval",
    },
  };
  assert.equal(isPendingInteractionReplay(valid), true);
  assert.equal(isPendingInteractionReplay({
    ...valid,
    data: { ...valid.data, requestId: "" },
  }), false);
  assert.equal(isPendingInteractionReplay({ event: "delta", data: valid.data }), false);
  assert.equal(isPendingInteractionReplay({
    ...valid,
    data: { ...valid.data, lifecycle: "failed", resolvedBy: "system" },
  }), false);
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
  assert.equal(validateInteractionRequestPayload({
    requestId: "request-1",
    sessionId: "session-1",
    dialogProcessId: "process-1",
    turnScopeId: "turn-1",
  }).valid, false);
});
