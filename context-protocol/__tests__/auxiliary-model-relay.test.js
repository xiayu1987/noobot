/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_INJECTED_MESSAGE_TYPE,
  createAuxiliaryModelRelayType,
  readAuxiliaryModelRelayPurpose,
} from "../src/message/injected-types.js";

test("auxiliary relay creation and consumption share the canonical summary identity", () => {
  assert.equal(
    createAuxiliaryModelRelayType("summary"),
    CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
  );
  for (const purpose of [
    "summary",
    "planning",
    "guidance",
    "planning_followup",
    "acceptance_semantic_validation",
  ])
    assert.equal(readAuxiliaryModelRelayPurpose(createAuxiliaryModelRelayType(purpose)), purpose);
});

test("unrelated, malformed and obsolete summary types do not count as consumed relays", () => {
  for (const type of [
    undefined,
    null,
    {},
    "",
    "separate_model_relay:",
    "separate_model_relay:summary",
    "separate_model_relay:summary:extra",
    CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_PROMPT,
  ])
    assert.equal(readAuxiliaryModelRelayPurpose(type), "");
  for (const purpose of [undefined, "", " summary", "summary:extra", {}])
    assert.throws(() => createAuxiliaryModelRelayType(purpose), TypeError);
});
