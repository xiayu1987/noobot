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

export function ensureHarnessBucket(ctx = {}) {
  const agentContext =
    ctx?.agentContext && typeof ctx.agentContext === "object" ? ctx.agentContext : null;
  if (!agentContext) return null;
  const bindings = ensureObjectField(agentContext, "bindings");
  const extensions = ensureObjectField(bindings, "extensions");
  const bucket = ensureObjectField(extensions, "harness");
  const state = ensureObjectField(bucket, "state");
  const existingVersion = Number(bucket.__harnessBucketVersion);
  const hasExistingState = Object.keys(bucket).some(
    (key) => key !== "state" && key !== "__harnessBucketVersion",
  );
  if (
    (Number.isFinite(existingVersion) && existingVersion !== HARNESS_BUCKET_VERSION) ||
    (!Number.isFinite(existingVersion) && hasExistingState)
  ) {
    throw new Error(
      `harness_bucket_migration_required:${Number.isFinite(existingVersion) ? existingVersion : 0}`,
    );
  }
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
    ensureArrayField(bucket, "taskChecklist");
    ensureArrayField(bucket, "acceptanceReports");
    ensureArrayField(bucket, "phaseAcceptanceReports");
    ensureArrayField(bucket, "reviewReports");
    ensureArrayField(bucket, "planningRawOutputs");
    ensureArrayField(bucket, "completedDialogProcessIds");
    if (typeof bucket.summaryText !== "string") bucket.summaryText = "";
    if (typeof bucket.summaryFullText !== "string") bucket.summaryFullText = "";
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
  }

  const locale = resolveLocale(ctx);
  state.locale = locale;
  return { bucket, state };
}
