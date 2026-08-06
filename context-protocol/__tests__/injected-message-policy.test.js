/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_INJECTED_MESSAGE_TYPE,
  resolveContextInternalMessageType,
} from "../src/injected-message-policy.js";
import { SUMMARY_CHECKPOINT_CONTROL_MESSAGE_TYPES } from "../src/injected-message-types.js";

test("internal message type uses the context protocol field codec", () => {
  assert.equal(resolveContextInternalMessageType({
    additional_kwargs: { noobotInternalMessageType: "internal.marker" },
  }), "internal.marker");
});

test("internal message type reads the canonical Session entity field", () => {
  assert.equal(resolveContextInternalMessageType({
    noobotInternalMessageType: "noobot.phase_summary_prompt",
  }), "noobot.phase_summary_prompt");
});

test("every runtime control message participates in summary checkpoint policy", () => {
  assert.deepEqual(
    [...SUMMARY_CHECKPOINT_CONTROL_MESSAGE_TYPES].sort(),
    Object.values(CONTEXT_INJECTED_MESSAGE_TYPE).sort(),
  );
});
