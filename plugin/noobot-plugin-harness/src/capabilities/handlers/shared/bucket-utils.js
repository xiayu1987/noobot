/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  DEFAULT_HARNESS_COUNTERS,
  DEFAULT_HARNESS_FLAGS,
  DEFAULT_HARNESS_PENDING,
  DEFAULT_HARNESS_SIGNALS,
  HARNESS_BUCKET_VERSION,
} from "./constants.js";
import { resolveLocale } from "./i18n.js";

function ensureObjectField(target = {}, key = "") {
  if (!target || !key) return {};
  const current = target[key];
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    target[key] = {};
  }
  return target[key];
}

function ensureArrayField(target = {}, key = "") {
  if (!target || !key) return [];
  if (!Array.isArray(target[key])) target[key] = [];
  return target[key];
}

function fillMissingDefaults(target = {}, defaults = {}) {
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] === undefined) target[key] = value;
  }
}

function bindStateVersionAlias(bucket = {}, state = {}) {
  if (!bucket || typeof bucket !== "object") return;
  if (!state || typeof state !== "object") return;
  const bucketVersion = Number(bucket.__harnessBucketVersion);
  if (!Number.isFinite(bucketVersion)) {
    bucket.__harnessBucketVersion = HARNESS_BUCKET_VERSION;
  }
  Object.defineProperty(state, "__harnessBucketVersion", {
    enumerable: true,
    configurable: true,
    get() {
      return Number(bucket.__harnessBucketVersion) || HARNESS_BUCKET_VERSION;
    },
    set(nextValue) {
      const normalized = Number(nextValue);
      bucket.__harnessBucketVersion = Number.isFinite(normalized)
        ? normalized
        : HARNESS_BUCKET_VERSION;
    },
  });
}

function migrateLegacyPlanUpdateState(state = {}) {
  if (!state || typeof state !== "object") return;
  const counters = state.counters && typeof state.counters === "object" ? state.counters : {};
  const pending = state.pending && typeof state.pending === "object" ? state.pending : {};
  const flags = state.flags && typeof state.flags === "object" ? state.flags : {};

  if (
    pending.planUpdate === false &&
    pending.planRevision !== true &&
    pending.planRefinement !== true
  ) {
    pending.planRevision = false;
    pending.planRevisionContext = null;
    pending.planRefinement = false;
    pending.planRefinementContext = null;
    pending.planUpdateStage = "";
    pending.planUpdateContext = null;
  }

  const hasRevisionAttempts = Number.isFinite(Number(counters.planRevisionAttempts));
  const hasRefinementAttempts = Number.isFinite(Number(counters.planRefinementAttempts));
  const normalizedRevisionAttempts = hasRevisionAttempts ? Number(counters.planRevisionAttempts) : 0;
  const normalizedRefinementAttempts = hasRefinementAttempts ? Number(counters.planRefinementAttempts) : 0;

  if (!hasRevisionAttempts) {
    counters.planRevisionAttempts = 0;
  }
  if (!hasRefinementAttempts) {
    counters.planRefinementAttempts = 0;
  }

  const revisionAttempts = Number.isFinite(Number(counters.planRevisionAttempts))
    ? Number(counters.planRevisionAttempts)
    : normalizedRevisionAttempts;
  const refinementAttempts = Number.isFinite(Number(counters.planRefinementAttempts))
    ? Number(counters.planRefinementAttempts)
    : normalizedRefinementAttempts;
  counters.planUpdateAttempts = revisionAttempts + refinementAttempts;

  if (pending.planUpdate !== true && pending.planRevision === true) {
    pending.planUpdate = true;
  }

  if (pending.planRevision === true) {
    const revisionContext =
      pending.planRevisionContext && typeof pending.planRevisionContext === "object"
        ? pending.planRevisionContext
        : pending.planUpdateContext && typeof pending.planUpdateContext === "object"
          ? pending.planUpdateContext
        : {};
    const normalizedRevisionContext = {
      summaryText: String(revisionContext.summaryText || "").trim(),
      targetMainStepIndexes: Array.isArray(revisionContext.targetMainStepIndexes)
        ? revisionContext.targetMainStepIndexes
        : [],
    };
    pending.planRevisionContext = normalizedRevisionContext;
    pending.planUpdate = true;
    pending.planUpdateStage = "revision";
    pending.planUpdateContext = normalizedRevisionContext;
  } else if (pending.planRefinement === true) {
    const refinementContext =
      pending.planRefinementContext && typeof pending.planRefinementContext === "object"
        ? pending.planRefinementContext
        : pending.planUpdateContext && typeof pending.planUpdateContext === "object"
          ? pending.planUpdateContext
        : {};
    const normalizedRefinementContext = {
      summaryText: String(refinementContext.summaryText || "").trim(),
      targetMainStepIndexes: Array.isArray(refinementContext.targetMainStepIndexes)
        ? refinementContext.targetMainStepIndexes
        : [],
    };
    pending.planRefinementContext = normalizedRefinementContext;
    pending.planUpdate = true;
    pending.planUpdateStage = "refinement";
    pending.planUpdateContext = normalizedRefinementContext;
  }

  if ("planRevisionStage" in pending) delete pending.planRevisionStage;
  if ("planRevisionTargetMainStepIndexes" in pending) delete pending.planRevisionTargetMainStepIndexes;
  if ("summaryText" in pending) delete pending.summaryText;

  if ("planRevisionCapturePending" in flags) delete flags.planRevisionCapturePending;
  if ("planRevisionCaptureStage" in flags) delete flags.planRevisionCaptureStage;
  if ("planRevisionCaptureSummaryText" in flags) delete flags.planRevisionCaptureSummaryText;
  if ("planRevisionCaptureTargetMainStepIndexes" in flags) {
    delete flags.planRevisionCaptureTargetMainStepIndexes;
  }
  if (flags.planUpdateCapturePending !== true) flags.planUpdateCapturePending = false;
}

