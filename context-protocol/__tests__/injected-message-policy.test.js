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
} from "../src/policy/injected-message.js";
import {
  SUMMARY_ALWAYS_RETAINED_INJECTED_MESSAGE_TYPES,
  CONTEXT_CONTROL_MESSAGE_TYPES,
} from "../src/message/injected-types.js";

test("internal message type uses the context protocol field codec", () => {
  assert.equal(
    resolveContextInternalMessageType({
      additional_kwargs: { noobotInternalMessageType: "internal.marker" },
    }),
    "internal.marker",
  );
});

test("internal message type is read only from additional_kwargs", () => {
  assert.equal(
    resolveContextInternalMessageType({
      noobotInternalMessageType: "noobot.phase_summary_prompt",
    }),
    "",
  );
});

test("only checkpoint control messages participate in summary checkpoint policy", () => {
  assert.deepEqual(
    [...CONTEXT_CONTROL_MESSAGE_TYPES].sort(),
    Object.values(CONTEXT_INJECTED_MESSAGE_TYPE)
      .filter((type) => type !== CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION)
      .sort(),
  );
  assert.equal(
    CONTEXT_CONTROL_MESSAGE_TYPES.includes(CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION),
    false,
  );
  assert.deepEqual(SUMMARY_ALWAYS_RETAINED_INJECTED_MESSAGE_TYPES, [
    CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
  ]);
});

test("injected and plugin message flags resolve through the context protocol", async () => {
  const { isInjectedMessage, isInjectedOrPluginMessage } = await import("../src/policy/message.js");
  const ctx = (metadata) => ({ role: "user", content: "x", additional_kwargs: metadata });
  assert.equal(isInjectedMessage(ctx({ injectedMessage: true, injectedMessageType: "t" })), true);

  assert.equal(isInjectedMessage(ctx({ injectedBy: "harness-plugin" })), false);
  assert.equal(isInjectedMessage({ role: "user", content: "x", injectedMessage: true }), false);
  assert.equal(isInjectedOrPluginMessage(ctx({ pluginMessage: true })), true);
  assert.equal(
    isInjectedOrPluginMessage(ctx({ injectedMessage: true, injectedMessageType: "t" })),
    true,
  );
  assert.equal(isInjectedOrPluginMessage({ role: "user", content: "hi" }), false);
  assert.equal(isInjectedOrPluginMessage(ctx({ pluginMessage: false })), false);
});
