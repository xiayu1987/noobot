/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { requireServiceWorkspacePreparation } from "../src/startup-protocol.js";

test("workspace readiness rejects incomplete reports and preserves failure details", () => {
  for (const report of [undefined, null, {}, { failures: null }])
    assert.throws(() => requireServiceWorkspacePreparation(report), TypeError);
  const report = {
    userCount: 1,
    recoveredTurnCount: 0,
    failures: [
      {
        userId: "admin",
        stage: "session-immutable-record-locations-v38",
        code: "EIO",
        message: "publication failed",
      },
    ],
  };
  assert.throws(
    () => requireServiceWorkspacePreparation(report),
    (error) => {
      assert.equal(error.code, "SERVICE_WORKSPACE_PREPARATION_FAILED");
      assert.equal(error.report, report);
      return true;
    },
  );
  const complete = { userCount: 1, recoveredTurnCount: 0, failures: [] };
  assert.equal(requireServiceWorkspacePreparation(complete), complete);
});
