/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  NoobotError,
  fatalSystemError,
  recoverableToolError,
  isFatalError,
} from "../../../src/shared/errors/index.js";
test("NoobotError requires code and level", () => {
  assert.throws(() => recoverableToolError("x"), /code must be a non-empty string/);
  assert.throws(() => recoverableToolError("x", { code: "" }), /code must be a non-empty string/);
  assert.throws(() => new NoobotError("x", { code: "C" }), /level must be one of/);
  assert.throws(
    () => recoverableToolError("x", { code: "C", details: [] }),
    /details must be a plain object/,
  );
});
test("fatal is the single severity source", () => {
  assert.equal(isFatalError(fatalSystemError("x", { code: "FATAL_A" })), true);
  assert.equal(isFatalError(recoverableToolError("x", { code: "FATAL_LOOKALIKE" })), false);
  const foreign = Object.assign(new Error("x"), { code: "FATAL_A", level: "fatal", fatal: true });
  assert.equal(isFatalError(foreign), false);
});
