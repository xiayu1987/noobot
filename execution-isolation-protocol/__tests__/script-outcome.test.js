/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SCRIPT_FAILURE_CODE,
  SCRIPT_TERMINATION,
  projectScriptOutcome,
  resolveScriptTermination,
} from "../src/script-outcome.js";

const ABSENT = Object.freeze({ exitCode: null, signal: null });

function runnerFacts(overrides) {
  return {
    timedOut: false,
    aborted: false,
    outputLimitExceeded: false,
    spawnFailed: false,
    protocolViolated: false,
    ...ABSENT,
    ...overrides,
  };
}

test("exit 0 is the only successful outcome and carries no failure fields", () => {
  assert.deepEqual(
    projectScriptOutcome({ termination: SCRIPT_TERMINATION.EXITED, exitCode: 0, signal: null }),
    { ok: true, termination: "exited", exitCode: 0 },
  );
});

test("non-zero exit fails with string code and exitCode kept separately", () => {
  assert.deepEqual(
    projectScriptOutcome({ termination: SCRIPT_TERMINATION.EXITED, exitCode: 2, signal: null }),
    {
      ok: false,
      termination: "exited",
      exitCode: 2,
      code: SCRIPT_FAILURE_CODE.exited,
      error: "script exited with code 2",
    },
  );
});

test("signaled, timeout, abort, output limit, spawn and protocol failures project string codes", () => {
  const signaled = projectScriptOutcome({
    termination: SCRIPT_TERMINATION.SIGNALED,
    exitCode: null,
    signal: "SIGKILL",
  });
  assert.equal(signaled.code, "RECOVERABLE_SCRIPT_SIGNALED");
  assert.equal(signaled.error, "script terminated by signal SIGKILL");
  for (const termination of [
    SCRIPT_TERMINATION.TIMEOUT,
    SCRIPT_TERMINATION.ABORTED,
    SCRIPT_TERMINATION.OUTPUT_LIMIT,
    SCRIPT_TERMINATION.SPAWN_FAILED,
    SCRIPT_TERMINATION.PROTOCOL_ERROR,
  ]) {
    const outcome = projectScriptOutcome({ termination, ...ABSENT, message: "why" });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, SCRIPT_FAILURE_CODE[termination]);
    assert.equal(outcome.error, "why");
  }
});

test("protocol rejects incomplete or invalid outcomes", () => {
  assert.throws(() => projectScriptOutcome(), /must be an object/);
  assert.throws(
    () => projectScriptOutcome({ termination: "exited", exitCode: 0 }),
    /signal is required/,
  );
  assert.throws(() => projectScriptOutcome({ termination: "done", ...ABSENT }), /unsupported/);
  assert.throws(
    () => projectScriptOutcome({ termination: "exited", ...ABSENT }),
    /requires exitCode/,
  );
  assert.throws(
    () => projectScriptOutcome({ termination: "exited", exitCode: "0", signal: null }),
    /integer/,
  );
  assert.throws(
    () => projectScriptOutcome({ termination: "signaled", ...ABSENT }),
    /requires signal/,
  );
  assert.throws(
    () => projectScriptOutcome({ termination: "timeout", ...ABSENT }),
    /requires a message/,
  );
  assert.throws(
    () => projectScriptOutcome({ termination: "exited", exitCode: 0, signal: "" }),
    /signal/,
  );
});

test("termination resolution prefers runner facts and never treats a missing status as success", () => {
  const resolve = (overrides) => resolveScriptTermination(runnerFacts(overrides));
  assert.equal(resolve({ spawnFailed: true, exitCode: 0 }), "spawn_failed");
  assert.equal(resolve({ protocolViolated: true, exitCode: 0, timedOut: true }), "protocol_error");
  assert.equal(resolve({ outputLimitExceeded: true, timedOut: true }), "output_limit");
  assert.equal(resolve({ timedOut: true, signal: "SIGTERM" }), "timeout");
  assert.equal(resolve({ aborted: true, exitCode: 0 }), "aborted");
  assert.equal(resolve({ exitCode: 0 }), "exited");
  assert.equal(resolve({ signal: "SIGKILL" }), "signaled");
  assert.throws(() => resolve({}), /without exit code or signal/);
  assert.throws(() => resolveScriptTermination({ exitCode: 0 }), /timedOut is required/);
  assert.throws(() => resolve({ aborted: 1 }), /must be boolean/);
});
