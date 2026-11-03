/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveCapabilityProfile } from "../capabilities/profile.js";
import { HARNESS_PLANNING_GUIDANCE_MODE } from "./constants.js";
import { WORKFLOW_PARAMS } from "./workflow-params.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { z } from "zod";
import { isFunction, isPlainObject, text } from "@noobot/shared/value";

export function resolveHarnessDenyToolNames(input = null) {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map((item) => text(item)).filter(Boolean)));
}

export const DEFAULT_HARNESS_DENY_TOOL_NAMES = Object.freeze(["task_summary"]);

function createDefaultOptions() {
  return {
    enabled: true,
    trace: true,
    promptPolicy: true,
    finalResponseGuard: true,
    writeContextSnapshot: true,
    writePrompts: true,
    policyMode: "warn",
    promptPriority: 80,
    tracePriority: 20,
    timeoutMs: TIME_THRESHOLDS.harness.hookTimeoutMs,
    capabilityModelTimeoutMs: TIME_THRESHOLDS.harness.capabilityModelTimeoutMs,
    maxPreviewChars: LENGTH_THRESHOLDS.display.harnessPreviewChars,
    planningGuidanceMode: HARNESS_PLANNING_GUIDANCE_MODE.SEPARATE_MODEL,
    summaryOnToolBurstThreshold: false,
    summaryDetailSaveToAttachment: false,
    capabilityModelInvoker: null,
    capabilityModelByPurpose: Object.freeze({}),
    stepModels: Object.freeze({}),
    guidance: Object.freeze({}),
    capabilityToolAllowlist: [],
    capabilityToolAllowlistByPurpose: Object.freeze({}),
    miniRunnerMaxTurns: TURN_THRESHOLDS.harness.miniRunnerMaxTurns,
    miniRunnerToolAllowlist: [],
    acceptance: {
      semanticValidation: WORKFLOW_PARAMS.acceptance.semanticValidation.enabled,
    },
    review: {
      attachToFinalOutput: false,
    },
    pendingTtlHookTurns: TURN_THRESHOLDS.harness.pendingTtlHookTurns,
    manifestDebounceMs: TIME_THRESHOLDS.harness.manifestDebounceMs,
    flushHookPriority: 5,
    flushHookTimeoutMs: TIME_THRESHOLDS.harness.flushHookTimeoutMs,
    jsonlFlushStrategy: createDefaultJsonlFlushStrategy(),
    maxRuns: QUANTITY_THRESHOLDS.harness.maxRuns,
    maxRunAgeDays: TIME_THRESHOLDS.harness.maxRunAgeDays,
    cleanupGraceMs: TIME_THRESHOLDS.harness.cleanupGraceMs,
    fsmEnabled: true,
    denyToolNames: DEFAULT_HARNESS_DENY_TOOL_NAMES,
    promptText: "",
    finalResponseText: "",
  };
}

function createDefaultJsonlFlushStrategy() {
  return {
    maxSize: QUANTITY_THRESHOLDS.harness.jsonlFlushMaxSize,
    maxTime: TIME_THRESHOLDS.harness.jsonlFlushMaxTimeMs,
    onTerminal: true,
    onError: true,
    maxRetry: TURN_THRESHOLDS.harness.jsonl.flushMaxRetry,
    maxBufferEntries: QUANTITY_THRESHOLDS.harness.jsonlMaxBufferEntries,
    maxBufferBytes: LENGTH_THRESHOLDS.harness.jsonlMaxBufferBytes,
    maxFileBytes: LENGTH_THRESHOLDS.harness.jsonlFileBytes,
    maxFiles: QUANTITY_THRESHOLDS.harness.jsonlMaxFiles,
  };
}

export function createHarnessJsonlFlushStrategySchema() {
  const defaults = createDefaultJsonlFlushStrategy();
  return z.object({
    maxSize: z.coerce.number().positive().default(defaults.maxSize),
    maxTime: z.coerce.number().nonnegative().default(defaults.maxTime),
    onTerminal: z.boolean().default(defaults.onTerminal),
    onError: z.boolean().default(defaults.onError),
    maxRetry: z.coerce.number().int().nonnegative().default(defaults.maxRetry),
    maxBufferEntries: z.coerce.number().int().positive().default(defaults.maxBufferEntries),
    maxBufferBytes: z.coerce.number().int().positive().default(defaults.maxBufferBytes),
    maxFileBytes: z.coerce.number().int().nonnegative().default(defaults.maxFileBytes),
    maxFiles: z.coerce.number().int().nonnegative().default(defaults.maxFiles),
  });
}

export const HarnessPendingTtlHookTurnsSchema = z.number().int().nonnegative();

