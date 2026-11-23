/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SERVICE_STARTUP_PROGRESS_STAGES } from "@noobot/runtime-events";
import { assertWorkspaceLayoutReady } from "@noobot/workspace-protocol";
import { SESSION_SUMMARY_AVAILABILITY } from "@noobot/session-protocol/sessions-summary";
import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "@noobot/session-protocol/turn-lifecycle";
import { prepareUserWorkspaces } from "../bootstrap/prepare-user-workspaces.js";
import {
  createThrottledProgressReporter,
  startStartupHeartbeat,
} from "../bootstrap/startup-progress.js";

const activeTurn = {
  turnScopeId: "turn-orphan",
  dialogProcessId: "dialog-orphan",
  executionId: "agent:turn-orphan",
  executionKind: "agent",
  rootExecutionId: "agent:turn-orphan",
  parentExecutionId: "",
  origin: {},
  stage: "",
  commandId: "command-orphan",
  action: "send",
  presentationMessageId: "presentation-orphan",
  executionState: "sending",
  summaryVersion: 0,
  completionCommitId: "",
  terminalStatus: null,
  failure: null,
  finalizeIntent: null,
  continuationSource: null,
  continuedByTurnScopeId: "",
  startedAt: "2026-07-18T00:00:00.000Z",
  createdAt: "2026-07-18T00:00:00.000Z",
  finishedAt: "",
  sequence: 1,
  state: TURN_STATE.PROCESSING,
  phase: TURN_PHASE.PROCESSING,
  revision: 1,
  updatedAt: "2026-07-18T00:00:00.000Z",
};

const RECOVERY_OBSERVED_AT = "2026-07-19T00:00:00.000Z";

const summaryOf = (sessionId, activeTurnScopeId, availability) => ({
  sessionId,
  activeTurnScopeId,
  availability: availability || SESSION_SUMMARY_AVAILABILITY.AVAILABLE,
});

function createBot({ brokenWorkspace, layoutUpgrades = [], summaries = [] }) {
  const prepared = [];
  const committed = [];
  const projected = [];
  return {
    prepared,
    committed,
    projected,
    async repairUserWorkspace(userId, { onProgress }) {
      onProgress({ upgradeId: "v13", upgradeIndex: 1, upgradeCount: 1, processedSessions: 0 });
      if (userId === brokenWorkspace) {
        throw Object.assign(new Error("layout broken"), { code: "E_LAYOUT" });
      }
      assertWorkspaceLayoutReady(layoutUpgrades);
      return { base: `/ws/${userId}`, report: { layoutUpgrades } };
    },
    session: {
      readServerNow: () => RECOVERY_OBSERVED_AT,
      async recoverExecutionLogProjection(identity) {
        projected.push(identity);
        return { records: 0 };
      },
      async getAllSessionSummaries({ userId }) {
        prepared.push(userId);
        return { schemaVersion: 1, sessions: summaries, updatedAt: "" };
      },
      async getTurnLifecycleSnapshot({ sessionId, persistenceScope, resolveRecovery }) {
        assert.equal(persistenceScope, null);
        if (sessionId === "s-missing") return { found: false, reason: "session_not_found" };
        const turn = committed.some((event) => event.sessionId === sessionId) ? null : activeTurn;
        return {
          found: true,
          snapshot: { activeTurn: turn, recovery: await resolveRecovery(turn) },
        };
      },
      async applyTurnLifecycleEvent(event) {
        committed.push(event);
        return { applied: true };
      },
    },
  };
}

test("a broken user workspace is reported without blocking other users", async () => {
  const bot = createBot({ brokenWorkspace: "u-broken" });
  const result = await prepareUserWorkspaces({
    userIds: ["u-broken", "u-partial", "u-ok"],
    bot,
    reportProgress: () => {},
  });
  assert.deepEqual(bot.prepared, ["u-partial", "u-ok"]);
  assert.deepEqual(result, {
    userCount: 3,
    recoveredTurnCount: 0,
    failures: [
      { userId: "u-broken", stage: "workspace", code: "E_LAYOUT", message: "layout broken" },
    ],
  });
});

