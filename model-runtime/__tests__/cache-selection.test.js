/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelStrictToolSchema, resolveModelUseResponsesApi } from "@noobot/model-protocol";

test("transport flags are read only from the declared spec fields", () => {
  assert.equal(resolveModelUseResponsesApi({ model: "codex-mini" }), false);
  assert.equal(resolveModelUseResponsesApi({ model: "qwen-max", use_responses_api: true }), true);
  assert.equal(resolveModelUseResponsesApi({ model: "gpt-5", useResponsesApi: true }), false);
  assert.equal(resolveModelStrictToolSchema({ model: "gpt-5.3-codex" }), false);
  assert.equal(resolveModelStrictToolSchema({ model: "gpt-5", strict_tool_schema: true }), true);
});

test("transport flags reject non-boolean declarations", () => {
  assert.throws(
    () => resolveModelUseResponsesApi({ use_responses_api: "true" }),
    /must be boolean/,
  );
  assert.throws(
    () => resolveModelStrictToolSchema({ strict_tool_schema: null }),
    /must be boolean/,
  );
});