function createHarnessOptionsSchema(defaults) {
  return z
    .object({
      timeoutMs: z.coerce.number().positive().default(defaults.timeoutMs),
      capabilityModelTimeoutMs: z.coerce
        .number()
        .positive()
        .default(defaults.capabilityModelTimeoutMs),
      planningGuidanceMode: z
        .enum(Object.values(HARNESS_PLANNING_GUIDANCE_MODE))
        .default(defaults.planningGuidanceMode),
      planRefinementEnabled: z.boolean().optional(),
      summaryOnToolBurstThreshold: z.boolean().default(defaults.summaryOnToolBurstThreshold),
      summaryDetailSaveToAttachment: z.boolean().default(defaults.summaryDetailSaveToAttachment),
      capabilityModelInvoker: z.custom(isFunction).nullable().default(null),
      capabilityModelByPurpose: z.record(z.any()).default({}),
      stepModels: z.record(z.any()).default({}),
      guidance: z.record(z.any()).default({}),
      capabilityToolAllowlist: z.array(z.any()).default([]),
      capabilityToolAllowlistByPurpose: z.record(z.any()).default({}),
      miniRunnerMaxTurns: z.coerce.number().positive().default(defaults.miniRunnerMaxTurns),
      miniRunnerToolAllowlist: z.array(z.any()).default([]),
      acceptance: z.record(z.any()).default({}),
      review: z.record(z.any()).default({}),
      planning: z.record(z.any()).optional(),
      pendingTtlHookTurns: z.coerce
        .number()
        .pipe(HarnessPendingTtlHookTurnsSchema)
        .default(defaults.pendingTtlHookTurns),
      manifestDebounceMs: z.coerce.number().nonnegative().default(defaults.manifestDebounceMs),
      flushHookPriority: z.coerce.number().default(defaults.flushHookPriority),
      flushHookTimeoutMs: z.coerce.number().positive().default(defaults.flushHookTimeoutMs),
      jsonlFlushStrategy: createHarnessJsonlFlushStrategySchema().prefault({}),
      maxRuns: z.coerce.number().positive().default(defaults.maxRuns),
      maxRunAgeDays: z.coerce.number().positive().default(defaults.maxRunAgeDays),
      cleanupGraceMs: z.coerce.number().nonnegative().default(defaults.cleanupGraceMs),
      fsmEnabled: z.boolean().default(defaults.fsmEnabled),
      capabilityProfile: z.any().optional(),
      capabilityHandlers: z.any().optional(),
    })
    .loose();
}

function normalizeModelByPurpose(...items) {
  const out = {};
  for (const item of items) {
    if (!isPlainObject(item)) continue;
    for (const [key, value] of Object.entries(item)) {
      const normalizedKey = text(key);
      if (!normalizedKey) continue;
      const rawValue = isPlainObject(value) ? value.model : value;
      const normalizedValue = text(rawValue);
      if (normalizedValue) out[normalizedKey] = normalizedValue;
    }
  }
  return out;
}

export function assertHarnessAgentHostCapabilities(options) {
  if (
    options.planningGuidanceMode === HARNESS_PLANNING_GUIDANCE_MODE.SEPARATE_MODEL &&
    !options.capabilityModelInvoker
  ) {
    throw new TypeError("harness separate_model mode requires capabilityModelInvoker");
  }
}

export function normalizeOptions(userOptions = {}, api = {}) {
  const defaults = createDefaultOptions();
  const merged = { ...defaults, ...(userOptions || {}), ...(api.options?.harness || {}) };
  const safe = createHarnessOptionsSchema(defaults).parse(merged);
  if (
    safe.capabilityModelTimeoutMs + TIME_THRESHOLDS.harness.capabilityModelHookGraceMs >
    safe.timeoutMs
  ) {
    throw new RangeError(
      "harness capabilityModelTimeoutMs must leave the configured hook completion grace period",
    );
  }

  const capabilityToolAllowlistByPurpose = Object.fromEntries(
    Object.entries(safe.capabilityToolAllowlistByPurpose).map(([purpose, value]) => [
      text(purpose),
      Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [],
    ]),
  );
  const capabilityModelByPurpose = normalizeModelByPurpose(
    safe.capabilityModelByPurpose,
    safe.stepModels,
  );
  const normalizedOptions = {
    ...merged,
    ...safe,
    capabilityModelByPurpose,
    stepModels: capabilityModelByPurpose,
    capabilityToolAllowlist: safe.capabilityToolAllowlist.map((item) => text(item)).filter(Boolean),
    capabilityToolAllowlistByPurpose,
    miniRunnerToolAllowlist: safe.miniRunnerToolAllowlist.map((item) => text(item)).filter(Boolean),
    acceptance: { ...defaults.acceptance, ...safe.acceptance },
    review: { ...defaults.review, ...safe.review },
    capabilityProfile: resolveCapabilityProfile(safe.capabilityProfile),
    capabilityHandlers:
      safe.capabilityHandlers && typeof safe.capabilityHandlers === "object"
        ? safe.capabilityHandlers
        : {},
    denyToolNames: resolveHarnessDenyToolNames(safe?.denyToolNames),
  };
  for (const key of Object.keys(normalizedOptions)) {
    const normalizedKey = String(key || "").toLowerCase();
    if (
      normalizedKey.includes("workflow") ||
      normalizedKey.includes("promptstrategy") ||
      normalizedKey.includes("executionfirst") ||
      normalizedKey.includes("actionfirst")
    ) {
      delete normalizedOptions[key];
    }
  }
  return normalizedOptions;
}
