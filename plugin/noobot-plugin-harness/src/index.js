/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildContextSnapshot,
  buildEvent,
  buildPromptRecord,
  nowIso,
  safeError,
  safeId,
} from "./data/record-builders.js";
import {
  HARNESS_ENGINEERING_CAPABILITIES,
  resolveCapabilityProfile,
} from "./capabilities/profile.js";
import { createCapabilityRuntime } from "./capabilities/runtime.js";
import {
  readJson,
  writeJson,
  updateManifestCached,
  flushAllManifests,
  appendJsonlBuffered,
  flushAllJsonlBuffers,
  appendJsonl,
} from "./lib/store.js";
import {
  isHarnessPromptAlreadyInjected,
  markPromptAsInjected,
  injectSystemMessages,
} from "./lib/prompt-injector.js";
import { cleanupOldRuns } from "./lib/cleanup.js";

export const PLUGIN_NAME = "noobot-plugin-harness";
export const PLUGIN_VERSION = "0.1.0";

export const HARNESS_HOOK_POINTS = Object.freeze({
  BEFORE_CONTEXT_BUILD: "before_context_build",
  AFTER_CONTEXT_BUILD: "after_context_build",
  CONTEXT_BUILD_ERROR: "context_build_error",
  BEFORE_TURN: "before_turn",
  BEFORE_FINAL_OUTPUT: "before_final_output",
  AFTER_TURN: "after_turn",
  ON_ABORT: "on_abort",
  ON_ERROR: "on_error",
  BEFORE_LLM_CALL: "before_llm_call",
  AFTER_LLM_CALL: "after_llm_call",
  LLM_CALL_ERROR: "llm_call_error",
  BEFORE_TOOL_CALLS: "before_tool_calls",
  BEFORE_TOOL_CALL: "before_tool_call",
  AFTER_TOOL_CALL: "after_tool_call",
  TOOL_CALL_ERROR: "tool_call_error",
  BEFORE_STATE_COMMIT: "before_state_commit",
  AFTER_STATE_COMMIT: "after_state_commit",
});

const HARNESS_FSM_STATES = Object.freeze({
  IDLE: "idle",
  PLANNING: "planning",
  PLANNED: "planned",
  HUMAN_APPROVAL: "human_approval",
  EXECUTING: "executing",
  VERIFYING: "verifying",
  DONE: "done",
  FAILED: "failed",
});

const HARNESS_FSM_ALLOWED_TRANSITIONS = Object.freeze({
  [HARNESS_FSM_STATES.IDLE]: new Set([HARNESS_FSM_STATES.PLANNING, HARNESS_FSM_STATES.FAILED]),
  [HARNESS_FSM_STATES.PLANNING]: new Set([HARNESS_FSM_STATES.PLANNED, HARNESS_FSM_STATES.FAILED]),
  [HARNESS_FSM_STATES.PLANNED]: new Set([
    HARNESS_FSM_STATES.EXECUTING,
    HARNESS_FSM_STATES.HUMAN_APPROVAL,
    HARNESS_FSM_STATES.FAILED,
  ]),
  [HARNESS_FSM_STATES.HUMAN_APPROVAL]: new Set([
    HARNESS_FSM_STATES.EXECUTING,
    HARNESS_FSM_STATES.FAILED,
  ]),
  [HARNESS_FSM_STATES.EXECUTING]: new Set([HARNESS_FSM_STATES.VERIFYING, HARNESS_FSM_STATES.FAILED]),
  [HARNESS_FSM_STATES.VERIFYING]: new Set([HARNESS_FSM_STATES.DONE, HARNESS_FSM_STATES.FAILED]),
  [HARNESS_FSM_STATES.DONE]: new Set(),
  [HARNESS_FSM_STATES.FAILED]: new Set(),
});

