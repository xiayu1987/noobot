/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceAdmission } from "../src/workspace-lifecycle/workspace-admission.js";

test("maintenance drains already admitted work through nested workspace operations", async () => {
  const events = [];
  const admission = createWorkspaceAdmission(async (id) => events.push(`release:${id}`));
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const admitted = admission.run("a", () =>
    admission.run("b", async () => {
      entered.resolve();
      await resume.promise;
      await admission.run("a", async () => events.push("nested:a"));
    }),
  );
  await entered.promise;
  const maintenance = admission.withMaintenance("a", async () => events.push("maintain:a"));
  try {
    await assert.rejects(admission.run("a", assert.fail), { code: "WORKSPACE_MAINTENANCE" });
    await admission.run("b", async () => events.push("external:b"));
    assert.deepEqual(events, ["external:b"]);
  } finally {
    resume.resolve();
    await Promise.allSettled([admitted, maintenance]);
  }
  await admitted;
  await maintenance;
  assert.deepEqual(events, ["external:b", "nested:a", "release:a", "maintain:a"]);
});

test("maintenance rejects an attempt to drain a workspace held by an active ancestor", async () => {
  const events = [];
  const admission = createWorkspaceAdmission(async (id) => events.push(`release:${id}`));
  let result;
  await admission.run("a", () =>
    admission.run("b", async () => {
      const request = admission.withMaintenance("a", async () => events.push("maintain:a"));
      result = request.then(
        () => "completed",
        (error) => error.code,
      );
      const duringLease = await Promise.race([
        result,
        new Promise((resolve) => setImmediate(resolve, "waiting-for-own-lease")),
      ]);
      assert.equal(duringLease, "WORKSPACE_MAINTENANCE");
    }),
  );
  assert.equal(await result, "WORKSPACE_MAINTENANCE");
  assert.deepEqual(events, []);
});

test("a detached continuation cannot reuse expired workspace admission", async () => {
  const admission = createWorkspaceAdmission(async () => {});
  const resume = Promise.withResolvers();
  let detached;
  await admission.run("a", () =>
    admission.run("b", async () => {
      detached = resume.promise.then(() => admission.run("a", assert.fail));
    }),
  );
  const maintained = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const maintenance = admission.withMaintenance("a", () => {
    maintained.resolve();
    return finish.promise;
  });
  await maintained.promise;
  try {
    resume.resolve();
    await assert.rejects(detached, { code: "WORKSPACE_MAINTENANCE" });
  } finally {
    finish.resolve();
    await maintenance;
  }
});
