/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHookManager } from "@noobot/hook-protocol";
import {
  normalizeTrimmedStringList,
  selectHookManager,
} from "../../src/bot/session/session-execution-engine-utils.js";

test("session-execution-engine-utils normalizes plugin selectors and resolves plugin options", () => {
  assert.deepEqual(normalizeTrimmedStringList([" a ", "", null, "b"]), ["a", "b"]);
});

test("session-execution-engine-utils selects only the canonical manager or creates one", () => {
  const manager = createHookManager();
  const hooks = createHookManager();
  const created = createHookManager();

  assert.equal(
    selectHookManager({
      runConfig: { hookManager: manager, hooks },
      managerKey: "hookManager",
      createManager: () => created,
    }),
    manager,
  );
  assert.equal(
    selectHookManager({
      runConfig: { hooks },
      managerKey: "hookManager",
      createManager: () => created,
    }),
    created,
  );
  assert.equal(
    selectHookManager({
      runConfig: {},
      managerKey: "hookManager",
      createManager: () => created,
    }),
    created,
  );
  assert.equal(
    selectHookManager({
      runConfig: { hookManager: null },
      managerKey: "hookManager",
      createManager: () => created,
    }),
    created,
  );
  assert.throws(
    () =>
      selectHookManager({
        runConfig: { hookManager: { kind: "stub" } },
        managerKey: "hookManager",
        createManager: () => created,
      }),
    /hookManager must be a hook manager with on\/emit or null/,
  );
});
