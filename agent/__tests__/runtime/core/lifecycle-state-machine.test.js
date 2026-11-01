/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_LIFECYCLE_BRANCH_STATE,
  AGENT_LIFECYCLE_STATE,
  createAgentLifecycleMachine,
  resolveInitialLifecycleState,
  syncLifecycleRuntimeState,
} from "../../../src/runtime/lifecycle/state-machine.js";
import { AGENT_RUN_EVENT } from "../../../src/events/run-event.js";

test("resume identity is immutable and owned by lifecycle base payload", () => {
  const events = [];
  const machine = createAgentLifecycleMachine({
    basePayload: { resumeFromStoppedSnapshot: true },
    eventListener: { onEvent: (event) => events.push(event) },
  });
  for (const resumeFromStoppedSnapshot of [true, false, undefined]) {
    assert.throws(
      () => machine.enterRunning({ resumeFromStoppedSnapshot }),
      /owned by basePayload/,
    );
  }
  assert.equal(events.length, 0);
  assert.equal(machine.enterRunning().resumeFromStoppedSnapshot, true);
  assert.equal(events[0].data.sequence, 1);
});

test("agent lifecycle machine emits normalized state change payload", () => {
  const events = [];
  const machine = createAgentLifecycleMachine({
    eventListener: { onEvent: (event) => events.push(event) },
    now: () => "2026-01-01T00:00:00.000Z",
    basePayload: {
      sessionId: "s1",
      dialogProcessId: "d1",
      turnScopeId: "t1",
      resumeFromStoppedSnapshot: true,
    },
  });

  machine.transition(AGENT_LIFECYCLE_STATE.RESUME_INITIALIZING);
  machine.transition(AGENT_LIFECYCLE_STATE.RUNNING);
  machine.transition(AGENT_LIFECYCLE_BRANCH_STATE.FAILED, { error: "boom" });

  assert.deepEqual(
    events.map((item) => item.event),
    [
      AGENT_RUN_EVENT.LIFECYCLE_STATE_CHANGED,
      AGENT_RUN_EVENT.LIFECYCLE_STATE_CHANGED,
      AGENT_RUN_EVENT.LIFECYCLE_STATE_CHANGED,
    ],
  );
  assert.equal(events[0].data.state, "resume_initializing");
  assert.equal(events[0].data.previousState, "");
  assert.equal(events[1].data.previousState, "resume_initializing");
  assert.equal(events[2].data.state, "failed");
  assert.equal(events[2].data.branchState, "failed");
  assert.equal(events[2].data.previousState, "running");
  assert.equal(events[2].data.error, "boom");
  assert.equal(machine.state, "running");
  assert.equal(machine.branchState, "failed");
});

test("agent lifecycle helpers resolve initial state and sync runtime fields", () => {
  assert.equal(resolveInitialLifecycleState({}), AGENT_LIFECYCLE_STATE.INITIALIZING);
  assert.equal(
    resolveInitialLifecycleState({ resumeFromStoppedSnapshot: true }),
    AGENT_LIFECYCLE_STATE.RESUME_INITIALIZING,
  );

  const machine = createAgentLifecycleMachine({ basePayload: { resumeFromStoppedSnapshot: true } });
  machine.transition(resolveInitialLifecycleState({ resumeFromStoppedSnapshot: true }));
  const runtime = {};

  syncLifecycleRuntimeState(runtime, machine);
  assert.equal(runtime.agentLifecycle, machine);
  assert.equal(runtime.agentLifecycle.state, AGENT_LIFECYCLE_STATE.RESUME_INITIALIZING);

  machine.enterRunning();
  syncLifecycleRuntimeState(runtime, machine);
  assert.equal(runtime.agentLifecycle.state, AGENT_LIFECYCLE_STATE.RUNNING);
  assert.equal(Object.hasOwn(runtime, "agentLifecycleState"), false);
});

