/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { RUNTIME_EVENTS_CONFIG_ENVS } from "@noobot/shared/runtime-events-config";
import { resolveRuntimeEventsEnvAssignments, withRuntimeEventsEnv } from "../src/testing.js";

test("testing env maps declared keys and rejects unknown groups or keys", () => {
  assert.deepEqual(
    resolveRuntimeEventsEnvAssignments({ workspaceRoot: "/w", debug: { stateMachine: true } }),
    [
      ["NOOBOT_WORKSPACE_ROOT", "/w"],
      [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.debug.stateMachine, "true"],
    ],
  );
  assert.throws(() => resolveRuntimeEventsEnvAssignments({ bogus: {} }), TypeError);
  assert.throws(() => resolveRuntimeEventsEnvAssignments({ log: { bogus: 1 } }), TypeError);
});

test("withRuntimeEventsEnv restores previous values even when the operation throws", async () => {
  const name = RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.log.system;
  const previous = process.env[name];
  process.env[name] = "keep";
  try {
    await assert.rejects(
      withRuntimeEventsEnv({ log: { system: false } }, async () => {
        assert.equal(process.env[name], "false");
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(process.env[name], "keep");
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});
