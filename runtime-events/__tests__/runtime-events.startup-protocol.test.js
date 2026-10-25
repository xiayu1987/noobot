/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_SCOPES,
  SERVICE_STARTUP_EVENTS,
  SERVICE_STARTUP_LIVENESS,
  SERVICE_STARTUP_SOURCE,
  SERVICE_STARTUP_STALL_TIMEOUT_ENV,
  SERVICE_STARTUP_STATES,
  assessServiceStartupLiveness,
  readServiceStartupState,
  resolveServiceStartupStallTimeoutMs,
  resolveRuntimeEventFile,
  resolveRuntimeEventsConfig,
} from "../src/index.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { tempRoot } from "./runtime-events-test-fixtures.js";

const T0 = "2026-01-01T00:00:00.000Z";
const EMPTY_PENDING = { progress: null, progressAt: "", heartbeatAt: "" };

function startupStateFile() {
  return resolveRuntimeEventFile(
    {
      scope: RUNTIME_EVENT_SCOPES.STARTUP,
      source: SERVICE_STARTUP_SOURCE,
      category: RUNTIME_EVENT_CATEGORIES.STATE,
    },
    resolveRuntimeEventsConfig(),
  );
}

function line(pid, event, data = {}, time = T0) {
  return `${JSON.stringify({ time, event, process: { pid }, data })}\n`;
}