const HARNESS_FSM_TERMINAL_STATES = new Set([HARNESS_FSM_STATES.DONE, HARNESS_FSM_STATES.FAILED]);
const fsmStateCache = new Map(); // runId -> state
const HARNESS_FSM_EFFECTS = Object.freeze({
  AUDIT_RESUME: "audit_resume",
  AUDIT_TRANSITION: "audit_transition",
  AUDIT_REJECTED: "audit_rejected",
  CACHE_SET: "cache_set",
  CACHE_DELETE: "cache_delete",
});

const DEFAULT_OPTIONS = Object.freeze({
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
  capabilityToolAllowlist: [],
  capabilityToolAllowlistByPurpose: Object.freeze({}),
  miniRunnerMaxTurns: 50,
  miniRunnerToolAllowlist: [],
  acceptance: Object.freeze({
    semanticValidation: false,
  }),
  review: Object.freeze({
    attachToFinalOutput: true,
  }),
  // --- Optimization configs ---
  manifestDebounceMs: 500,
  jsonlBatchSize: 50,
  jsonlFlushIntervalMs: 2000,
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

function normalizeOptions(userOptions = {}, api = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...(userOptions || {}), ...(api.options?.harness || {}) };
  return {
    ...merged,
    planningGuidanceMode:
      String(merged.planningGuidanceMode || DEFAULT_OPTIONS.planningGuidanceMode).trim() ||
      DEFAULT_OPTIONS.planningGuidanceMode,
    capabilityModelInvoker:
      typeof merged.capabilityModelInvoker === "function" ? merged.capabilityModelInvoker : null,
    capabilityToolAllowlist: Array.isArray(merged.capabilityToolAllowlist)
      ? merged.capabilityToolAllowlist.map((item) => String(item || "").trim()).filter(Boolean)
      : DEFAULT_OPTIONS.capabilityToolAllowlist,
    capabilityToolAllowlistByPurpose:
      merged.capabilityToolAllowlistByPurpose &&
      typeof merged.capabilityToolAllowlistByPurpose === "object" &&
      !Array.isArray(merged.capabilityToolAllowlistByPurpose)
        ? Object.fromEntries(
            Object.entries(merged.capabilityToolAllowlistByPurpose).map(([purpose, value]) => [
              String(purpose || "").trim(),
              Array.isArray(value)
                ? value.map((item) => String(item || "").trim()).filter(Boolean)
                : [],
            ]),
          )
        : DEFAULT_OPTIONS.capabilityToolAllowlistByPurpose,
    miniRunnerMaxTurns:
      Number.isFinite(Number(merged.miniRunnerMaxTurns)) && Number(merged.miniRunnerMaxTurns) > 0
        ? Number(merged.miniRunnerMaxTurns)
        : DEFAULT_OPTIONS.miniRunnerMaxTurns,
    miniRunnerToolAllowlist: Array.isArray(merged.miniRunnerToolAllowlist)
      ? merged.miniRunnerToolAllowlist.map((item) => String(item || "").trim()).filter(Boolean)
      : DEFAULT_OPTIONS.miniRunnerToolAllowlist,
    acceptance: {
      ...(DEFAULT_OPTIONS.acceptance || {}),
      ...(merged.acceptance && typeof merged.acceptance === "object" ? merged.acceptance : {}),
    },
    review: {
      ...(DEFAULT_OPTIONS.review || {}),
      ...(merged.review && typeof merged.review === "object" ? merged.review : {}),
    },
    capabilityProfile: resolveCapabilityProfile(merged.capabilityProfile),
    capabilityHandlers:
      merged.capabilityHandlers && typeof merged.capabilityHandlers === "object"
        ? merged.capabilityHandlers
        : {},
    // Optimization configs
    manifestDebounceMs:
      Number.isFinite(Number(merged.manifestDebounceMs)) && Number(merged.manifestDebounceMs) >= 0
        ? Number(merged.manifestDebounceMs)
        : DEFAULT_OPTIONS.manifestDebounceMs,
    maxRuns:
      Number.isFinite(Number(merged.maxRuns)) && Number(merged.maxRuns) > 0
        ? Number(merged.maxRuns)
        : DEFAULT_OPTIONS.maxRuns,
    maxRunAgeDays:
      Number.isFinite(Number(merged.maxRunAgeDays)) && Number(merged.maxRunAgeDays) > 0
        ? Number(merged.maxRunAgeDays)
        : DEFAULT_OPTIONS.maxRunAgeDays,
    cleanupGraceMs:
      Number.isFinite(Number(merged.cleanupGraceMs)) && Number(merged.cleanupGraceMs) >= 0
        ? Number(merged.cleanupGraceMs)
        : DEFAULT_OPTIONS.cleanupGraceMs,
    fsmEnabled: merged.fsmEnabled !== false,
  };
}

function extractRuntime(ctx = {}) {
  return ctx?.agentContext?.execution?.controllers?.runtime || null;
}

function extractBasePath(ctx = {}, options = {}) {
  return String(
    options.basePath ||
      ctx.basePath ||
      extractRuntime(ctx)?.basePath ||
      ctx?.agentContext?.environment?.workspace?.basePath ||
      "",
  ).trim();
}

function extractRunId(ctx = {}) {
  return safeId(
    ctx.dialogProcessId || ctx?.agentContext?.execution?.dialogProcessId || ctx.sessionId || "run",
  );
}

function createRunPaths(ctx = {}, options = {}) {
  const basePath = extractBasePath(ctx, options);
  if (!basePath) return null;
  const runId = extractRunId(ctx);
  const runDir = path.join(
    basePath,
    options.runtimeDirName || DEFAULT_OPTIONS.runtimeDirName,
    options.harnessDirName || DEFAULT_OPTIONS.harnessDirName,
    "runs",
    runId,
  );
  return {
    basePath,
    runId,
    runDir,
    manifest: path.join(runDir, "harness-run.json"),
    contextSnapshot: path.join(runDir, "context-snapshot.json"),
    events: path.join(runDir, "events.jsonl"),
    prompts: path.join(runDir, "prompts.jsonl"),
    toolCalls: path.join(runDir, "tool-calls.jsonl"),
    stateCommits: path.join(runDir, "state-commits.jsonl"),
    policyChecks: path.join(runDir, "policy-checks.json"),
    capabilityTraces: path.join(runDir, "capability-traces.jsonl"),
  };
}

async function ensureRunDir(paths) {
  if (!paths?.runDir) return false;
  await fs.mkdir(paths.runDir, { recursive: true });
  return true;
}

function normalizeFsmState(state = "") {
  const value = String(state || "").trim().toLowerCase();
  return Object.values(HARNESS_FSM_STATES).includes(value) ? value : HARNESS_FSM_STATES.IDLE;
}

function statusToFsmState(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "success") return HARNESS_FSM_STATES.DONE;
  if (normalized === "error" || normalized === "abort") return HARNESS_FSM_STATES.FAILED;
  return HARNESS_FSM_STATES.IDLE;
}

