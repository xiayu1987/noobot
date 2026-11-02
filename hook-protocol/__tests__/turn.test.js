/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { requireHookTurn } from "../src/index.js";

test("hook turn preserves valid rounds and rejects missing or coerced rounds", () => {
  assert.equal(requireHookTurn({ turn: 3 }), 3);
  for (const turn of [undefined, null, 0, -1, 1.5, "2", NaN, Infinity]) {
    const context = { turn };
    assert.throws(() => requireHookTurn(context), /positive integer turn/);
    assert.equal(context.turn, turn);
  }
});
