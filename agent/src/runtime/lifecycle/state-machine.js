/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveErrorMessage } from "../../shared/utils/error-utils.js";
import { AGENT_RUN_EVENT } from "../../events/run-event.js";
import { emitEvent } from "../../events/emitter.js";
import { isPlainObject, text, isObjectLike } from "@noobot/shared/value";

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

function normalizeText(value = "") {
  return text(value);
}

function isBranchState(state = "") {
  return Object.values(AGENT_LIFECYCLE_BRANCH_STATE).includes(state);
}

function normalizeStoppedSnapshotPersistence(value = null) {
  if (isPlainObject(value)) {
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
  if (!isObjectLike(runtime) || !lifecycle) return runtime;
  runtime.agentLifecycle = lifecycle;
  return runtime;
}

function assertExecutionIdentityUnchanged(executionIdentity, origin, extra) {
  const conflicts = Object.keys(executionIdentity).filter(
    (field) =>
      normalizeText(extra?.[field]) && normalizeText(extra[field]) !== executionIdentity[field],
  );
  if (extra?.origin !== undefined && JSON.stringify(extra.origin) !== JSON.stringify(origin)) {
    conflicts.push("origin");
  }
  if (conflicts.length > 0) {
    throw Object.assign(
      new Error(`agent lifecycle execution identity is immutable: ${conflicts.join(",")}`),
      { code: "AGENT_LIFECYCLE_EXECUTION_IDENTITY_CONFLICT" },
    );
  }
}

export function createAgentLifecycleMachine({
  eventListener = null,
  now = () => new Date().toISOString(),
  basePayload = {},
} = {}) {
  let currentState = "";
  let currentBranchState = "";
  let revision = 0;
  let sequence = 0;
  let latestSnapshot = null;
  const executionIdentity = Object.freeze({
    executionId: normalizeText(basePayload?.executionId),
    executionKind: normalizeText(basePayload?.executionKind),
    parentExecutionId: normalizeText(basePayload?.parentExecutionId),
    rootExecutionId: normalizeText(basePayload?.rootExecutionId),
    stage: normalizeText(basePayload?.stage),
  });
  const executionOrigin = isPlainObject(basePayload?.origin) ? { ...basePayload.origin } : {};

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
    assertExecutionIdentityUnchanged(executionIdentity, executionOrigin, extra);
    revision += 1;
    sequence += 1;
    const payload = {
      ...(basePayload && typeof basePayload === "object" ? basePayload : {}),
      ...(extra && typeof extra === "object" ? extra : {}),
      state,
      branchState,
      previousState,
      timestamp: typeof now === "function" ? now() : new Date().toISOString(),
      sessionId: normalizeText(extra?.sessionId ?? basePayload?.sessionId),
      dialogProcessId: normalizeText(extra?.dialogProcessId ?? basePayload?.dialogProcessId),
      turnScopeId: normalizeText(extra?.turnScopeId ?? basePayload?.turnScopeId),
      resumeFromStoppedSnapshot:
        extra?.resumeFromStoppedSnapshot === true ||
        basePayload?.resumeFromStoppedSnapshot === true,
      ...executionIdentity,
      origin: { ...executionOrigin },
      revision,
      sequence,
    };
    latestSnapshot = { ...payload };
    emitEvent(eventListener, AGENT_RUN_EVENT.LIFECYCLE_STATE_CHANGED, payload);
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
        canResume:
          normalizeStoppedSnapshotPersistence(stoppedSnapshotPersistence).status === "saved",
        error: resolveErrorMessage(reason || error),
        stoppedSnapshotPersistence: normalizeStoppedSnapshotPersistence(stoppedSnapshotPersistence),
      });
    },
    interrupt({
      reason = "",
      error = "",
      stopType = AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED,
      stoppedSnapshotPersistence = null,
      ...extra
    } = {}) {
      return emit(AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED, {
        ...extra,
        stopType: normalizeText(stopType) || AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED,
        canResume: false,
        error: resolveErrorMessage(reason || error),
        stoppedSnapshotPersistence: normalizeStoppedSnapshotPersistence(stoppedSnapshotPersistence),
      });
    },
    fail({ error = "", ...extra } = {}) {
      return emit(AGENT_LIFECYCLE_BRANCH_STATE.FAILED, {
        ...extra,
        error: resolveErrorMessage(error),
      });
    },
    get state() {
      return currentState;
    },
    get branchState() {
      return currentBranchState;
    },
    get snapshot() {
      return latestSnapshot ? { ...latestSnapshot } : null;
    },
  };
}
