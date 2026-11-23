/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import "@noobot/shared/testing/runtime-params";
import { createSessionFacade } from "noobot-agent/session";
import { createTestPartitionSessionServices } from "../../agent/__tests__/helpers/session-services.js";
import { initializeUserWorkspace } from "../../agent/__tests__/helpers/user-workspace.js";
import { seedPerformanceHistory } from "../../client/noobot-chat/tests/e2e/protocol/helpers/performance-history.js";
import { PERF_HISTORY } from "../mock-model-service/performance-contract.mjs";

test("performance history seeds and verifies the full workload through public session contracts", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "noobot-performance-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = JSON.parse(
    await readFile(
      new URL("../../service/config/global.config.example.json", import.meta.url),
      "utf8",
    ),
  );
  await using runtime = createTestPartitionSessionServices(
    { workspaceRoot: root },
    config.partitionSessionStorage,
  );
  const session = createSessionFacade(runtime);
  const identity = { userId: "performance-verification", sessionId: "history-verification" };
  await initializeUserWorkspace(root, identity.userId);
  await session.createSession({
    ...identity,
    parentSessionId: "",
    caller: "user",
    persistenceScope: null,
  });
  const report = await seedPerformanceHistory(runtime, identity);
  const checkpoints = PERF_HISTORY.turns * PERF_HISTORY.checkpointsPerTurn;
  const messages = checkpoints * PERF_HISTORY.messagesPerCheckpoint;
  const { turnSamples, ...coverage } = report;
  assert.deepEqual(coverage, {
    historyTurns: PERF_HISTORY.turns,
    historyMessages: messages,
    historyCheckpoints: checkpoints,
    historyContentBytes: (Math.ceil(PERF_HISTORY.minimumContentBytes / messages) + 1) * messages,
    minimumHistoryContentBytes: PERF_HISTORY.minimumContentBytes,
  });
  assert.ok(report.historyContentBytes > PERF_HISTORY.minimumContentBytes);
  assert.equal(turnSamples.length, PERF_HISTORY.turns);
  for (const [turn, sample] of turnSamples.entries()) {
    assert.equal(sample.turn, turn);
    for (const phase of ["appendMs", "checkpointMs", "verificationMs"])
      assert.ok(Number.isFinite(sample[phase]) && sample[phase] >= 0, `${turn}: ${phase}`);
  }
});
