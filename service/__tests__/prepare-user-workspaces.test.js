/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SERVICE_STARTUP_PROGRESS_STAGES } from "@noobot/runtime-events";
import { prepareUserWorkspaces } from "../bootstrap/prepare-user-workspaces.js";
import {
  createThrottledProgressReporter,
  startStartupHeartbeat,
} from "../bootstrap/startup-progress.js";

function createBot({ brokenWorkspace, partialSummary, layoutUpgrades = [] }) {
  const prepared = [];
  return {
    prepared,
    async repairUserWorkspace(userId, { onProgress }) {
      onProgress({ upgradeId: "v13", upgradeIndex: 1, upgradeCount: 1, processedSessions: 0 });
      if (userId === brokenWorkspace) {
        throw Object.assign(new Error("layout broken"), { code: "E_LAYOUT" });
      }
      return { base: `/ws/${userId}`, report: { layoutUpgrades } };
    },
    session: {
      async maintainSessionDisplaySummaries({ userId, onProgress }) {
        onProgress({ sessionIndex: 1, sessionCount: 1 });
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
    reportProgress: () => {},
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
  const result = await prepareUserWorkspaces({ userIds: ["u-1"], bot, reportProgress: () => {} });
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
  const result = await prepareUserWorkspaces({ userIds: ["u-1"], bot, reportProgress: () => {} });
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

test("workspace preparation reports per-user layout and summary progress", async () => {
  const progress = [];
  await prepareUserWorkspaces({
    userIds: ["u-1", "u-2"],
    bot: createBot({}),
    reportProgress: (item) => progress.push(item),
  });
  assert.deepEqual(progress, [
    {
      userId: "u-1",
      userIndex: 1,
      userCount: 2,
      stage: SERVICE_STARTUP_PROGRESS_STAGES.LAYOUT_UPGRADE,
      upgradeId: "v13",
      upgradeIndex: 1,
      upgradeCount: 1,
      processedSessions: 0,
    },
    {
      userId: "u-1",
      userIndex: 1,
      userCount: 2,
      stage: SERVICE_STARTUP_PROGRESS_STAGES.DISPLAY_SUMMARY,
      upgradeId: "",
      sessionIndex: 1,
      sessionCount: 1,
    },
    {
      userId: "u-2",
      userIndex: 2,
      userCount: 2,
      stage: SERVICE_STARTUP_PROGRESS_STAGES.LAYOUT_UPGRADE,
      upgradeId: "v13",
      upgradeIndex: 1,
      upgradeCount: 1,
      processedSessions: 0,
    },
    {
      userId: "u-2",
      userIndex: 2,
      userCount: 2,
      stage: SERVICE_STARTUP_PROGRESS_STAGES.DISPLAY_SUMMARY,
      upgradeId: "",
      sessionIndex: 1,
      sessionCount: 1,
    },
  ]);
});

test("startup progress writes phase changes immediately and throttles within a phase", () => {
  const written = [];
  let clock = 0;
  const report = createThrottledProgressReporter({
    write: (item) => written.push(item.processedSessions),
    intervalMs: 1000,
    now: () => clock,
  });
  const phase = {
    userIndex: 1,
    stage: SERVICE_STARTUP_PROGRESS_STAGES.LAYOUT_UPGRADE,
    upgradeId: "a",
  };
  report({ ...phase, processedSessions: 0 });
  clock = 10;
  report({ ...phase, processedSessions: 1 });
  clock = 1010;
  report({ ...phase, processedSessions: 2 });
  clock = 1020;
  report({ ...phase, upgradeId: "b", processedSessions: 0 });
  assert.deepEqual(written, [0, 2, 0]);
});

test("startup progress keeps the last throttled count of a phase", () => {
  const written = [];
  let clock = 0;
  const report = createThrottledProgressReporter({
    write: (item) => written.push(`${item.upgradeId}:${item.processedSessions}`),
    intervalMs: 1000,
    now: () => clock,
  });
  const phase = {
    userIndex: 1,
    stage: SERVICE_STARTUP_PROGRESS_STAGES.LAYOUT_UPGRADE,
    upgradeId: "a",
  };
  report({ ...phase, processedSessions: 1 });
  clock = 10;
  report({ ...phase, processedSessions: 7 });
  clock = 20;
  report({ ...phase, upgradeId: "b", processedSessions: 1 });
  clock = 30;
  report({ ...phase, upgradeId: "b", processedSessions: 3 });
  report.flush();
  report.flush();
  assert.deepEqual(written, ["a:1", "a:7", "b:1", "b:3"]);
});

test("startup heartbeat writes immediately, repeats per interval and stops cleanly", async () => {
  const beats = [];
  const stop = startStartupHeartbeat({ write: (data) => beats.push(data), intervalMs: 10 });
  assert.equal(beats.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 35));
  stop();
  const stoppedAt = beats.length;
  assert.ok(stoppedAt >= 3, `expected repeated heartbeats, got ${stoppedAt}`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(beats.length, stoppedAt);
});
