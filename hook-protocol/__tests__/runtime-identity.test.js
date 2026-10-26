/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  HOOK_RUNTIME_IDENTITY_FIELDS,
  assertNoHookRuntimeIdentityFields,
  createHookRuntimeIdentity,
  withHookRuntimeIdentity,
} from "../src/index.js";

const identity = Object.freeze({
  userId: "user-1",
  sessionId: "session-1",
  parentSessionId: "",
  dialogProcessId: "dp-1",
  turnScopeId: "client-turn:1",
  caller: "user",
});

function rejectsIdentity(fn, pattern) {
  assert.throws(
    fn,
    (error) => error.code === "HOOK_RUNTIME_IDENTITY_INVALID" && pattern.test(error.message),
  );
}

test("hook runtime identity accepts canonical values and freezes them", () => {
  const result = createHookRuntimeIdentity(identity);
  assert.deepEqual(result, identity);
  assert.equal(Object.isFrozen(result), true);
});

test("hook runtime identity rejects missing or non-canonical required fields instead of trimming", () => {
  for (const field of ["userId", "sessionId", "dialogProcessId", "turnScopeId"]) {
    for (const value of [undefined, "", " padded ", 7]) {
      rejectsIdentity(
        () => createHookRuntimeIdentity({ ...identity, [field]: value }),
        new RegExp(field),
      );
    }
  }
});

test("hook runtime identity parentSessionId may be empty but must be a canonical string", () => {
  assert.equal(
    createHookRuntimeIdentity({ ...identity, parentSessionId: "p-1" }).parentSessionId,
    "p-1",
  );
  for (const value of [undefined, null, " p-1"]) {
    rejectsIdentity(
      () => createHookRuntimeIdentity({ ...identity, parentSessionId: value }),
      /parentSessionId/,
    );
  }
});

test("hook runtime identity rejects unknown fields and invalid caller", () => {
  rejectsIdentity(
    () => createHookRuntimeIdentity({ ...identity, extra: "x" }),
    /unknown fields: extra/,
  );
  assert.throws(
    () => createHookRuntimeIdentity({ ...identity, caller: "" }),
    (error) => error.code === "SESSION_CALLER_INVALID",
  );
});

test("hook context cannot carry identity fields and receives the protocol identity", () => {
  const context = withHookRuntimeIdentity(identity, { phase: "run" });
  assert.equal(context.phase, "run");
  assert.equal(context.turnScopeId, "client-turn:1");
  rejectsIdentity(
    () => withHookRuntimeIdentity(identity, { sessionId: "forged" }),
    /must not carry identity fields: sessionId/,
  );
  rejectsIdentity(() => withHookRuntimeIdentity(identity, null), /plain object/);
});

test("identity field guard rejects every protocol identity field and non-objects", () => {
  const runConfig = Object.freeze({ model: "m-1", workflowRunId: "run-1" });
  assert.equal(assertNoHookRuntimeIdentityFields(runConfig, "runConfig"), runConfig);
  for (const field of HOOK_RUNTIME_IDENTITY_FIELDS) {
    for (const value of ["x", "", undefined]) {
      rejectsIdentity(
        () => assertNoHookRuntimeIdentityFields({ ...runConfig, [field]: value }, "runConfig"),
        new RegExp(`runConfig must not carry identity fields: ${field}$`),
      );
    }
  }
  for (const value of [null, undefined, [], "x"]) {
    rejectsIdentity(
      () => assertNoHookRuntimeIdentityFields(value, "runConfig"),
      /runConfig must be a plain object/,
    );
  }
});
