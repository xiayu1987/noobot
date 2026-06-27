/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveCapabilityProfile } from "../capabilities/profile.js";
import { HARNESS_LIMITS } from "./constants.js";
import { WORKFLOW_PARAMS } from "./workflow-params.js";
import { z } from "zod";

export function resolveHarnessDenyToolNames(input = null) {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(input.map((item) => String(item || "").trim()).filter(Boolean)),
  );
}

export const DEFAULT_HARNESS_DENY_TOOL_NAMES = Object.freeze([
  "plan_multi_task_collaboration",
  "task_summary",
]);

export const DEFAULT_OPTIONS = Object.freeze({
  enabled: true,
  trace: true,
  promptPolicy: true,
  finalResponseGuard: true,
  writeContextSnapshot: true,
  writePrompts: true,
  policyMode: "warn",
  runtimeDirName: "runtime",
  harnessDirName: "harness",
  promptPriority: 80,
  tracePriority: 20,
  timeoutMs: 1000,
  maxPreviewChars: 1200,
  planningGuidanceMode: "separate_model",
  summaryOnToolBurstThreshold: false,
  summaryDetailSaveToAttachment: false,
  clipNonMainModelContextMessages: false,
  capabilityModelInvoker: null,
  capabilityModelByPurpose: Object.freeze({}),
  stepModels: Object.freeze({}),
  guidance: Object.freeze({}),
  capabilityToolAllowlist: [],
  capabilityToolAllowlistByPurpose: Object.freeze({}),
  miniRunnerMaxTurns: 5,
  miniRunnerToolAllowlist: [],
  acceptance: Object.freeze({
    semanticValidation: WORKFLOW_PARAMS.acceptance.semanticValidation.enabled,
  }),
  review: Object.freeze({
    attachToFinalOutput: true,
  }),
  pendingTtlHookTurns: 8,
  manifestDebounceMs: 500,
  jsonlBatchSize: 50,
  jsonlFlushIntervalMs: 2000,
  flushHookPriority: 5,
  flushHookTimeoutMs: 2000,
  jsonlFlushStrategy: Object.freeze({
    maxSize: 50,
    maxTime: 2000,
    onTerminal: true,
    onError: true,
    maxRetry: 5,
    maxBufferEntries: HARNESS_LIMITS.JSONL_MAX_BUFFER_ENTRIES,
    maxBufferBytes: HARNESS_LIMITS.JSONL_MAX_BUFFER_BYTES,
    maxFileBytes: 5 * 1024 * 1024,
    maxFiles: 20,
  }),
  maxRuns: 100,
  maxRunAgeDays: 30,
  cleanupGraceMs: 10 * 60 * 1000,
  fsmEnabled: true,
  denyToolNames: DEFAULT_HARNESS_DENY_TOOL_NAMES,
  promptText: "",
  finalResponseText: "",
});

