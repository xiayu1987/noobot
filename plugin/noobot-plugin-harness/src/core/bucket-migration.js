/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HARNESS_BUCKET_VERSION } from "../capabilities/handlers/shared/constants.js";
import { isPlainObject, text } from "@noobot/shared/value";

function objectField(target = {}, key = "") {
  const value = target?.[key];
  if (isPlainObject(value)) return value;
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
    if (text(pending.planUpdateStage).toLowerCase() === "refinement") {
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
      pending[contextKey] && typeof pending[contextKey] === "object" ? pending[contextKey] : {};
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

function removeTaskChecklistFields(bucket = {}) {
  delete bucket.taskChecklist;
  delete bucket.taskChecklistSource;
}

function arrayField(target = {}, key = "") {
  return Array.isArray(target[key]) ? target[key] : [];
}

function listPersistedAcceptanceReports(bucket = {}) {
  const reviewReports = [bucket.lastReviewReport, ...arrayField(bucket, "reviewReports")];
  return [
    bucket.lastAcceptanceReport,
    ...arrayField(bucket, "acceptanceReports"),
    ...reviewReports.map((review) => review?.acceptanceReport),
  ].filter(isPlainObject);
}

function removeAcceptanceReportDuplicateFields(bucket = {}) {
  for (const report of listPersistedAcceptanceReports(bucket)) {
    delete report.taskChecklist;
    if (isPlainObject(report.plan)) delete report.plan.planText;
  }
}

const REMOVED_CHECKLIST_ITEM_FIELDS = Object.freeze([
  "owner",
  "subOwners",
  "input",
  "output",
  "files",
]);

function removeChecklistItemDeadFields(bucket = {}) {
  for (const report of listPersistedAcceptanceReports(bucket)) {
    for (const item of arrayField(report, "finalPlanChecklist").filter(isPlainObject)) {
      for (const key of REMOVED_CHECKLIST_ITEM_FIELDS) delete item[key];
    }
  }
}

function removePlanDocumentCache(bucket = {}) {
  delete bucket.planDocument;
}

function removeDeadStateFlags(state = {}) {
  const flags = objectField(state, "flags");
  delete flags.acceptanceReportAppendedToFinalOutput;
  delete flags.planUpdateCaptureSummaryText;
}

function removeAcceptanceCompletedFlag(state = {}) {
  delete objectField(state, "flags").acceptanceCompleted;
}

function dropMalformedLastAcceptanceReport(bucket = {}) {
  if (bucket.lastAcceptanceReport != null && !isPlainObject(bucket.lastAcceptanceReport)) {
    delete bucket.lastAcceptanceReport;
  }
}

function ensurePlanAcceptanceStatusMap(bucket = {}) {
  const map = objectField(bucket, "planAcceptanceStatusByPlanId");
  for (const [planId, entry] of Object.entries(map)) {
    if (!isPlainObject(entry)) delete map[planId];
  }
}

const MIGRATION_STEPS = Object.freeze([
  { toVersion: 4, migrate: ({ state }) => migratePlanUpdateState(state) },
  { toVersion: 5, migrate: ({ bucket }) => removeTaskChecklistFields(bucket) },
  { toVersion: 6, migrate: ({ bucket }) => removeAcceptanceReportDuplicateFields(bucket) },
  { toVersion: 7, migrate: ({ bucket }) => removeChecklistItemDeadFields(bucket) },
  { toVersion: 8, migrate: ({ bucket }) => removePlanDocumentCache(bucket) },
  { toVersion: 9, migrate: ({ state }) => removeDeadStateFlags(state) },
  {
    toVersion: 10,
    migrate: ({ bucket, state }) => {
      ensurePlanAcceptanceStatusMap(bucket);
      removeAcceptanceCompletedFlag(state);
      dropMalformedLastAcceptanceReport(bucket);
    },
  },
]);

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
  for (const step of MIGRATION_STEPS) {
    if (step.toVersion > fromVersion) step.migrate({ bucket, state });
  }
  delete state.__harnessBucketVersion;
  bucket.__harnessBucketVersion = HARNESS_BUCKET_VERSION;
  return { migrated: true, fromVersion, toVersion: HARNESS_BUCKET_VERSION };
}
