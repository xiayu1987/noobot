/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HARNESS_BUCKET_VERSION } from "../capabilities/handlers/shared/constants.js";

function objectField(target = {}, key = "") {
  const value = target?.[key];
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  target[key] = {};
  return target[key];
}

function resolveHarnessBucket(ctx = {}) {
  const agentContext =
    ctx?.agentContext && typeof ctx.agentContext === "object" ? ctx.agentContext : null;
  if (!agentContext) return null;
  const bindings = objectField(agentContext, "bindings");
  const extensions = objectField(bindings, "extensions");
  return objectField(extensions, "harness");
}

function migratePlanUpdateState(state = {}) {
  const counters = objectField(state, "counters");
  const pending = objectField(state, "pending");
  const flags = objectField(state, "flags");

  const revisionAttempts = Number.isFinite(Number(counters.planRevisionAttempts))
    ? Number(counters.planRevisionAttempts)
    : 0;
  const refinementAttempts = Number.isFinite(Number(counters.planRefinementAttempts))
    ? Number(counters.planRefinementAttempts)
    : 0;
  counters.planRevisionAttempts = revisionAttempts;
  counters.planRefinementAttempts = refinementAttempts;
  counters.planUpdateAttempts = revisionAttempts + refinementAttempts;

  if (
    pending.planUpdate === true &&
    pending.planRevision !== true &&
    pending.planRefinement !== true
  ) {
    const context =
      pending.planUpdateContext && typeof pending.planUpdateContext === "object"
        ? pending.planUpdateContext
        : null;
    if (String(pending.planUpdateStage || "").trim().toLowerCase() === "refinement") {
      pending.planRefinement = true;
      pending.planRefinementContext = context;
    } else {
      pending.planRevision = true;
      pending.planRevisionContext = context;
    }
  }

  for (const [activeKey, contextKey] of [
    ["planRevision", "planRevisionContext"],
    ["planRefinement", "planRefinementContext"],
  ]) {
    if (pending[activeKey] !== true) continue;
    const context =
      pending[contextKey] && typeof pending[contextKey] === "object"
        ? pending[contextKey]
        : {};
    pending[contextKey] = {
      targetMainStepIndexes: Array.isArray(context.targetMainStepIndexes)
        ? context.targetMainStepIndexes
        : [],
    };
  }

  for (const key of [
    "planUpdate",
    "planUpdateStage",
    "planUpdateContext",
    "planRevisionStage",
    "planRevisionTargetMainStepIndexes",
  ]) {
    delete pending[key];
  }
  for (const key of [
    "planRevisionCapturePending",
    "planRevisionCaptureStage",
    "planRevisionCaptureTargetMainStepIndexes",
  ]) {
    delete flags[key];
  }
  if (flags.planUpdateCapturePending !== true) flags.planUpdateCapturePending = false;
}

export function migrateHarnessBucket(ctx = {}) {
  const bucket = resolveHarnessBucket(ctx);
  if (!bucket) return { migrated: false, fromVersion: null, toVersion: null };
  const state = objectField(bucket, "state");
  const bucketVersion = Number(bucket.__harnessBucketVersion);
  const stateVersion = Number(state.__harnessBucketVersion);
  const fromVersion = Number.isFinite(bucketVersion)
    ? bucketVersion
    : Number.isFinite(stateVersion)
      ? stateVersion
      : 0;
  if (fromVersion === HARNESS_BUCKET_VERSION) {
    return { migrated: false, fromVersion, toVersion: HARNESS_BUCKET_VERSION };
  }
  if (fromVersion < 0 || fromVersion > HARNESS_BUCKET_VERSION) {
    throw new Error(`unsupported_harness_bucket_version:${fromVersion}`);
  }
  migratePlanUpdateState(state);
  delete state.__harnessBucketVersion;
  bucket.__harnessBucketVersion = HARNESS_BUCKET_VERSION;
  return { migrated: true, fromVersion, toVersion: HARNESS_BUCKET_VERSION };
}
