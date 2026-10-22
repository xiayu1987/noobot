/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { prepareUserWorkspaces } from "../bootstrap/prepare-user-workspaces.js";

function createBot({ brokenWorkspace, partialSummary, layoutUpgrades = [] }) {
  const prepared = [];
  return {
    prepared,
    async repairUserWorkspace(userId) {
      if (userId === brokenWorkspace) {
        throw Object.assign(new Error("layout broken"), { code: "E_LAYOUT" });
      }
      return { base: `/ws/${userId}`, report: { layoutUpgrades } };
    },
    session: {
      async maintainSessionDisplaySummaries({ userId }) {
        prepared.push(userId);
        if (userId === partialSummary) {
          return {
            userId,
            rebuiltSessionIds: [],
            failures: [{ sessionId: "s-2", code: "E_SUMMARY", message: "bad" }],
          };
        }
        return { userId, rebuiltSessionIds: ["s-3"], failures: [] };
      },
    },
  };
}

test("a broken user workspace is reported without blocking other users", async () => {
  const bot = createBot({ brokenWorkspace: "u-broken", partialSummary: "u-partial" });
  const result = await prepareUserWorkspaces({
    userIds: ["u-broken", "u-partial", "u-ok"],
    bot,
  });
  assert.deepEqual(bot.prepared, ["u-partial", "u-ok"]);
  assert.deepEqual(result, {
    userCount: 3,
    rebuiltSessionCount: 1,
    failures: [
      { userId: "u-broken", stage: "workspace", code: "E_LAYOUT", message: "layout broken" },
      { userId: "u-partial", sessionId: "s-2", code: "E_SUMMARY", message: "bad" },
    ],
  });
});

test("a failing summary maintenance call is reported per user", async () => {
  const bot = createBot({});
  bot.session.maintainSessionDisplaySummaries = async () => {
    throw new Error("summary store offline");
  };
  const result = await prepareUserWorkspaces({ userIds: ["u-1"], bot });
  assert.deepEqual(result.failures, [
    { userId: "u-1", stage: "sessionDisplaySummary", code: "", message: "summary store offline" },
  ]);
});

test("failed layout upgrades and quarantined units surface as startup failures", async () => {
  const bot = createBot({
    layoutUpgrades: [
      {
        id: "model-context-snapshot-v7",
        toVersion: 7,
        result: {
          migrated: [],
          quarantined: [
            {
              path: "runtime/session/s-1/model-message-snapshots/a.json",
              quarantinePath: "runtime/migration-quarantine/x/a.json.reason.json",
              error: { code: "ENAMETOOLONG", message: "name too long" },
            },
          ],
        },
      },
      { id: "next-v8", toVersion: 8, failed: { code: "E_IO", message: "disk" } },
    ],
  });
  const result = await prepareUserWorkspaces({ userIds: ["u-1"], bot });
  assert.deepEqual(bot.prepared, ["u-1"]);
  assert.deepEqual(result.failures, [
    {
      userId: "u-1",
      stage: "model-context-snapshot-v7",
      path: "runtime/session/s-1/model-message-snapshots/a.json",
      quarantinePath: "runtime/migration-quarantine/x/a.json.reason.json",
      code: "ENAMETOOLONG",
      message: "name too long",
    },
    { userId: "u-1", stage: "next-v8", code: "E_IO", message: "disk" },
  ]);
});
