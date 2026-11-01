/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveErrorMessage } from "../../shared/utils/error-utils.js";
import { EXECUTION_ABORT_TYPE } from "@noobot/session-protocol/execution-abort";
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

const STOPPED_SNAPSHOT_PERSISTENCE_STATUSES = new Set(["saved", "skipped", "failed"]);
const INTERRUPT_STOP_TYPES = new Set(
  Object.values(EXECUTION_ABORT_TYPE).filter((type) => type !== EXECUTION_ABORT_TYPE.USER_STOP),
);

function requireStoppedSnapshotPersistence(value) {
  if (!isPlainObject(value) || !STOPPED_SNAPSHOT_PERSISTENCE_STATUSES.has(value.status)) {
    throw new TypeError("agent lifecycle stop requires a stoppedSnapshotPersistence result");
  }
  return { ...value };
}

function requireStopReason(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("agent lifecycle stop requires reason text");
  }
  return value.trim();
}

function requireStopType(value) {
  if (!INTERRUPT_STOP_TYPES.has(value)) {
    throw new TypeError("agent lifecycle interrupt requires a protocol abort stopType");
  }
  return value;
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
  if (typeof basePayload.resumeFromStoppedSnapshot !== "boolean") {
    throw new TypeError("agent lifecycle requires resumeFromStoppedSnapshot");
  }
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
    if (Object.hasOwn(extra, "resumeFromStoppedSnapshot")) {
      throw new TypeError("agent lifecycle resumeFromStoppedSnapshot is owned by basePayload");
    }
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
      resumeFromStoppedSnapshot: basePayload.resumeFromStoppedSnapshot,
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
    userStop({ reason, stoppedSnapshotPersistence, ...extra }) {
      const persistence = requireStoppedSnapshotPersistence(stoppedSnapshotPersistence);
      return emit(AGENT_LIFECYCLE_BRANCH_STATE.USER_STOPPED, {
        ...extra,
        stopType: "user_stop",
        canResume: persistence.status === "saved",
        error: requireStopReason(reason),
        stoppedSnapshotPersistence: persistence,
      });
    },
    interrupt({ reason, stopType, stoppedSnapshotPersistence, ...extra }) {
      return emit(AGENT_LIFECYCLE_BRANCH_STATE.INTERRUPTED, {
        ...extra,
        stopType: requireStopType(stopType),
        canResume: false,
        error: requireStopReason(reason),
        stoppedSnapshotPersistence: requireStoppedSnapshotPersistence(stoppedSnapshotPersistence),
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

    get origin() {
      return { ...executionOrigin };
    },
  };
}