function isAllowedFsmTransition(from, to) {
  if (from === to) return true;
  return HARNESS_FSM_ALLOWED_TRANSITIONS[from]?.has(to) === true;
}

function inferFsmTarget(point, ctx = {}, currentState = HARNESS_FSM_STATES.IDLE) {
  const commitHint = String(ctx?.commitType || "").toLowerCase();
  const checklist = Array.isArray(ctx?.agentContext?.payload?.harness?.taskChecklist)
    ? ctx.agentContext.payload.harness.taskChecklist
    : [];
  if (
    point === HARNESS_HOOK_POINTS.ON_ERROR ||
    point === HARNESS_HOOK_POINTS.ON_ABORT ||
    point === HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR ||
    point === HARNESS_HOOK_POINTS.LLM_CALL_ERROR ||
    point === HARNESS_HOOK_POINTS.TOOL_CALL_ERROR
  ) {
    return HARNESS_FSM_STATES.FAILED;
  }
  if (point === HARNESS_HOOK_POINTS.AFTER_TURN) return HARNESS_FSM_STATES.DONE;
  if (point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT) return HARNESS_FSM_STATES.VERIFYING;
  if (point === HARNESS_HOOK_POINTS.BEFORE_TOOL_CALLS || point === HARNESS_HOOK_POINTS.BEFORE_TOOL_CALL) {
    return HARNESS_FSM_STATES.EXECUTING;
  }
  if (
    point === HARNESS_HOOK_POINTS.BEFORE_STATE_COMMIT ||
    point === HARNESS_HOOK_POINTS.AFTER_STATE_COMMIT
  ) {
    if (commitHint.includes("approval")) return HARNESS_FSM_STATES.HUMAN_APPROVAL;
    return null;
  }
  if (point === HARNESS_HOOK_POINTS.AFTER_LLM_CALL) {
    if (currentState === HARNESS_FSM_STATES.IDLE || currentState === HARNESS_FSM_STATES.PLANNING) {
      return checklist.length > 0 ? HARNESS_FSM_STATES.PLANNED : HARNESS_FSM_STATES.PLANNING;
    }
    return null;
  }
  if (
    point === HARNESS_HOOK_POINTS.BEFORE_CONTEXT_BUILD ||
    point === HARNESS_HOOK_POINTS.AFTER_CONTEXT_BUILD ||
    point === HARNESS_HOOK_POINTS.BEFORE_TURN ||
    point === HARNESS_HOOK_POINTS.BEFORE_LLM_CALL
  ) {
    if (currentState === HARNESS_FSM_STATES.IDLE) return HARNESS_FSM_STATES.PLANNING;
    return null;
  }
  return null;
}