test("startup recovery fails every persisted active turn of available sessions", async () => {
  const bot = createBot({
    summaries: [
      summaryOf("s-active", "turn-orphan"),
      summaryOf("s-idle", ""),
      summaryOf("s-unavailable", "turn-orphan", SESSION_SUMMARY_AVAILABILITY.UNAVAILABLE),
    ],
  });
  const progress = [];
  const result = await prepareUserWorkspaces({
    userIds: ["u-1"],
    bot,
    reportProgress: (item) => progress.push(item),
  });
  assert.equal(result.recoveredTurnCount, 1);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(bot.projected, [
    { userId: "u-1", sessionId: "s-active", persistenceScope: null },
    { userId: "u-1", sessionId: "s-idle", persistenceScope: null },
  ]);
  assert.deepEqual(
    bot.committed.map(({ sessionId, eventType, persistenceScope }) => ({
      sessionId,
      eventType,
      persistenceScope,
    })),
    [{ sessionId: "s-active", eventType: TURN_EVENT.FAILED, persistenceScope: null }],
  );
  assert.deepEqual(progress.at(-1), {
    userId: "u-1",
    userIndex: 1,
    userCount: 1,
    stage: SERVICE_STARTUP_PROGRESS_STAGES.TURN_RECOVERY,
    upgradeId: "",
    sessionIndex: 1,
    sessionCount: 1,
  });
});

test("startup recovery reports sessions whose active turn cannot be recovered", async () => {
  const bot = createBot({ summaries: [summaryOf("s-missing", "turn-orphan")] });
  const result = await prepareUserWorkspaces({ userIds: ["u-1"], bot, reportProgress: () => {} });
  assert.equal(result.recoveredTurnCount, 0);
  assert.deepEqual(result.failures, [
    {
      userId: "u-1",
      stage: SERVICE_STARTUP_PROGRESS_STAGES.TURN_RECOVERY,
      sessionId: "s-missing",
      code: "session_not_found",
    },
  ]);
});

test("projection recovery failure is reported without skipping the other sessions", async () => {
  const bot = createBot({ summaries: [summaryOf("s-bad", ""), summaryOf("s-good", "")] });
  const recovered = [];
  bot.session.recoverExecutionLogProjection = async ({ sessionId }) => {
    recovered.push(sessionId);
    if (sessionId === "s-bad")
      throw Object.assign(new Error("cursor corrupt"), { code: "E_CURSOR" });
  };
  const result = await prepareUserWorkspaces({ userIds: ["u-1"], bot, reportProgress: () => {} });
  assert.deepEqual(recovered, ["s-bad", "s-good"]);
  assert.deepEqual(result.failures, [
    {
      userId: "u-1",
      stage: SERVICE_STARTUP_PROGRESS_STAGES.TURN_RECOVERY,
      sessionId: "s-bad",
      code: "E_CURSOR",
      message: "cursor corrupt",
    },
  ]);
});

for (const failedPort of ["getTurnLifecycleSnapshot", "applyTurnLifecycleEvent"]) {
  test(`startup isolates ${failedPort} failure and retains successful recovery counts`, async () => {
    const bot = createBot({
      summaries: [
        summaryOf("s-before", "turn-orphan"),
        summaryOf("s-bad", "turn-orphan"),
        summaryOf("s-after", "turn-orphan"),
      ],
    });
    const original = bot.session[failedPort].bind(bot.session);
    const attempted = [];
    const failure = Object.assign(new Error("recovery storage unavailable"), { code: "E_IO" });
    bot.session[failedPort] = async (request) => {
      attempted.push(request.sessionId);
      if (request.sessionId === "s-bad") throw failure;
      return original(request);
    };
    const result = await prepareUserWorkspaces({ userIds: ["u-1"], bot, reportProgress: () => {} });
    assert.ok(attempted.includes("s-after"));
    assert.equal(result.recoveredTurnCount, 2);
    assert.deepEqual(
      bot.committed.map(({ sessionId }) => sessionId),
      ["s-before", "s-after"],
    );
    assert.deepEqual(result.failures, [
      {
        userId: "u-1",
        stage: SERVICE_STARTUP_PROGRESS_STAGES.TURN_RECOVERY,
        sessionId: "s-bad",
        code: "E_IO",
        message: failure.message,
      },
    ]);
  });
}

