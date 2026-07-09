/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const AGENT_LIFECYCLE_STATE = Object.freeze({
  INITIALIZING: "initializing",
  RESUME_INITIALIZING: "resume_initializing",
  RUNNING: "running",
  PERSISTING: "persisting",
  MEMORY: "memory",
  COMPLETED: "completed",
});

export const AGENT_LIFECYCLE_BRANCH_STATE = Object.freeze({
  USER_STOPPED: "user_stopped",
  INTERRUPTED: "interrupted",
  FAILED: "failed",
});

export const AGENT_LIFECYCLE_EVENT = "agent_lifecycle_state_changed";

const STATE_PHASE_LABEL = Object.freeze({
  [AGENT_LIFECYCLE_STATE.INITIALIZING]: "初始化",
  [AGENT_LIFECYCLE_STATE.RESUME_INITIALIZING]: "继续初始化",
  [AGENT_LIFECYCLE_STATE.RUNNING]: "启动",
  [AGENT_LIFECYCLE_STATE.PERSISTING]: "持久化",
  [AGENT_LIFECYCLE_STATE.MEMORY]: "记忆",
  [AGENT_LIFECYCLE_STATE.COMPLETED]: "完成",
  [AGENT_LIFECYCLE_BRANCH_STATE.USER_STOPPED]: "用户停止",
  [AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED]: "中断",
  [AGENT_LIFECYCLE_BRANCH_STATE.FAILED]: "异常",
});

function normalizeText(value = "") {
  return String(value || "").trim();
}

function isBranchState(state = "") {
  return Object.values(AGENT_LIFECYCLE_BRANCH_STATE).includes(state);
}

function normalizeErrorMessage(error) {
  if (!error) return "";
  return String(error?.message || error || "").trim();
}

function normalizeStoppedSnapshotPersistence(value = null) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const status = normalizeText(value.status);
    return {
      ...value,
      status: status || "unknown",
    };
  }
  return {
    status: "skipped",
    reason: "missing_persistence_result",
    source: "lifecycle_stop",
    messageCount: 0,
    systemCount: 0,
    historyCount: 0,
    incrementalCount: 0,
  };
}

export function resolveInitialLifecycleState(runConfig = {}) {
  return runConfig?.resumeFromStoppedSnapshot === true
    ? AGENT_LIFECYCLE_STATE.RESUME_INITIALIZING
    : AGENT_LIFECYCLE_STATE.INITIALIZING;
}

export function syncLifecycleRuntimeState(runtime = null, lifecycle = null) {
  if (!runtime || typeof runtime !== "object" || !lifecycle) return runtime;
  runtime.agentLifecycle = lifecycle;
  runtime.agentLifecycleState = lifecycle.state;
  return runtime;
}

export function bindLifecycleToRuntime(runtime = null, lifecycle = null) {
  syncLifecycleRuntimeState(runtime, lifecycle);
  if (runtime && typeof runtime === "object" && lifecycle) {
    runtime.agentLifecycleInitialState = lifecycle.state;
  }
  return runtime;
}

export function createAgentLifecycleMachine({
  eventListener = null,
  now = () => new Date().toISOString(),
  basePayload = {},
} = {}) {
  let currentState = "";
  let currentBranchState = "";

  const emit = (nextState, extra = {}) => {
    const branchState = isBranchState(nextState) ? nextState : "";
    const state = branchState || nextState;
    if (!state) return null;
    const previousState = currentBranchState || currentState || "";
    if (branchState) {
      currentBranchState = branchState;
    } else {
      currentState = state;
      currentBranchState = "";
    }
    const payload = {
      ...(basePayload && typeof basePayload === "object" ? basePayload : {}),
      ...(extra && typeof extra === "object" ? extra : {}),
      state,
      branchState,
      phase: STATE_PHASE_LABEL[state] || state,
      previousState,
      timestamp: typeof now === "function" ? now() : new Date().toISOString(),
      sessionId: normalizeText(extra?.sessionId ?? basePayload?.sessionId),
      dialogProcessId: normalizeText(extra?.dialogProcessId ?? basePayload?.dialogProcessId),
      turnScopeId: normalizeText(extra?.turnScopeId ?? basePayload?.turnScopeId),
      resumeFromStoppedSnapshot: extra?.resumeFromStoppedSnapshot === true || basePayload?.resumeFromStoppedSnapshot === true,
    };
    if (eventListener?.onEvent) {
      eventListener.onEvent({ event: AGENT_LIFECYCLE_EVENT, data: payload });
    }
    return payload;
  };

  return {
    transition: emit,
    enterInitializing(runConfig = {}) {
      return emit(resolveInitialLifecycleState(runConfig));
    },
    enterRunning(extra = {}) {
      return emit(AGENT_LIFECYCLE_STATE.RUNNING, extra);
    },
    enterPersisting(extra = {}) {
      return emit(AGENT_LIFECYCLE_STATE.PERSISTING, extra);
    },
    enterMemory(extra = {}) {
      return emit(AGENT_LIFECYCLE_STATE.MEMORY, extra);
    },
    complete(extra = {}) {
      return emit(AGENT_LIFECYCLE_STATE.COMPLETED, extra);
    },
    userStop({ reason = "", error = "", stoppedSnapshotPersistence = null, ...extra } = {}) {
      return emit(AGENT_LIFECYCLE_BRANCH_STATE.USER_STOPPED, {
        ...extra,
        stopType: "user_stop",
        canResume: normalizeStoppedSnapshotPersistence(stoppedSnapshotPersistence).status === "saved",
        error: normalizeText(reason || error),
        stoppedSnapshotPersistence: normalizeStoppedSnapshotPersistence(stoppedSnapshotPersistence),
      });
    },
    interrupt({ reason = "", error = "", stopType = "interrupted", stoppedSnapshotPersistence = null, ...extra } = {}) {
      return emit(AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED, {
        ...extra,
        stopType: normalizeText(stopType) || "interrupted",
        canResume: false,
        error: normalizeText(reason || error),
        stoppedSnapshotPersistence: normalizeStoppedSnapshotPersistence(stoppedSnapshotPersistence),
      });
    },
    fail({ error = "", ...extra } = {}) {
      return emit(AGENT_LIFECYCLE_BRANCH_STATE.FAILED, {
        ...extra,
        error: normalizeErrorMessage(error),
      });
    },
    get state() {
      return currentState;
    },
    get branchState() {
      return currentBranchState;
    },
  };
}

export function isResumeInitializingFirstModelTurn(runtime = {}, turn = 0) {
  return (
    runtime?.resumeFromStoppedSnapshot === true &&
    (runtime?.agentLifecycleState === AGENT_LIFECYCLE_STATE.RESUME_INITIALIZING ||
      runtime?.agentLifecycleInitialState === AGENT_LIFECYCLE_STATE.RESUME_INITIALIZING ||
      runtime?.agentLifecycle?.state === AGENT_LIFECYCLE_STATE.RESUME_INITIALIZING ||
      !runtime?.agentLifecycleState) &&
    Number(turn) === 1
  );
}