async function appendFsmAudit(paths, ctx = {}, payload = {}, options = {}) {
  if (!paths?.stateCommits || !payload?.type) return;
  await appendJsonlBuffered(
    paths.stateCommits,
    {
      timestamp: nowIso(),
      runId: paths.runId,
      point: payload.point,
      type: payload.type,
      accepted: payload.accepted === true,
      from: payload.from,
      to: payload.to,
      reason: payload.reason,
      dialogProcessId: ctx.dialogProcessId || ctx?.agentContext?.execution?.dialogProcessId || undefined,
      sessionId: ctx.sessionId || undefined,
      userId: ctx.userId || undefined,
    },
    options.jsonlBatchSize,
    options.jsonlFlushIntervalMs,
  );
}

async function resolveCurrentFsmState(paths, options = {}) {
  if (!paths?.runId || options.fsmEnabled === false) {
    return { state: HARNESS_FSM_STATES.IDLE, resumed: false };
  }
  if (fsmStateCache.has(paths.runId)) {
    return { state: fsmStateCache.get(paths.runId), resumed: false };
  }
  const manifest = await readJson(paths.manifest, {});
  const fromManifest = normalizeFsmState(manifest?.fsmStatus || manifest?.fsm?.state);
  const inferred = fromManifest !== HARNESS_FSM_STATES.IDLE ? fromManifest : statusToFsmState(manifest?.status);
  const state = normalizeFsmState(inferred);
  fsmStateCache.set(paths.runId, state);
  const resumed = state !== HARNESS_FSM_STATES.IDLE && !HARNESS_FSM_TERMINAL_STATES.has(state);
  return { state, resumed };
}