test("a failing startup recovery call is reported per user", async () => {
  const bot = createBot({});
  bot.session.getAllSessionSummaries = async () => {
    throw Object.assign(new Error("summary index offline"), { code: "E_INDEX" });
  };
  const result = await prepareUserWorkspaces({ userIds: ["u-1"], bot, reportProgress: () => {} });
  assert.deepEqual(result.failures, [
    {
      userId: "u-1",
      stage: SERVICE_STARTUP_PROGRESS_STAGES.TURN_RECOVERY,
      code: "E_INDEX",
      message: "summary index offline",
    },
  ]);
});

test("startup recovery uses the list projection without exporting session history", async () => {
  const bot = createBot({ summaries: [summaryOf("s-active", "turn-orphan")] });
  bot.session.getSessionDisplayData = () => assert.fail("startup must not export session history");
  const result = await prepareUserWorkspaces({ userIds: ["u-1"], bot, reportProgress: () => {} });
  assert.deepEqual(result.failures, []);
  assert.equal(result.recoveredTurnCount, 1);
  assert.deepEqual(
    bot.committed.map((event) => event.sessionId),
    ["s-active"],
  );
});

test("a blocked layout upgrade skips startup recovery and preserves the failing stage", async () => {
  const bot = createBot({
    layoutUpgrades: [{ id: "next-v8", toVersion: 8, failed: { code: "E_IO", message: "disk" } }],
  });
  const result = await prepareUserWorkspaces({ userIds: ["u-1"], bot, reportProgress: () => {} });
  assert.deepEqual(bot.prepared, []);
  assert.deepEqual(result.failures, [
    { userId: "u-1", stage: "next-v8", code: "E_IO", message: "disk" },
  ]);
});

test("quarantined units are reported without skipping healthy startup recovery", async () => {
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
    ],
  });
  const result = await prepareUserWorkspaces({ userIds: ["u-1"], bot, reportProgress: () => {} });
  assert.deepEqual(bot.prepared, ["u-1"]);
  assert.deepEqual(bot.projected, []);
  assert.deepEqual(bot.committed, []);
  assert.deepEqual(result.failures, [
    {
      userId: "u-1",
      stage: "model-context-snapshot-v7",
      path: "runtime/session/s-1/model-message-snapshots/a.json",
      quarantinePath: "runtime/migration-quarantine/x/a.json.reason.json",
      code: "ENAMETOOLONG",
      message: "name too long",
    },
  ]);
});

test("workspace preparation reports per-user layout progress", async () => {
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
      userId: "u-2",
      userIndex: 2,
      userCount: 2,
      stage: SERVICE_STARTUP_PROGRESS_STAGES.LAYOUT_UPGRADE,
      upgradeId: "v13",
      upgradeIndex: 1,
      upgradeCount: 1,
      processedSessions: 0,
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

test("startup heartbeat writes immediately, repeats per interval and stops cleanly", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const beats = [];
  const stop = startStartupHeartbeat({ write: (data) => beats.push(data), intervalMs: 10 });
  assert.equal(beats.length, 1);
  t.mock.timers.tick(9);
  assert.equal(beats.length, 1);
  t.mock.timers.tick(1);
  assert.equal(beats.length, 2);
  t.mock.timers.tick(20);
  assert.equal(beats.length, 4);
  stop();
  const stoppedAt = beats.length;
  t.mock.timers.tick(30);
  assert.equal(beats.length, stoppedAt);
});
