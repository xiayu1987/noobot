/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { runBestEffort } from "../best-effort.js";

test("best-effort operations preserve success values", async () => {
  assert.equal(await runBestEffort(async () => "done", { operationName: "test.success" }), "done");
});

test("best-effort failures publish structured diagnostics", async () => {
  const failure = new Error("cleanup failed");
  const diagnostics = [];
  const result = await runBestEffort(
    async () => {
      throw failure;
    },
    {
      operationName: "test.cleanup",
      context: { resource: "temporary" },
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    },
  );

  assert.equal(result, undefined);
  assert.deepEqual(diagnostics, [
    {
      event: "best_effort_operation_failed",
      operation: "test.cleanup",
      context: { resource: "temporary" },
      error: failure,
    },
  ]);
});

test("best-effort operations require an explicit operation identity", async () => {
  await assert.rejects(() => runBestEffort(async () => undefined), {
    name: "TypeError",
    message: "runBestEffort operationName is required",
  });
});
