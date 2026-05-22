/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveCapabilityProfile } from "../capabilities/profile.js";
import { HARNESS_LIMITS } from "./constants.js";
import { z } from "zod";

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
  capabilityModelInvoker: null,
  capabilityModelByPurpose: Object.freeze({}),
  stepModels: Object.freeze({}),
  capabilityToolAllowlist: [],
  capabilityToolAllowlistByPurpose: Object.freeze({}),
  miniRunnerMaxTurns: 5,
  miniRunnerToolAllowlist: [],
  acceptance: Object.freeze({
    semanticValidation: true,
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
  }),
  maxRuns: 100,
  maxRunAgeDays: 30,
  cleanupGraceMs: 10 * 60 * 1000,
  fsmEnabled: true,
  promptText: [
    "Noobot Harness 提醒：遵守用户隔离；附件先转文本再处理；未知规则、模板、路径、配置先读后用；最终回复保持精简且完整。",
  ].join("\n"),
  finalResponseText: [
    "最终回复请包含：做了什么、改了哪些文件、验证情况或未验证原因、下一步建议。",
  ].join("\n"),
});

const HarnessOptionsSchema = z
  .object({
    planningGuidanceMode: z.string().trim().min(1).default(DEFAULT_OPTIONS.planningGuidanceMode),
    capabilityModelInvoker: z.any().optional(),
    capabilityModelByPurpose: z.record(z.any()).default({}),
    stepModels: z.record(z.any()).default({}),
    capabilityToolAllowlist: z.array(z.any()).default(DEFAULT_OPTIONS.capabilityToolAllowlist),
    capabilityToolAllowlistByPurpose: z.record(z.any()).default({}),
    miniRunnerMaxTurns: z.coerce.number().finite().positive().default(DEFAULT_OPTIONS.miniRunnerMaxTurns),
    miniRunnerToolAllowlist: z.array(z.any()).default(DEFAULT_OPTIONS.miniRunnerToolAllowlist),
    acceptance: z.record(z.any()).optional(),
    review: z.record(z.any()).optional(),
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

export function normalizeOptions(userOptions = {}, api = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...(userOptions || {}), ...(api.options?.harness || {}) };
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

  return {
    ...merged,
    ...safe,
    planningGuidanceMode:
      String(safe.planningGuidanceMode || DEFAULT_OPTIONS.planningGuidanceMode).trim() ||
      DEFAULT_OPTIONS.planningGuidanceMode,
    capabilityModelInvoker:
      typeof safe.capabilityModelInvoker === "function" ? safe.capabilityModelInvoker : null,
    capabilityModelByPurpose,
    stepModels: capabilityModelByPurpose,
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
  };
}