test("agent lifecycle phase methods and terminal branch payloads are standardized", () => {
  const events = [];
  const machine = createAgentLifecycleMachine({
    eventListener: { onEvent: (event) => events.push(event) },
    now: () => "2026-01-01T00:00:00.000Z",
    basePayload: { resumeFromStoppedSnapshot: false },
  });

  machine.transition(resolveInitialLifecycleState({ resumeFromStoppedSnapshot: false }));
  machine.enterRunning();
  machine.enterPersisting();
  machine.enterMemory();
  machine.complete();

  assert.deepEqual(
    events.map((item) => item.data.state),
    [
      AGENT_LIFECYCLE_STATE.INITIALIZING,
      AGENT_LIFECYCLE_STATE.RUNNING,
      AGENT_LIFECYCLE_STATE.PERSISTING,
      AGENT_LIFECYCLE_STATE.MEMORY,
      AGENT_LIFECYCLE_STATE.COMPLETED,
    ],
  );

  assert.equal(typeof machine.stop, "undefined");

  const skippedPersistence = {
    status: "skipped",
    reason: "non_user_abort",
    source: "runner_abort_catch",
    messageCount: 0,
    systemCount: 0,
    historyCount: 0,
    incrementalCount: 0,
  };
  machine.userStop({ reason: "user stopped", stoppedSnapshotPersistence: skippedPersistence });
  assert.equal(events.at(-1).data.state, AGENT_LIFECYCLE_BRANCH_STATE.USER_STOPPED);
  assert.equal(events.at(-1).data.branchState, AGENT_LIFECYCLE_BRANCH_STATE.USER_STOPPED);
  assert.equal(events.at(-1).data.stopType, "user_stop");
  assert.equal(events.at(-1).data.canResume, false);
  assert.equal(events.at(-1).data.error, "user stopped");
  assert.deepEqual(events.at(-1).data.stoppedSnapshotPersistence, skippedPersistence);

  machine.userStop({
    reason: "user stopped",
    stoppedSnapshotPersistence: {
      status: "saved",
      source: "runner_user_stop_catch",
      identity: { userId: "u1", sessionId: "s1", dialogProcessId: "d1", turnScopeId: "t1" },
      messageCount: 2,
      systemCount: 1,
      historyCount: 0,
      incrementalCount: 1,
    },
  });
  assert.equal(events.at(-1).data.stoppedSnapshotPersistence.status, "saved");
  assert.equal(events.at(-1).data.stoppedSnapshotPersistence.source, "runner_user_stop_catch");
  assert.equal(events.at(-1).data.stoppedSnapshotPersistence.messageCount, 2);
  assert.equal(events.at(-1).data.canResume, true);

  const eventCount = events.length;
  assert.throws(() => machine.userStop({ reason: "user stopped" }), /stoppedSnapshotPersistence/);
  assert.throws(
    () => machine.userStop({ reason: "", stoppedSnapshotPersistence: skippedPersistence }),
    /reason text/,
  );
  assert.throws(
    () =>
      machine.interrupt({
        reason: "timeout",
        stopType: "",
        stoppedSnapshotPersistence: skippedPersistence,
      }),
    /protocol abort stopType/,
  );
  assert.throws(
    () =>
      machine.interrupt({
        reason: "timeout",
        stopType: "user_stop",
        stoppedSnapshotPersistence: skippedPersistence,
      }),
    /protocol abort stopType/,
  );
  assert.equal(events.length, eventCount);

  machine.interrupt({
    reason: "run timeout",
    stopType: "run_timeout",
    stoppedSnapshotPersistence: skippedPersistence,
  });
  assert.equal(events.at(-1).data.state, AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED);
  assert.equal(events.at(-1).data.branchState, AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED);
  assert.equal(events.at(-1).data.stopType, "run_timeout");
  assert.equal(events.at(-1).data.error, "run timeout");
  assert.equal(events.at(-1).data.canResume, false);

  machine.fail({ error: new Error("boom") });
  assert.equal(events.at(-1).data.state, AGENT_LIFECYCLE_BRANCH_STATE.FAILED);
  assert.equal(events.at(-1).data.branchState, AGENT_LIFECYCLE_BRANCH_STATE.FAILED);
  assert.equal(events.at(-1).data.error, "boom");
});
