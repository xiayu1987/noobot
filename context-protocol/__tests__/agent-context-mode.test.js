/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_CONTEXT_MODE } from "../src/agent-context/schema.js";
import { assertAgentContextMode } from "../src/agent-context/validation.js";

test("assertAgentContextMode accepts protocol modes", () => {
  for (const mode of Object.values(AGENT_CONTEXT_MODE)) {
    assert.equal(assertAgentContextMode(mode), mode);
  }
});

test("assertAgentContextMode rejects anything outside the protocol", () => {
  for (const mode of [undefined, null, "", "typo_mode", "NEW_SESSION", 1]) {
    assert.throws(
      () => assertAgentContextMode(mode),
      (error) => error instanceof TypeError && error.code === "INVALID_CONTEXT_MODE",
    );
  }
});