const HarnessOptionsSchema = z
  .object({
    planningGuidanceMode: z.string().trim().min(1).default(DEFAULT_OPTIONS.planningGuidanceMode),
    planRefinementEnabled: z.boolean().optional(),
    enablePlanRefinement: z.boolean().optional(),
    summaryOnToolBurstThreshold: z.boolean().default(DEFAULT_OPTIONS.summaryOnToolBurstThreshold),
    enableToolBurstSummary: z.boolean().optional(),
    summaryDetailSaveToAttachment: z.boolean().default(DEFAULT_OPTIONS.summaryDetailSaveToAttachment),
    saveSummaryDetailToAttachment: z.boolean().optional(),
    clipNonMainModelContextMessages: z.boolean().default(DEFAULT_OPTIONS.clipNonMainModelContextMessages),
    clipNonMainModelContext: z.boolean().optional(),
    capabilityModelInvoker: z.any().optional(),
    capabilityModelByPurpose: z.record(z.any()).default({}),
    stepModels: z.record(z.any()).default({}),
    guidance: z.record(z.any()).optional(),
    capabilityToolAllowlist: z.array(z.any()).default(DEFAULT_OPTIONS.capabilityToolAllowlist),
    capabilityToolAllowlistByPurpose: z.record(z.any()).default({}),
    miniRunnerMaxTurns: z.coerce.number().finite().positive().default(DEFAULT_OPTIONS.miniRunnerMaxTurns),
    miniRunnerToolAllowlist: z.array(z.any()).default(DEFAULT_OPTIONS.miniRunnerToolAllowlist),
    acceptance: z.record(z.any()).optional(),
    review: z.record(z.any()).optional(),
    planning: z.record(z.any()).optional(),
    pendingTtlHookTurns: z.coerce.number().int().finite().nonnegative().default(DEFAULT_OPTIONS.pendingTtlHookTurns),
    manifestDebounceMs: z.coerce.number().finite().nonnegative().default(DEFAULT_OPTIONS.manifestDebounceMs),
    jsonlBatchSize: z.coerce.number().finite().positive().default(DEFAULT_OPTIONS.jsonlBatchSize),
    jsonlFlushIntervalMs: z.coerce.number().finite().nonnegative().default(DEFAULT_OPTIONS.jsonlFlushIntervalMs),
    flushHookPriority: z.coerce.number().finite().default(DEFAULT_OPTIONS.flushHookPriority),
    flushHookTimeoutMs: z.coerce.number().finite().positive().default(DEFAULT_OPTIONS.flushHookTimeoutMs),
    jsonlFlushStrategy: z
      .object({
        maxSize: z.coerce.number().finite().positive().default(DEFAULT_OPTIONS.jsonlFlushStrategy.maxSize),
        maxTime: z.coerce.number().finite().nonnegative().default(DEFAULT_OPTIONS.jsonlFlushStrategy.maxTime),
        onTerminal: z.boolean().default(DEFAULT_OPTIONS.jsonlFlushStrategy.onTerminal),
        onError: z.boolean().default(DEFAULT_OPTIONS.jsonlFlushStrategy.onError),
        maxRetry: z.coerce.number().int().finite().nonnegative().default(DEFAULT_OPTIONS.jsonlFlushStrategy.maxRetry),
        maxBufferEntries: z.coerce
          .number()
          .int()
          .finite()
          .positive()
          .default(DEFAULT_OPTIONS.jsonlFlushStrategy.maxBufferEntries),
        maxBufferBytes: z.coerce
          .number()
          .int()
          .finite()
          .positive()
          .default(DEFAULT_OPTIONS.jsonlFlushStrategy.maxBufferBytes),
        maxFileBytes: z.coerce
          .number()
          .int()
          .finite()
          .nonnegative()
          .default(DEFAULT_OPTIONS.jsonlFlushStrategy.maxFileBytes),
        maxFiles: z.coerce
          .number()
          .int()
          .finite()
          .nonnegative()
          .default(DEFAULT_OPTIONS.jsonlFlushStrategy.maxFiles),
      })
      .partial()
      .default(DEFAULT_OPTIONS.jsonlFlushStrategy),
    maxRuns: z.coerce.number().finite().positive().default(DEFAULT_OPTIONS.maxRuns),
    maxRunAgeDays: z.coerce.number().finite().positive().default(DEFAULT_OPTIONS.maxRunAgeDays),
    cleanupGraceMs: z.coerce.number().finite().nonnegative().default(DEFAULT_OPTIONS.cleanupGraceMs),
    fsmEnabled: z.boolean().default(DEFAULT_OPTIONS.fsmEnabled),
    capabilityProfile: z.any().optional(),
    capabilityHandlers: z.any().optional(),
  })
  .passthrough();

function normalizeModelByPurpose(...items) {
  const out = {};
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const [key, value] of Object.entries(item)) {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) continue;
      const rawValue =
        value && typeof value === "object" && !Array.isArray(value)
          ? value.model
          : value;
      const normalizedValue = String(rawValue || "").trim();
      if (normalizedValue) out[normalizedKey] = normalizedValue;
    }
  }
  return out;
}

function resolveExplicitPlanRefinementEnabledOption(source = {}) {
  if (!source || typeof source !== "object") return undefined;
  const candidates = [
    source.planRefinementEnabled,
    source.enablePlanRefinement,
    source.planRefinement?.enabled,
    source.refinement?.enabled,
    source.planning?.refinement?.enabled,
    source.planning?.planRefinement?.enabled,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") return candidate;
  }
  return undefined;
}