function buildFsmTransitionPlan(point, ctx = {}, currentState, resumed = false, runId = "") {
  const actions = [];
  if (resumed) {
    actions.push({
      type: HARNESS_FSM_EFFECTS.AUDIT_RESUME,
      payload: {
        point,
        accepted: true,
        from: currentState,
        to: currentState,
        reason: "resume_from_checkpoint",
      },
    });
  }

  const target = inferFsmTarget(point, ctx, currentState);
  if (!target) {
    return {
      state: currentState,
      changed: false,
      rejected: false,
      resumed,
      attempted: null,
      actions,
    };
  }

  if (!isAllowedFsmTransition(currentState, target)) {
    actions.push({
      type: HARNESS_FSM_EFFECTS.AUDIT_REJECTED,
      payload: {
        point,
        accepted: false,
        from: currentState,
        to: target,
        reason: "illegal_transition",
      },
    });
    return {
      state: currentState,
      changed: false,
      rejected: true,
      resumed,
      attempted: target,
      actions,
    };
  }

  if (currentState !== target) {
    actions.push({
      type: HARNESS_FSM_EFFECTS.AUDIT_TRANSITION,
      payload: {
        point,
        accepted: true,
        from: currentState,
        to: target,
        reason: "accepted",
      },
    });
    if (HARNESS_FSM_TERMINAL_STATES.has(target)) {
      actions.push({
        type: HARNESS_FSM_EFFECTS.CACHE_DELETE,
        payload: { runId },
      });
    } else {
      actions.push({
        type: HARNESS_FSM_EFFECTS.CACHE_SET,
        payload: { runId, state: target },
      });
    }
  }

  return {
    state: target,
    changed: currentState !== target,
    rejected: false,
    resumed,
    attempted: null,
    actions,
  };
}

async function applyFsmTransitionEffects(paths, ctx = {}, options = {}, plan = {}) {
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  for (const action of actions) {
    const payload = action?.payload || {};
    if (
      action.type === HARNESS_FSM_EFFECTS.AUDIT_RESUME ||
      action.type === HARNESS_FSM_EFFECTS.AUDIT_TRANSITION ||
      action.type === HARNESS_FSM_EFFECTS.AUDIT_REJECTED
    ) {
      await appendFsmAudit(paths, ctx, {
        point: payload.point,
        type:
          action.type === HARNESS_FSM_EFFECTS.AUDIT_RESUME
            ? "fsm_resume"
            : action.type === HARNESS_FSM_EFFECTS.AUDIT_REJECTED
              ? "fsm_transition_rejected"
              : "fsm_transition",
        accepted: payload.accepted,
        from: payload.from,
        to: payload.to,
        reason: payload.reason,
      }, options);
      continue;
    }
    if (action.type === HARNESS_FSM_EFFECTS.CACHE_SET) {
      if (payload.runId) fsmStateCache.set(payload.runId, payload.state);
      continue;
    }
    if (action.type === HARNESS_FSM_EFFECTS.CACHE_DELETE) {
      if (payload.runId) fsmStateCache.delete(payload.runId);
    }
  }
}

async function advanceFsmState(point, ctx = {}, paths = null, options = {}) {
  if (!paths || options.fsmEnabled === false) {
    return { state: HARNESS_FSM_STATES.IDLE, changed: false, rejected: false, resumed: false };
  }
  const { state: currentState, resumed } = await resolveCurrentFsmState(paths, options);
  const plan = buildFsmTransitionPlan(point, ctx, currentState, resumed, paths.runId);
  await applyFsmTransitionEffects(paths, ctx, options, plan);
  return {
    state: plan.state,
    changed: plan.changed,
    rejected: plan.rejected,
    resumed: plan.resumed,
    attempted: plan.attempted || undefined,
  };
}

