/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  HOST_CAPABILITY_ERROR_CODE,
  MESSAGE_CARD_HOST_CAPABILITIES,
  MESSAGE_CARD_HOST_STATES,
  MESSAGE_CARD_HOST_STATE_VERSION,
  requireMessageCardHostCapabilities,
} from "../src/frontend.js";

function completeContext() {
  return {
    ...Object.fromEntries(MESSAGE_CARD_HOST_CAPABILITIES.map((name) => [name, () => null])),
    ...Object.fromEntries(MESSAGE_CARD_HOST_STATES.map((name) => [name, {}])),
    [MESSAGE_CARD_HOST_STATE_VERSION]: 0,
  };
}

function assertMissing(context, name) {
  assert.throws(
    () => requireMessageCardHostCapabilities(context),
    (error) =>
      error instanceof TypeError &&
      error.code === HOST_CAPABILITY_ERROR_CODE.MISSING &&
      error.message.endsWith(name),
  );
}

test("message card host contract lists are the single contract", () => {
  assert.deepEqual(MESSAGE_CARD_HOST_CAPABILITIES, [
    "selectExecutionDetail",
    "stopExecution",
    "fetchExecutionReport",
    "selectSessionMessages",
    "applyWorkflowRuntimeEvent",
    "logWorkflowDiagnostics",
    "renderMarkdown",
    "formatTime",
    "formatFileSize",
    "isImageMime",
  ]);
  assert.deepEqual(MESSAGE_CARD_HOST_STATES, [
    "workflowNodeStateRegistry",
    "subSessionMessageRegistry",
  ]);
  assert.equal(MESSAGE_CARD_HOST_STATE_VERSION, "subSessionMessageRegistryVersion");
});

test("complete host context passes through unchanged", () => {
  const context = completeContext();
  assert.equal(requireMessageCardHostCapabilities(context), context);
});

test("missing or non-function host capability is rejected", () => {
  for (const name of MESSAGE_CARD_HOST_CAPABILITIES) {
    for (const value of [undefined, null, "fn"]) {
      assertMissing({ ...completeContext(), [name]: value }, name);
    }
  }
  assert.throws(() => requireMessageCardHostCapabilities(null), TypeError);
});

test("missing or non-record host state is rejected", () => {
  for (const name of MESSAGE_CARD_HOST_STATES) {
    for (const value of [undefined, null, [], "registry"]) {
      assertMissing({ ...completeContext(), [name]: value }, name);
    }
  }
});

test("non-integer registry version is rejected", () => {
  for (const value of [undefined, null, "1", 1.5]) {
    assertMissing(
      { ...completeContext(), [MESSAGE_CARD_HOST_STATE_VERSION]: value },
      MESSAGE_CARD_HOST_STATE_VERSION,
    );
  }
});
