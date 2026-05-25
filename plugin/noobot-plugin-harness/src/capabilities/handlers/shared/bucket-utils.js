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

function migrateLegacyPlanUpdateState(state = {}) {
  if (!state || typeof state !== "object") return;
  const counters = state.counters && typeof state.counters === "object" ? state.counters : {};
  const pending = state.pending && typeof state.pending === "object" ? state.pending : {};
  const flags = state.flags && typeof state.flags === "object" ? state.flags : {};

  const hasUnifiedAttempts = Number.isFinite(Number(counters.planUpdateAttempts));
  const normalizedUnifiedAttempts = hasUnifiedAttempts ? Number(counters.planUpdateAttempts) : 0;
  const legacyAttempts = Number.isFinite(Number(counters.planRevisionAttempts))
    ? Number(counters.planRevisionAttempts)
    : 0;
  if (!hasUnifiedAttempts || (normalizedUnifiedAttempts === 0 && legacyAttempts > 0)) {
    counters.planUpdateAttempts = legacyAttempts;
  }

  const normalizedLegacyStage =
    String(pending.planRevisionStage || "").trim().toLowerCase() === "revision"
      ? "revision"
      : String(pending.planRevisionStage || "").trim()
        ? "refinement"
        : "";
  if (pending.planUpdate !== true && pending.planRevision === true) {
    pending.planUpdate = true;
  }
  if (!String(pending.planUpdateStage || "").trim() && normalizedLegacyStage) {
    pending.planUpdateStage = normalizedLegacyStage;
  }
  if (
    (pending.planUpdateContext === null || pending.planUpdateContext === undefined) &&
    (String(pending.summaryText || "").trim() ||
      Array.isArray(pending.planRevisionTargetMainStepIndexes))
  ) {
    pending.planUpdateContext = {
      summaryText: String(pending.summaryText || "").trim(),
      targetMainStepIndexes: Array.isArray(pending.planRevisionTargetMainStepIndexes)
        ? pending.planRevisionTargetMainStepIndexes
        : [],
    };
  }

  if (flags.planUpdateCapturePending !== true && flags.planRevisionCapturePending === true) {
    flags.planUpdateCapturePending = true;
  }
}

export function ensureHarnessBucket(ctx = {}) {
  const agentContext =
    ctx?.agentContext && typeof ctx.agentContext === "object" ? ctx.agentContext : null;
  if (!agentContext) return null;
  const payload = ensureObjectField(agentContext, "payload");
  const bucket = ensureObjectField(payload, "harness");
  const state = ensureObjectField(bucket, "state");

  const isFastPathReady =
    bucket.__harnessBucketVersion === HARNESS_BUCKET_VERSION &&
    state.__harnessBucketVersion === HARNESS_BUCKET_VERSION &&
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
    ensureArrayField(bucket, "reviewReports");
    ensureArrayField(bucket, "planningRawOutputs");
    ensureArrayField(bucket, "completedDialogProcessIds");
    if (typeof bucket.summaryText !== "string") bucket.summaryText = "";
    if (typeof bucket.planText !== "string") bucket.planText = "";
    if (!Number.isFinite(Number(bucket.globalRevisionCount))) bucket.globalRevisionCount = 0;
    if (typeof bucket.lastMainPlanRevisionChanged !== "boolean") {
      bucket.lastMainPlanRevisionChanged = false;
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
    state.__harnessBucketVersion = HARNESS_BUCKET_VERSION;
  }

  const locale = resolveLocale(ctx);
  state.locale = locale;
  return { bucket, state };
}
