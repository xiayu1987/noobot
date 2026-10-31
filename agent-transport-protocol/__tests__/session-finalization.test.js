/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { assertSessionFinalizationContext } from "../src/session-finalization.js";

function ports() {
  return {
    parentDialogProcessId: "",
    userConfig: {},
    lifecycle: { enterPersisting() {}, enterMemory() {} },
    runtimeEventListener: { onEvent() {}, async flush() {} },
  };
}

test("finalization validates ports without invoking transitions or flushing events", () => {
  const effects = [];
  assertSessionFinalizationContext({
    parentDialogProcessId: "",
    userConfig: {},
    lifecycle: {
      enterPersisting: () => effects.push("persisting"),
      enterMemory: () => effects.push("memory"),
    },
    runtimeEventListener: {
      onEvent: () => effects.push("event"),
      flush: async () => effects.push("flush"),
    },
  });
  assert.deepEqual(effects, []);
});

test("finalization rejects every missing lifecycle and durability capability", () => {
  for (const [port, methods] of [
    ["lifecycle", ["enterPersisting", "enterMemory"]],
    ["runtimeEventListener", ["onEvent", "flush"]],
  ]) {
    for (const invalid of [null, undefined, {}]) {
      assert.throws(() => assertSessionFinalizationContext({ ...ports(), [port]: invalid }), {
        code: "SESSION_FINALIZATION_PORT_INVALID",
      });
    }
    for (const method of methods) {
      const payload = ports();
      delete payload[port][method];
      assert.throws(() => assertSessionFinalizationContext(payload), {
        code: "SESSION_FINALIZATION_PORT_INVALID",
        message: `session finalization requires ${port}.${method}`,
      });
    }
  }
});

test("finalization requires explicit parent identity and user configuration", () => {
  for (const parentDialogProcessId of [undefined, null, " dialog-1 "]) {
    assert.throws(
      () => assertSessionFinalizationContext({ ...ports(), parentDialogProcessId }),
      /parentDialogProcessId must be empty or canonical text/,
    );
  }
  for (const userConfig of [undefined, null, []]) {
    assert.throws(
      () => assertSessionFinalizationContext({ ...ports(), userConfig }),
      /userConfig must be a plain object/,
    );
  }
  assert.doesNotThrow(() =>
    assertSessionFinalizationContext({ ...ports(), parentDialogProcessId: "parent-dialog" }),
  );
});
