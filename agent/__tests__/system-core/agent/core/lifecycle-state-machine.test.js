import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_LIFECYCLE_BRANCH_STATE,
  AGENT_LIFECYCLE_EVENT,
  AGENT_LIFECYCLE_STATE,
  bindLifecycleToRuntime,
  createAgentLifecycleMachine,
  isResumeInitializingFirstModelTurn,
  resolveInitialLifecycleState,
  syncLifecycleRuntimeState,
} from "../../../../src/system-core/agent/core/lifecycle/state-machine.js";

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

  assert.deepEqual(events.map((item) => item.event), [
    AGENT_LIFECYCLE_EVENT,
    AGENT_LIFECYCLE_EVENT,
    AGENT_LIFECYCLE_EVENT,
  ]);
  assert.equal(events[0].data.state, "resume_initializing");
  assert.equal(events[0].data.phase, "继续初始化");
  assert.equal(events[0].data.previousState, "");
  assert.equal(events[1].data.previousState, "resume_initializing");
  assert.equal(events[2].data.state, "failed");
  assert.equal(events[2].data.branchState, "failed");
  assert.equal(events[2].data.previousState, "running");
  assert.equal(events[2].data.error, "boom");
  assert.equal(machine.state, "running");
  assert.equal(machine.branchState, "failed");
});

test("isResumeInitializingFirstModelTurn only guards stopped snapshot resume first turn", () => {
  assert.equal(
    isResumeInitializingFirstModelTurn({ resumeFromStoppedSnapshot: true, agentLifecycleState: "resume_initializing" }, 1),
    true,
  );
  assert.equal(
    isResumeInitializingFirstModelTurn({ resumeFromStoppedSnapshot: true, agentLifecycleState: "running" }, 1),
    false,
  );
  assert.equal(
    isResumeInitializingFirstModelTurn({ resumeFromStoppedSnapshot: false, agentLifecycleState: "resume_initializing" }, 1),
    false,
  );
  assert.equal(
    isResumeInitializingFirstModelTurn({ resumeFromStoppedSnapshot: true, agentLifecycleState: "resume_initializing" }, 2),
    false,
  );
});

test("agent lifecycle helpers resolve initial state and sync runtime fields", () => {
  assert.equal(resolveInitialLifecycleState({}), AGENT_LIFECYCLE_STATE.INITIALIZING);
  assert.equal(
    resolveInitialLifecycleState({ resumeFromStoppedSnapshot: true }),
    AGENT_LIFECYCLE_STATE.RESUME_INITIALIZING,
  );

  const machine = createAgentLifecycleMachine();
  machine.enterInitializing({ resumeFromStoppedSnapshot: true });
  const runtime = {};

  bindLifecycleToRuntime(runtime, machine);
  assert.equal(runtime.agentLifecycle, machine);
  assert.equal(runtime.agentLifecycleState, AGENT_LIFECYCLE_STATE.RESUME_INITIALIZING);
  assert.equal(runtime.agentLifecycleInitialState, AGENT_LIFECYCLE_STATE.RESUME_INITIALIZING);

  machine.enterRunning();
  syncLifecycleRuntimeState(runtime, machine);
  assert.equal(runtime.agentLifecycleState, AGENT_LIFECYCLE_STATE.RUNNING);
  assert.equal(runtime.agentLifecycleInitialState, AGENT_LIFECYCLE_STATE.RESUME_INITIALIZING);
});

test("agent lifecycle phase methods and terminal branch payloads are standardized", () => {
  const events = [];
  const machine = createAgentLifecycleMachine({
    eventListener: { onEvent: (event) => events.push(event) },
    now: () => "2026-01-01T00:00:00.000Z",
  });

  machine.enterInitializing({ resumeFromStoppedSnapshot: false });
  machine.enterRunning();
  machine.enterPersisting();
  machine.enterMemory();
  machine.complete();

  assert.deepEqual(events.map((item) => item.data.state), [
    AGENT_LIFECYCLE_STATE.INITIALIZING,
    AGENT_LIFECYCLE_STATE.RUNNING,
    AGENT_LIFECYCLE_STATE.PERSISTING,
    AGENT_LIFECYCLE_STATE.MEMORY,
    AGENT_LIFECYCLE_STATE.COMPLETED,
  ]);

  assert.equal(typeof machine.stop, "undefined");

  machine.userStop({ reason: "user stopped" });
  assert.equal(events.at(-1).data.state, AGENT_LIFECYCLE_BRANCH_STATE.USER_STOPPED);
  assert.equal(events.at(-1).data.branchState, AGENT_LIFECYCLE_BRANCH_STATE.USER_STOPPED);
  assert.equal(events.at(-1).data.stopType, "user_stop");
  assert.equal(events.at(-1).data.canResume, false);
  assert.equal(events.at(-1).data.error, "user stopped");
  assert.deepEqual(events.at(-1).data.stoppedSnapshotPersistence, {
    status: "skipped",
    reason: "missing_persistence_result",
    source: "lifecycle_stop",
    messageCount: 0,
    systemCount: 0,
    historyCount: 0,
    incrementalCount: 0,
  });

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

  machine.interrupt({ reason: "timeout", stopType: "timeout" });
  assert.equal(events.at(-1).data.state, AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED);
  assert.equal(events.at(-1).data.branchState, AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED);
  assert.equal(events.at(-1).data.stopType, "timeout");
  assert.equal(events.at(-1).data.canResume, false);

  machine.fail({ error: new Error("boom") });
  assert.equal(events.at(-1).data.state, AGENT_LIFECYCLE_BRANCH_STATE.FAILED);
  assert.equal(events.at(-1).data.branchState, AGENT_LIFECYCLE_BRANCH_STATE.FAILED);
  assert.equal(events.at(-1).data.error, "boom");
});