export function normalizeOptions(userOptions = {}, api = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...(userOptions || {}), ...(api.options?.harness || {}) };
  const planRefinementEnabled = resolveExplicitPlanRefinementEnabledOption(merged);
  const hasCustomFlushStrategy =
    (userOptions &&
      typeof userOptions === "object" &&
      userOptions.jsonlFlushStrategy &&
      typeof userOptions.jsonlFlushStrategy === "object") ||
    (api?.options?.harness &&
      typeof api.options.harness === "object" &&
      api.options.harness.jsonlFlushStrategy &&
      typeof api.options.harness.jsonlFlushStrategy === "object");
  const parsed = HarnessOptionsSchema.safeParse(merged);
  const safe = parsed.success ? parsed.data : DEFAULT_OPTIONS;

  const capabilityToolAllowlist = Array.isArray(safe.capabilityToolAllowlist)
    ? safe.capabilityToolAllowlist.map((item) => String(item || "").trim()).filter(Boolean)
    : DEFAULT_OPTIONS.capabilityToolAllowlist;
  const capabilityToolAllowlistByPurpose =
    safe.capabilityToolAllowlistByPurpose &&
    typeof safe.capabilityToolAllowlistByPurpose === "object" &&
    !Array.isArray(safe.capabilityToolAllowlistByPurpose)
      ? Object.fromEntries(
          Object.entries(safe.capabilityToolAllowlistByPurpose).map(([purpose, value]) => [
            String(purpose || "").trim(),
            Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [],
          ]),
        )
      : DEFAULT_OPTIONS.capabilityToolAllowlistByPurpose;
  const capabilityModelByPurpose = normalizeModelByPurpose(
    safe.capabilityModelByPurpose,
    safe.stepModels,
  );
  const normalizedOptions = {
    ...merged,
    ...safe,
    planningGuidanceMode:
      String(safe.planningGuidanceMode || DEFAULT_OPTIONS.planningGuidanceMode).trim() ||
      DEFAULT_OPTIONS.planningGuidanceMode,
    summaryOnToolBurstThreshold:
      safe.enableToolBurstSummary === true || safe.summaryOnToolBurstThreshold === true,
    summaryDetailSaveToAttachment:
      safe.summaryDetailSaveToAttachment === true || safe.saveSummaryDetailToAttachment === true,
    saveSummaryDetailToAttachment:
      safe.summaryDetailSaveToAttachment === true || safe.saveSummaryDetailToAttachment === true,
    clipNonMainModelContextMessages:
      safe.clipNonMainModelContextMessages === true || safe.clipNonMainModelContext === true,
    planRefinementEnabled,
    capabilityModelInvoker:
      typeof safe.capabilityModelInvoker === "function" ? safe.capabilityModelInvoker : null,
    capabilityModelByPurpose,
    stepModels: capabilityModelByPurpose,
    guidance: safe.guidance && typeof safe.guidance === "object" ? safe.guidance : DEFAULT_OPTIONS.guidance,
    capabilityToolAllowlist,
    capabilityToolAllowlistByPurpose,
    miniRunnerMaxTurns: safe.miniRunnerMaxTurns,
    miniRunnerToolAllowlist: Array.isArray(safe.miniRunnerToolAllowlist)
      ? safe.miniRunnerToolAllowlist.map((item) => String(item || "").trim()).filter(Boolean)
      : DEFAULT_OPTIONS.miniRunnerToolAllowlist,
    acceptance: {
      ...(DEFAULT_OPTIONS.acceptance || {}),
      ...(safe.acceptance && typeof safe.acceptance === "object" ? safe.acceptance : {}),
    },
    review: {
      ...(DEFAULT_OPTIONS.review || {}),
      ...(safe.review && typeof safe.review === "object" ? safe.review : {}),
    },
    pendingTtlHookTurns: safe.pendingTtlHookTurns,
    jsonlFlushStrategy: {
      ...DEFAULT_OPTIONS.jsonlFlushStrategy,
      maxSize: safe.jsonlBatchSize,
      maxTime: safe.jsonlFlushIntervalMs,
      ...(hasCustomFlushStrategy && safe.jsonlFlushStrategy && typeof safe.jsonlFlushStrategy === "object"
        ? safe.jsonlFlushStrategy
        : {}),
    },
    capabilityProfile: resolveCapabilityProfile(safe.capabilityProfile),
    capabilityHandlers:
      safe.capabilityHandlers && typeof safe.capabilityHandlers === "object"
        ? safe.capabilityHandlers
        : {},
    manifestDebounceMs: safe.manifestDebounceMs,
    jsonlBatchSize: safe.jsonlBatchSize,
    jsonlFlushIntervalMs: safe.jsonlFlushIntervalMs,
    flushHookPriority: safe.flushHookPriority,
    flushHookTimeoutMs: safe.flushHookTimeoutMs,
    maxRuns: safe.maxRuns,
    maxRunAgeDays: safe.maxRunAgeDays,
    cleanupGraceMs: safe.cleanupGraceMs,
    fsmEnabled: safe.fsmEnabled !== false,
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
