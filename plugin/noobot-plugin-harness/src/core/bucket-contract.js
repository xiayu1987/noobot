/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { WORKFLOW_PARAMS } from "./workflow-params.js";
import {
  DEFAULT_HARNESS_COUNTERS,
  DEFAULT_HARNESS_FLAGS,
  DEFAULT_HARNESS_PENDING,
  DEFAULT_HARNESS_SIGNALS,
  GUIDANCE_REASON,
  HARNESS_BUCKET_VERSION,
} from "../capabilities/handlers/shared/constants.js";

export function createHarnessBucket() {
  return {
    __harnessBucketVersion: HARNESS_BUCKET_VERSION,
    state: {
      counters: { ...DEFAULT_HARNESS_COUNTERS },
      flags: { ...DEFAULT_HARNESS_FLAGS },
      signals: { ...DEFAULT_HARNESS_SIGNALS },
      pending: { ...DEFAULT_HARNESS_PENDING },
      pendingMeta: { pending: {}, flags: {}, lastWarnHookTurn: null },
    },
    acceptanceReports: [],
    phaseAcceptanceReports: [],
    reviewReports: [],
    planningRawOutputs: [],
    planRevisions: [],
    planRefinementRecords: [],
    completedDialogProcessIds: [],
    planAcceptanceStatusByPlanId: {},
    summaryText: "",
    summaryFullText: "",
    planText: "",
    globalRevisionCount: 0,
    lastRevisionChangedMainStepIndexes: [],
    lastPlanningRawOutput: null,
    logs: { planning: [], guidance: [], acceptance: [], review: [] },
  };
}

function requireValue(condition, path) {
  if (!condition) throw new TypeError(`invalid_harness_state:${path}`);
}

export function requireHarnessPlanUpdateStage(stage) {
  requireValue(
    Object.values(WORKFLOW_PARAMS.guidance.decisions.stage).includes(stage),
    "planUpdateStage",
  );
  return stage;
}

export function requireHarnessRevisionCount(value) {
  requireValue(Number.isSafeInteger(value) && value >= 0, "globalRevisionCount");
  return value;
}

export function requireHarnessStateField(group, key, value) {
  const defaults = createHarnessBucket().state[group];
  requireValue(isPlainObject(defaults) && Object.hasOwn(defaults, key), `${group}.${key}`);
  requireDefaultsShape({ [key]: value }, { [key]: defaults[key] }, group);
  if (group === "pending" && key === "acceptanceSemanticValidation" && value !== null) {
    requireHarnessReportIndex(value.reportIndex);
  }
  return value;
}

export function requireHarnessReportIndex(value) {
  requireValue(Number.isSafeInteger(value) && value >= 0, "acceptanceReportIndex");
  return value;
}

function requireDefaultsShape(value, defaults, path) {
  requireValue(isPlainObject(value), path);
  for (const [key, initial] of Object.entries(defaults)) {
    const item = value[key];
    if (typeof initial === "number") {
      requireValue(Number.isSafeInteger(item) && item >= 0, `${path}.${key}`);
    } else if (initial === null) {
      const valid =
        key === "guidance"
          ? item === null || Object.values(GUIDANCE_REASON).includes(item)
          : item === null || isPlainObject(item) || Array.isArray(item);
      requireValue(valid, `${path}.${key}`);
    } else {
      requireValue(typeof item === typeof initial, `${path}.${key}`);
    }
  }
}

export function assertHarnessState(state) {
  requireValue(isPlainObject(state), "state");
  requireDefaultsShape(state.counters, DEFAULT_HARNESS_COUNTERS, "counters");
  requireDefaultsShape(state.flags, DEFAULT_HARNESS_FLAGS, "flags");
  requireDefaultsShape(state.signals, DEFAULT_HARNESS_SIGNALS, "signals");
  requireDefaultsShape(state.pending, DEFAULT_HARNESS_PENDING, "pending");
  requireHarnessStateField(
    "pending",
    "acceptanceSemanticValidation",
    state.pending.acceptanceSemanticValidation,
  );
  if (state.flags.acceptanceSemanticValidationCapturePending) {
    requireHarnessReportIndex(state.flags.acceptanceSemanticValidationCaptureReportIndex);
  }
  requireValue(isPlainObject(state.pendingMeta), "pendingMeta");
  for (const group of ["pending", "flags"]) {
    const times = state.pendingMeta[group];
    requireValue(isPlainObject(times), `pendingMeta.${group}`);
    for (const [key, value] of Object.entries(times)) {
      requireValue(
        value === null || (Number.isSafeInteger(value) && value >= 0),
        `pendingMeta.${group}.${key}`,
      );
    }
  }
  return state;
}

export function assertHarnessBucket(bucket) {
  requireValue(isPlainObject(bucket), "bucket");
  if (bucket.__harnessBucketVersion !== HARNESS_BUCKET_VERSION) {
    throw new Error(`harness_bucket_migration_required:${bucket.__harnessBucketVersion}`);
  }
  assertHarnessState(bucket.state);
  const defaults = createHarnessBucket();
  for (const [key, initial] of Object.entries(defaults)) {
    if (Array.isArray(initial)) requireValue(Array.isArray(bucket[key]), key);
    if (typeof initial === "string") requireValue(typeof bucket[key] === "string", key);
  }
  requireHarnessRevisionCount(bucket.globalRevisionCount);
  requireValue(isPlainObject(bucket.planAcceptanceStatusByPlanId), "planAcceptanceStatusByPlanId");
  requireValue(
    bucket.lastPlanningRawOutput === null || isPlainObject(bucket.lastPlanningRawOutput),
    "lastPlanningRawOutput",
  );
  requireValue(isPlainObject(bucket.logs), "logs");
  for (const key of Object.keys(defaults.logs))
    requireValue(Array.isArray(bucket.logs[key]), `logs.${key}`);
  return bucket;
}

function initializeLegacyFields(target, defaults) {
  for (const [field, initial] of Object.entries(defaults)) {
    if (target[field] === undefined) target[field] = initial;
  }
}

function initializeLegacyPendingTimes(bucket, group) {
  const times = bucket.state.pendingMeta[group];
  requireValue(isPlainObject(times), `pendingMeta.${group}`);
  for (const [key, value] of Object.entries(bucket.state[group])) {
    const active =
      group === "pending"
        ? value !== null && value !== false
        : key.endsWith("CapturePending") && value === true;
    if (active && times[key] === undefined) times[key] = null;
  }
}

export function initializeLegacyHarnessBucket(bucket) {
  const defaults = createHarnessBucket();
  for (const [key, value] of Object.entries(defaults)) {
    if (bucket[key] === undefined) bucket[key] = value;
  }
  requireValue(isPlainObject(bucket.state), "state");
  for (const [key, value] of Object.entries(defaults.state)) {
    if (bucket.state[key] === undefined) bucket.state[key] = value;
    requireValue(isPlainObject(bucket.state[key]), key);
    initializeLegacyFields(bucket.state[key], value);
  }
  requireValue(isPlainObject(bucket.logs), "logs");
  for (const [key, value] of Object.entries(defaults.logs)) {
    if (bucket.logs[key] === undefined) bucket.logs[key] = value;
  }
  for (const group of ["pending", "flags"]) {
    initializeLegacyPendingTimes(bucket, group);
  }
}