// ---- Manifest merge logic (extracted for reuse with cache) ----
function mergeManifest(current, ctx, patch, options, capabilityRuntime, paths = null) {
  const resolvedPaths =
    current?.paths && typeof current.paths === "object" && Object.keys(current.paths).length > 0
      ? current.paths
      : paths && typeof paths === "object"
        ? {
            runDir: paths.runDir,
            contextSnapshot: paths.contextSnapshot,
            events: paths.events,
            prompts: paths.prompts,
            toolCalls: paths.toolCalls,
            stateCommits: paths.stateCommits,
            policyChecks: paths.policyChecks,
            capabilityTraces: paths.capabilityTraces,
          }
        : {};
  const next = {
    plugin: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    harnessRunId: current.harnessRunId || "",
    userId: ctx.userId || current.userId || "",
    sessionId: ctx.sessionId || current.sessionId || "",
    parentSessionId: ctx.parentSessionId || current.parentSessionId || "",
    dialogProcessId: ctx.dialogProcessId || current.dialogProcessId || current.harnessRunId || "",
    caller: ctx.caller || current.caller || "",
    status: current.status || "running",
    fsmStatus: normalizeFsmState(current.fsmStatus || current?.fsm?.state || statusToFsmState(current.status)),
    startedAt: current.startedAt || ctx.startedAt || nowIso(),
    updatedAt: nowIso(),
    capabilities:
      current.capabilities ||
      {
        domains: HARNESS_ENGINEERING_CAPABILITIES,
        profile: resolveCapabilityProfile(options.capabilityProfile),
        hookMap: capabilityRuntime?.hookMap || {},
      },
    paths: resolvedPaths,
    ...current,
    ...patch,
  };
  if (["success", "error", "abort"].includes(String(patch.status || ""))) {
    next.endedAt = patch.endedAt || nowIso();
  }
  return next;
}

async function updateManifest(paths, ctx = {}, patch = {}, options = {}, capabilityRuntime = null) {
  if (!paths) return;
  await updateManifestCached(
    paths,
    ctx,
    patch,
    options,
    capabilityRuntime,
    (current, hookCtx, nextPatch, hookOptions, runtimeCapability) =>
      mergeManifest(current, hookCtx, nextPatch, hookOptions, runtimeCapability, paths),
    options.manifestDebounceMs,
  );
}

// ---- Unified Takeover Dispatcher ----
const takeoverHandlers = new Map();

export function registerTakeover(type, handler) {
  takeoverHandlers.set(String(type).toLowerCase(), handler);
}

export async function applyTakeover(type, ctx, directive, options = {}) {
  const handler = takeoverHandlers.get(String(type).toLowerCase());
  if (!handler) return { applied: false, reason: `No handler for takeover type: ${type}` };
  try {
    return await handler(ctx, directive, options);
  } catch (err) {
    return { applied: false, error: safeError(err) };
  }
}

// Register default takeover handlers
registerTakeover("tool", async (ctx, directive, options) => {
  const toolName = directive?.toolName || directive?.name;
  if (!toolName) return { applied: false, reason: "No tool name specified" };
  const allowlist = options.capabilityToolAllowlist || [];
  if (allowlist.length > 0 && !allowlist.includes(toolName)) {
    return { applied: true, action: "block", toolName, reason: "Not in allowlist" };
  }
  return { applied: true, action: "allow", toolName };
});

registerTakeover("message", async (ctx, directive, options) => {
  const messages = Array.isArray(ctx.messages) ? ctx.messages : [];
  const content = directive?.content || directive?.text;
  if (!content) return { applied: false, reason: "No content specified" };
  messages.push({ role: directive.role || "system", content });
  return { applied: true, action: "inject", messageCount: messages.length };
});

registerTakeover("memory", async (ctx, directive, options) => {
  const key = directive?.key || directive?.name;
  const value = directive?.value;
  if (!key) return { applied: false, reason: "No memory key specified" };
  const memory = ctx.memory || ctx.agentContext?.memory || {};
  memory[key] = value;
  return { applied: true, action: "set", key };
});