async function writeLines(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

test("service startup state is pending until the pid records a terminal event", async () => {
  await tempRoot();
  const file = startupStateFile();
  await writeLines(file, line(101, SERVICE_STARTUP_EVENTS.CONTEXT_LOADED));
  assert.deepEqual(await readServiceStartupState({ pid: 101 }), {
    state: SERVICE_STARTUP_STATES.PENDING,
    ...EMPTY_PENDING,
  });
});

test("service startup state is isolated by pid", async () => {
  await tempRoot();
  const file = startupStateFile();
  await writeLines(
    file,
    line(100, SERVICE_STARTUP_EVENTS.LISTEN_STARTED) +
      line(101, SERVICE_STARTUP_EVENTS.CONTEXT_LOADED),
  );
  const current = await readServiceStartupState({ pid: 101 });
  assert.equal(current.state, SERVICE_STARTUP_STATES.PENDING);
  const previous = await readServiceStartupState({ pid: 100 });
  assert.equal(previous.state, SERVICE_STARTUP_STATES.READY);
  assert.equal(previous.event, SERVICE_STARTUP_EVENTS.LISTEN_STARTED);
});

test("service startup failure is a terminal failed state", async () => {
  await tempRoot();
  const file = startupStateFile();
  await writeLines(
    file,
    line(102, SERVICE_STARTUP_EVENTS.CONTEXT_LOADED) +
      line(102, SERVICE_STARTUP_EVENTS.FAILED, { reason: "layout" }),
  );
  assert.deepEqual(await readServiceStartupState({ pid: 102 }), {
    state: SERVICE_STARTUP_STATES.FAILED,
    event: SERVICE_STARTUP_EVENTS.FAILED,
    data: { reason: "layout" },
  });
});

test("service startup state ignores a trailing partial line", async () => {
  await tempRoot();
  const file = startupStateFile();
  const partial = line(103, SERVICE_STARTUP_EVENTS.LISTEN_STARTED).slice(0, 20);
  await writeLines(file, line(103, SERVICE_STARTUP_EVENTS.CONTEXT_LOADED) + partial);
  assert.equal((await readServiceStartupState({ pid: 103 })).state, SERVICE_STARTUP_STATES.PENDING);
});

test("service startup state reads rotated archives when the active file lacks the terminal event", async () => {
  await tempRoot();
  const file = startupStateFile();
  const parsed = path.parse(file);
  const archive = path.join(parsed.dir, `${parsed.name}.20261025T000000${parsed.ext}`);
  await writeLines(archive, line(104, SERVICE_STARTUP_EVENTS.LISTEN_STARTED));
  await writeLines(file, line(105, SERVICE_STARTUP_EVENTS.CONTEXT_LOADED));
  assert.equal((await readServiceStartupState({ pid: 104 })).state, SERVICE_STARTUP_STATES.READY);
});

test("service startup state rejects a non-positive pid", async () => {
  await tempRoot();
  await assert.rejects(() => readServiceStartupState({ pid: 0 }), TypeError);
});

function launchLine(launchId, event, data = {}, time = T0) {
  return `${JSON.stringify({ time, event, process: { pid: 900, launchId }, data })}\n`;
}

test("service startup pending state carries the latest progress of the same identity", async () => {
  await tempRoot();
  const file = startupStateFile();
  await writeLines(
    file,
    line(106, SERVICE_STARTUP_EVENTS.WORKSPACE_PREPARATION_PROGRESS, { processed: 1 }) +
      line(107, SERVICE_STARTUP_EVENTS.WORKSPACE_PREPARATION_PROGRESS, { processed: 9 }) +
      line(106, SERVICE_STARTUP_EVENTS.WORKSPACE_PREPARATION_PROGRESS, { processed: 2 }),
  );
  assert.deepEqual(await readServiceStartupState({ pid: 106 }), {
    state: SERVICE_STARTUP_STATES.PENDING,
    ...EMPTY_PENDING,
    progress: { processed: 2 },
    progressAt: T0,
  });
});

test("service startup state is isolated by launchId", async () => {
  await tempRoot();
  const file = startupStateFile();
  await writeLines(
    file,
    launchLine("launch-a", SERVICE_STARTUP_EVENTS.LISTEN_STARTED) +
      launchLine("launch-b", SERVICE_STARTUP_EVENTS.WORKSPACE_PREPARATION_PROGRESS, {
        processed: 3,
      }),
  );
  assert.equal(
    (await readServiceStartupState({ launchId: "launch-a" })).state,
    SERVICE_STARTUP_STATES.READY,
  );
  assert.deepEqual(await readServiceStartupState({ launchId: "launch-b" }), {
    state: SERVICE_STARTUP_STATES.PENDING,
    ...EMPTY_PENDING,
    progress: { processed: 3 },
    progressAt: T0,
  });
  await assert.rejects(
    () => readServiceStartupState({ pid: 900, launchId: "launch-a" }),
    TypeError,
  );
  await assert.rejects(() => readServiceStartupState({ launchId: "" }), TypeError);
});

test("service startup state resolves the workspace root from an explicit env", async () => {
  await tempRoot();
  const file = startupStateFile();
  await writeLines(file, line(108, SERVICE_STARTUP_EVENTS.LISTEN_STARTED));
  const workspaceRoot = process.env.NOOBOT_WORKSPACE_ROOT;
  const env = { ...process.env, NOOBOT_WORKSPACE_ROOT: path.join(workspaceRoot, "elsewhere") };
  assert.equal(
    (await readServiceStartupState({ pid: 108, env })).state,
    SERVICE_STARTUP_STATES.PENDING,
  );
  assert.equal(
    (
      await readServiceStartupState({
        pid: 108,
        env: { ...env, NOOBOT_WORKSPACE_ROOT: workspaceRoot },
      })
    ).state,
    SERVICE_STARTUP_STATES.READY,
  );
});

test("service startup pending state carries the latest heartbeat and progress times", async () => {
  await tempRoot();
  const file = startupStateFile();
  const T1 = "2026-01-01T00:00:10.000Z";
  const T2 = "2026-01-01T00:00:20.000Z";
  await writeLines(
    file,
    line(109, SERVICE_STARTUP_EVENTS.HEARTBEAT, {}, T0) +
      line(109, SERVICE_STARTUP_EVENTS.WORKSPACE_PREPARATION_PROGRESS, { processed: 4 }, T1) +
      line(110, SERVICE_STARTUP_EVENTS.HEARTBEAT, {}, "2026-01-01T00:09:00.000Z") +
      line(109, SERVICE_STARTUP_EVENTS.HEARTBEAT, {}, T2),
  );
  assert.deepEqual(await readServiceStartupState({ pid: 109 }), {
    state: SERVICE_STARTUP_STATES.PENDING,
    progress: { processed: 4 },
    progressAt: T1,
    heartbeatAt: T2,
  });
});

test("service startup liveness separates stalled progress from a lost heartbeat", () => {
  const { startupStallTimeoutMs, startupUnresponsiveTimeoutMs } = TIME_THRESHOLDS.service;
  const now = Date.parse(T0) + startupStallTimeoutMs + 1;
  const at = (ms) => new Date(now - ms).toISOString();
  assert.deepEqual(assessServiceStartupLiveness({ heartbeatAt: "", progressAt: "" }, { now }), {
    liveness: SERVICE_STARTUP_LIVENESS.ACTIVE,
    idleMs: 0,
  });
  assert.equal(
    assessServiceStartupLiveness({ heartbeatAt: at(1000), progressAt: at(2000) }, { now }).liveness,
    SERVICE_STARTUP_LIVENESS.ACTIVE,
  );
  assert.deepEqual(
    assessServiceStartupLiveness({ heartbeatAt: at(1000), progressAt: T0 }, { now }),
    { liveness: SERVICE_STARTUP_LIVENESS.STALLED, idleMs: startupStallTimeoutMs + 1 },
  );
  assert.deepEqual(
    assessServiceStartupLiveness(
      { heartbeatAt: at(startupUnresponsiveTimeoutMs + 1), progressAt: T0 },
      { now },
    ),
    { liveness: SERVICE_STARTUP_LIVENESS.UNRESPONSIVE, idleMs: startupUnresponsiveTimeoutMs + 1 },
  );
  assert.equal(
    assessServiceStartupLiveness(
      { heartbeatAt: at(1000), progressAt: T0 },
      {
        now,
        stallTimeoutMs: startupStallTimeoutMs * 2,
      },
    ).liveness,
    SERVICE_STARTUP_LIVENESS.ACTIVE,
  );
});

test("service startup stall timeout env must be a positive integer", () => {
  assert.equal(
    resolveServiceStartupStallTimeoutMs({}),
    TIME_THRESHOLDS.service.startupStallTimeoutMs,
  );
  assert.equal(
    resolveServiceStartupStallTimeoutMs({ [SERVICE_STARTUP_STALL_TIMEOUT_ENV]: "600000" }),
    600000,
  );
  for (const value of ["0", "-1", "1.5", "abc"]) {
    assert.throws(
      () => resolveServiceStartupStallTimeoutMs({ [SERVICE_STARTUP_STALL_TIMEOUT_ENV]: value }),
      TypeError,
    );
  }
});
