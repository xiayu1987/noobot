/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createBotDispatchHandled,
  createBotDispatchPass,
  resolveBotDispatchOutcome,
} from "../bot-dispatch-protocol.mjs";

test("dispatch protocol resolves one explicit owner", () => {
  const workflow = createBotDispatchHandled({ owner: "workflow", result: { output: "done" } });
  const result = resolveBotDispatchOutcome({ results: [
    { ok: true, result: createBotDispatchPass({ owner: "audit" }) },
    { ok: true, result: workflow },
  ] });
  assert.equal(result, workflow);
});

test("dispatch protocol rejects competing execution owners", () => {
  assert.throws(
    () => resolveBotDispatchOutcome({ results: [
      { ok: true, result: createBotDispatchHandled({ owner: "workflow" }) },
      { ok: true, result: createBotDispatchHandled({ owner: "other" }) },
    ] }),
    (error) => error?.code === "BOT_DISPATCH_OWNERSHIP_CONFLICT",
  );
});