// ---- Prompt Injection (using new module) ----
async function injectPrompt(point, ctx, options) {
  if (!options.enabled || !options.promptPolicy) return;
  const id =
    point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT
      ? "noobot-harness-final-response"
      : "noobot-harness-policy";
  const content =
    point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT ? options.finalResponseText : options.promptText;

  if (isHarnessPromptAlreadyInjected(ctx.messages, id)) return;

  const injected = injectSystemMessages(ctx, {
    skipIds: new Set(),
    prompts: [{ id, content, priority: options.promptPriority, mode: "prepend" }],
  });

  if (!injected || !options.writePrompts) return;
  const paths = createRunPaths(ctx, options);
  if (!paths) return;
  await ensureRunDir(paths);
  await appendJsonlBuffered(
    paths.prompts,
    buildPromptRecord({
      promptId: id,
      point,
      content,
      maxPreviewChars: options.maxPreviewChars,
    }),
  );
}

async function trace(point, ctx, options) {
  if (!options.enabled || !options.trace) return;
  const paths = createRunPaths(ctx, options);
  if (!paths) return;
  await ensureRunDir(paths);
  const fsm = await advanceFsmState(point, ctx, paths, options);
  const event = buildEvent({
    point,
    ctx,
    options,
    pluginName: PLUGIN_NAME,
    pluginVersion: PLUGIN_VERSION,
  });
  // Buffered JSONL writes
  await appendJsonlBuffered(paths.events, event);
  if (point.includes("tool_call")) await appendJsonlBuffered(paths.toolCalls, event);
  if (point.includes("state_commit")) await appendJsonlBuffered(paths.stateCommits, event);
  const capabilityTraceLogs = (Array.isArray(event.capabilityLogs) ? event.capabilityLogs : []).filter(
    (log) => log?.event === "capability_model_trace",
  );
  for (const log of capabilityTraceLogs) {
    await appendJsonlBuffered(paths.capabilityTraces, {
      eventId: event.eventId,
      point,
      timestamp: event.timestamp,
      userId: event.userId,
      sessionId: event.sessionId,
      dialogProcessId: event.dialogProcessId,
      ...log,
    });
  }
  if (point === HARNESS_HOOK_POINTS.AFTER_CONTEXT_BUILD && options.writeContextSnapshot) {
    await writeJson(paths.contextSnapshot, buildContextSnapshot({ ctx, pluginName: PLUGIN_NAME, pluginVersion: PLUGIN_VERSION }));
  }
  const terminalStatus =
    point === HARNESS_HOOK_POINTS.AFTER_TURN
      ? "success"
      : point === HARNESS_HOOK_POINTS.ON_ERROR || point === HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR
        ? "error"
        : point === HARNESS_HOOK_POINTS.ON_ABORT
          ? "abort"
          : null;
  await updateManifest(
    paths,
    ctx,
    {
      status: terminalStatus || "running",
      fsmStatus: fsm.state,
      fsm: {
        state: fsm.state,
        updatedAt: nowIso(),
        lastPoint: point,
        rejectedTransition: fsm.rejected === true ? { attemptedState: fsm.attempted, at: nowIso() } : null,
        resumedFromCheckpoint: fsm.resumed === true,
      },
      updatedAt: nowIso(),
      lastEvent: { point, timestamp: event.timestamp, status: event.status },
      ...(terminalStatus ? { endedAt: nowIso(), error: safeError(ctx.error) } : {}),
    },
    options,
    options?.capabilityRuntime || null,
  );
}

function resolveHookManager(api = {}) {
  return api.hookManager || api.hooks || api.manager || api?.runtime?.hookManager || api?.runConfig?.hookManager || null;
}

export function createHarnessPlugin(userOptions = {}) {
  const options = normalizeOptions(userOptions);
  return {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    options,
    register(api = {}) {
      return registerNoobotPlugin(api, options);
    },
  };
}

