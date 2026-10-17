/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BOT_DISPATCH_ROOT_OWNER,
  createBotDispatchHandled,
  createBotDispatchPass,
  resolveBotDispatchOutcome,
} from "@noobot/agent-transport-protocol/bot-dispatch";

test("dispatch protocol resolves one explicit owner", () => {
  const workflow = createBotDispatchHandled({ owner: "workflow", result: { output: "done" } });
  const result = resolveBotDispatchOutcome({
    outcomes: [
      { status: "ok", value: createBotDispatchPass({ owner: "audit" }) },
      { status: "ok", value: workflow },
    ],
  });
  assert.equal(result, workflow);
});

test("dispatch protocol rejects competing execution owners", () => {
  assert.throws(
    () =>
      resolveBotDispatchOutcome({
        outcomes: [
          { status: "ok", value: createBotDispatchHandled({ owner: "workflow" }) },
          { status: "ok", value: createBotDispatchHandled({ owner: "other" }) },
        ],
      }),
    (error) => error?.code === "BOT_DISPATCH_OWNERSHIP_CONFLICT",
  );
});

test("failed dispatch outcome cannot carry a successful result payload", () => {
  const outcome = createBotDispatchHandled({
    owner: "workflow",
    result: { output: "stale planning result", turnMessages: [{ content: "WORKFLOW_DSL/1" }] },
    failure: { code: "WORKFLOW_NODE_FAILED", message: "node failed" },
  });
  assert.equal(outcome.failure.code, "WORKFLOW_NODE_FAILED");
  assert.equal(Object.hasOwn(outcome, "result"), false);
});

test("dispatch protocol routes unclaimed turns to the explicit root owner", () => {
  const result = resolveBotDispatchOutcome({ outcomes: [] });
  assert.equal(result.disposition, "pass");
  assert.equal(result.owner, BOT_DISPATCH_ROOT_OWNER);
  assert.throws(() => createBotDispatchPass(), /pass bot dispatch outcome requires owner/);
});
