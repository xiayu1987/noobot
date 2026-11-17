/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CONTEXT_INTERNAL_MESSAGE_TYPE } from "../src/message/internal-types.js";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "../src/message/injected-types.js";
import { isCurrentSystemContextMessage } from "../src/policy/message.js";

test("internal message types are a frozen vocabulary distinct from injected prompt types", () => {
  assert.ok(Object.isFrozen(CONTEXT_INTERNAL_MESSAGE_TYPE));
  assert.deepEqual(CONTEXT_INTERNAL_MESSAGE_TYPE, {
    SYSTEM_CONTEXT: "system_context",
    USER_META: "user_meta",
    TERMINAL_HISTORY_EXPLANATION: "terminal_history_explanation",
  });
  const injected = new Set(Object.values(CONTEXT_INJECTED_MESSAGE_TYPE));
  for (const value of Object.values(CONTEXT_INTERNAL_MESSAGE_TYPE)) {
    assert.equal(injected.has(value), false, `${value} must not be an injected prompt type`);
  }
});

test("system context policy reads the internal type only from additional_kwargs", () => {
  const type = CONTEXT_INTERNAL_MESSAGE_TYPE.SYSTEM_CONTEXT;
  assert.equal(
    isCurrentSystemContextMessage({ additional_kwargs: { noobotInternalMessageType: type } }),
    true,
  );
  assert.equal(isCurrentSystemContextMessage({ noobotInternalMessageType: type }), false);
  assert.equal(
    isCurrentSystemContextMessage({
      additional_kwargs: { noobotInternalMessageType: CONTEXT_INTERNAL_MESSAGE_TYPE.USER_META },
    }),
    false,
  );
  assert.equal(isCurrentSystemContextMessage({}), false);
});