export function registerNoobotPlugin(api = {}, userOptions = {}) {
  const options = normalizeOptions(userOptions, api);
  if (options.planningGuidanceMode === "separate_model" && !options.capabilityModelInvoker) {
    options.planningGuidanceMode = "inject";
  }
  const hookManager = resolveHookManager(api);
  const capabilityRuntime = createCapabilityRuntime({
    profile: options.capabilityProfile,
    handlers: options.capabilityHandlers,
  });
  options.capabilityRuntime = capabilityRuntime;
  if (!hookManager || typeof hookManager.on !== "function") {
    throw new Error(`${PLUGIN_NAME}: hookManager with .on(point, handler, options) is required`);
  }
  if (!options.enabled) return { name: PLUGIN_NAME, version: PLUGIN_VERSION, disposers: [] };

  const disposers = [];
  const tracePoints = [
    HARNESS_HOOK_POINTS.BEFORE_CONTEXT_BUILD,
    HARNESS_HOOK_POINTS.AFTER_CONTEXT_BUILD,
    HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR,
    HARNESS_HOOK_POINTS.BEFORE_TURN,
    HARNESS_HOOK_POINTS.AFTER_TURN,
    HARNESS_HOOK_POINTS.ON_ABORT,
    HARNESS_HOOK_POINTS.ON_ERROR,
    HARNESS_HOOK_POINTS.AFTER_LLM_CALL,
    HARNESS_HOOK_POINTS.LLM_CALL_ERROR,
    HARNESS_HOOK_POINTS.BEFORE_TOOL_CALLS,
    HARNESS_HOOK_POINTS.BEFORE_TOOL_CALL,
    HARNESS_HOOK_POINTS.AFTER_TOOL_CALL,
    HARNESS_HOOK_POINTS.TOOL_CALL_ERROR,
    HARNESS_HOOK_POINTS.BEFORE_STATE_COMMIT,
    HARNESS_HOOK_POINTS.AFTER_STATE_COMMIT,
    HARNESS_HOOK_POINTS.BEFORE_LLM_CALL,
    HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT,
  ];

  // Cleanup old runs on registration
  const basePath = extractBasePath({}, options);
  if (basePath) {
    cleanupOldRuns(basePath, options).catch(() => {});
  }

  for (const point of tracePoints) {
    disposers.push(
      hookManager.on(
        point,
        async (ctx = {}) => {
          await capabilityRuntime.runHook(point, ctx, {
            pluginName: PLUGIN_NAME,
            pluginVersion: PLUGIN_VERSION,
            harness: {
              planningGuidanceMode: options.planningGuidanceMode,
              capabilityModelInvoker: options.capabilityModelInvoker,
              capabilityToolAllowlist: options.capabilityToolAllowlist,
              capabilityToolAllowlistByPurpose: options.capabilityToolAllowlistByPurpose,
              acceptance: options.acceptance,
              review: options.review,
              runTraceSink: async (record = {}) => {
                const paths = createRunPaths(ctx, options);
                if (!paths) return;
                await ensureRunDir(paths);
                await appendJsonlBuffered(paths.capabilityTraces, record);
              },
            },
          });
          if (
            point === HARNESS_HOOK_POINTS.BEFORE_LLM_CALL ||
            (point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT && options.finalResponseGuard !== false)
          ) {
            await injectPrompt(point, ctx, options);
          }
          await trace(point, ctx, options);
        },
        {
          id: `${PLUGIN_NAME}.trace.${point}`,
          priority: options.tracePriority,
          timeoutMs: options.timeoutMs,
        },
      ),
    );
  }

  // Flush buffers on terminal events
  const flushPoints = [
    HARNESS_HOOK_POINTS.AFTER_TURN,
    HARNESS_HOOK_POINTS.ON_ABORT,
    HARNESS_HOOK_POINTS.ON_ERROR,
    HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR,
  ];
  for (const point of flushPoints) {
    disposers.push(
      hookManager.on(
        point,
        async () => {
          await flushAllManifests();
          await flushAllJsonlBuffers();
        },
        {
          id: `${PLUGIN_NAME}.flush.${point}`,
          priority: 5,
          timeoutMs: 2000,
        },
      ),
    );
  }

  return { name: PLUGIN_NAME, version: PLUGIN_VERSION, disposers };
}

export default createHarnessPlugin;