export function ensureHarnessBucket(ctx = {}) {
  const agentContext =
    ctx?.agentContext && typeof ctx.agentContext === "object" ? ctx.agentContext : null;
  if (!agentContext) return null;
  const payload = ensureObjectField(agentContext, "payload");
  const bucket = ensureObjectField(payload, "harness");
  const state = ensureObjectField(bucket, "state");
  const legacyStateVersion =
    Number.isFinite(Number(state.__harnessBucketVersion))
      ? Number(state.__harnessBucketVersion)
      : null;
  bindStateVersionAlias(bucket, state);

  const isFastPathReady =
    bucket.__harnessBucketVersion === HARNESS_BUCKET_VERSION &&
    typeof bucket.planText === "string" &&
    Array.isArray(bucket.taskChecklist) &&
    Array.isArray(bucket.acceptanceReports) &&
    Array.isArray(bucket.reviewReports) &&
    Array.isArray(bucket.planningRawOutputs) &&
    bucket.logs &&
    typeof bucket.logs === "object" &&
    Array.isArray(bucket.logs.planning) &&
    Array.isArray(bucket.logs.guidance) &&
    Array.isArray(bucket.logs.acceptance) &&
    Array.isArray(bucket.logs.review);

  if (!isFastPathReady) {
    const counters = ensureObjectField(state, "counters");
    const flags = ensureObjectField(state, "flags");
    const signals = ensureObjectField(state, "signals");
    const pending = ensureObjectField(state, "pending");
    fillMissingDefaults(counters, DEFAULT_HARNESS_COUNTERS);
    fillMissingDefaults(flags, DEFAULT_HARNESS_FLAGS);
    fillMissingDefaults(signals, DEFAULT_HARNESS_SIGNALS);
    fillMissingDefaults(pending, DEFAULT_HARNESS_PENDING);
    migrateLegacyPlanUpdateState(state);

    ensureArrayField(bucket, "taskChecklist");
    ensureArrayField(bucket, "acceptanceReports");
    ensureArrayField(bucket, "phaseAcceptanceReports");
    ensureArrayField(bucket, "reviewReports");
    ensureArrayField(bucket, "planningRawOutputs");
    ensureArrayField(bucket, "completedDialogProcessIds");
    if (typeof bucket.summaryText !== "string") bucket.summaryText = "";
    if (typeof bucket.planText !== "string") bucket.planText = "";
    if (!Number.isFinite(Number(bucket.globalRevisionCount))) bucket.globalRevisionCount = 0;
    if (!Array.isArray(bucket.lastRevisionChangedMainStepIndexes)) {
      bucket.lastRevisionChangedMainStepIndexes = [];
    }
    if (
      !("lastPlanningRawOutput" in bucket) ||
      (bucket.lastPlanningRawOutput && typeof bucket.lastPlanningRawOutput !== "object")
    ) {
      bucket.lastPlanningRawOutput = null;
    }
    const logs = ensureObjectField(bucket, "logs");
    ensureArrayField(logs, "planning");
    ensureArrayField(logs, "guidance");
    ensureArrayField(logs, "acceptance");
    ensureArrayField(logs, "review");
    bucket.__harnessBucketVersion = HARNESS_BUCKET_VERSION;
  } else if (
    legacyStateVersion !== null &&
    bucket.__harnessBucketVersion !== HARNESS_BUCKET_VERSION &&
    legacyStateVersion === HARNESS_BUCKET_VERSION
  ) {
    // Backward-compat recovery for payloads that only carried state version.
    bucket.__harnessBucketVersion = HARNESS_BUCKET_VERSION;
  }

  const locale = resolveLocale(ctx);
  state.locale = locale;
  return { bucket, state };
}
