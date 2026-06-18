/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  updateManifestCached,
  appendJsonlBuffered,
  writeJson,
} from "../store/store.js";
import {
  isHarnessPromptAlreadyInjected,
  injectSystemMessages,
} from "../prompt/prompt-injector.js";
import { nowIso, safeError } from "../data/record-builders.js";
import {
  HARNESS_ENGINEERING_CAPABILITIES,
  resolveCapabilityProfile,
} from "../capabilities/profile.js";
import {
  HARNESS_FLUSH_REASONS,
  HARNESS_HOOK_POINTS,
  HARNESS_RUN_STATUS,
  HARNESS_TERMINAL_RUN_STATUSES,
} from "../core/constants.js";
import { createRunPaths, ensureRunDir } from "../core/context.js";
import { advanceFsmState } from "../fsm/state-machine.js";
import {
  buildTraceContextSnapshot,
  buildTraceEvent,
  buildTracePromptRecord,
} from "./event-builder.js";
import {
  normalizeFsmState,
  statusToFsmState,
} from "../fsm/transitions.js";
import { resolveDialogProcessIdFromContext } from "../capabilities/handlers/shared/runtime/dialog-process-id.js";
import {
  HARNESS_MESSAGE_BLOCK_POLICY_PRESERVE_FIELD,
  HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_FIELD,
  HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_SYSTEM,
  HARNESS_MESSAGE_BLOCK_POLICY_SLOT_FIELD,
} from "../capabilities/handlers/shared/constants.js";
import {
  HARNESS_I18N_KEYSET,
  resolveLocale as resolveHarnessLocale,
  translateI18nText,
} from "../capabilities/handlers/shared/i18n.js";
import { buildDefaultPolicyPrompt } from "./policy-prompt-matrix.js";

export { resolvePolicyPromptSelection } from "./policy-prompt-matrix.js";

function resolveFlushReasonByPoint(point = "") {
  if (
    point === HARNESS_HOOK_POINTS.AFTER_TURN ||
    point === HARNESS_HOOK_POINTS.ON_ABORT ||
    point === HARNESS_HOOK_POINTS.ON_ERROR
  ) {
    return HARNESS_FLUSH_REASONS.TERMINAL;
  }
  if (
    point === HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR ||
    point === HARNESS_HOOK_POINTS.LLM_CALL_ERROR ||
    point === HARNESS_HOOK_POINTS.TOOL_CALL_ERROR
  ) {
    return HARNESS_FLUSH_REASONS.ERROR;
  }
  return HARNESS_FLUSH_REASONS.NONE;
}

function resolveManifestDialogProcessId(ctx = {}, current = {}) {
  const fromContext = resolveDialogProcessIdFromContext(ctx);
  if (fromContext) return fromContext;
  const fromCurrent = resolveDialogProcessIdFromContext({
    dialogProcessId: current?.dialogProcessId,
  });
  if (fromCurrent) return fromCurrent;
  return String(current?.harnessRunId || "").trim();
}

function mergeManifest(current, ctx, patch, options, capabilityRuntime, paths = null, plugin = {}) {
  const resolvedPaths =
    current?.paths && typeof current.paths === "object" && Object.keys(current.paths).length > 0
      ? current.paths
      : paths && typeof paths === "object"
        ? {
            runDir: paths.runDir,
            contextSnapshot: paths.contextSnapshot,
            events: paths.events,
            prompts: paths.prompts,
            policyChecks: paths.policyChecks,
            capabilityTraces: paths.capabilityTraces,
          }
        : {};
  const next = {
    plugin: plugin.name,
    version: plugin.version,
    harnessRunId: current.harnessRunId || "",
    userId: ctx.userId || current.userId || "",
    sessionId: ctx.sessionId || current.sessionId || "",
    parentSessionId: ctx.parentSessionId || current.parentSessionId || "",
    dialogProcessId: resolveManifestDialogProcessId(ctx, current),
    caller: ctx.caller || current.caller || "",
    status: current.status || HARNESS_RUN_STATUS.RUNNING,
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
  if (HARNESS_TERMINAL_RUN_STATUSES.has(String(patch.status || ""))) {
    next.endedAt = patch.endedAt || nowIso();
  }
  return next;
}

export async function updateManifest(paths, ctx = {}, patch = {}, options = {}, capabilityRuntime = null, plugin = {}) {
  if (!paths) return;
  await updateManifestCached(
    paths,
    ctx,
    patch,
    options,
    capabilityRuntime,
    (current, hookCtx, nextPatch, hookOptions, runtimeCapability) =>
      mergeManifest(current, hookCtx, nextPatch, hookOptions, runtimeCapability, paths, plugin),
    options.manifestDebounceMs,
  );
}

export async function injectPrompt(point, ctx, options, plugin = {}) {
  if (!options.enabled || !options.promptPolicy) return;
  const id =
    point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT
      ? "noobot-harness-final-response"
      : "noobot-harness-policy";
  const locale = resolveHarnessLocale(ctx);
  const resolveDefaultPrompt = () => (point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT
    ? translateI18nText(locale, HARNESS_I18N_KEYSET.SYSTEM_PROMPT.FINAL_RESPONSE)
    : buildDefaultPolicyPrompt(locale, ctx, options));
  const configuredPrompt = String(
    point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT ? options.finalResponseText : options.promptText,
  ).trim();
  const content = configuredPrompt || resolveDefaultPrompt();
  if (!content) return;

  const alreadyInCurrentMessages = Array.isArray(ctx?.messages) &&
    isHarnessPromptAlreadyInjected(ctx.messages, id);
  if (alreadyInCurrentMessages && point !== HARNESS_HOOK_POINTS.BEFORE_LLM_CALL) return;

  const isPolicyPrompt = point === HARNESS_HOOK_POINTS.BEFORE_LLM_CALL;
  const injected = injectSystemMessages(ctx, {
    skipIds: new Set(),
    prompts: [{
      id,
      content,
      priority: options.promptPriority,
      mode: "after_system",
      messageBlockPolicy: isPolicyPrompt
        ? {
            [HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_FIELD]: HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_SYSTEM,
            [HARNESS_MESSAGE_BLOCK_POLICY_PRESERVE_FIELD]: true,
            [HARNESS_MESSAGE_BLOCK_POLICY_SLOT_FIELD]: "policy",
          }
        : null,
    }],
    systemBlockIds: isPolicyPrompt ? new Set([id]) : new Set(),
    syncMessageBlocksSystem: isPolicyPrompt,
    persistToCurrentTurn: !isPolicyPrompt,
  });

  if (!injected || !options.writePrompts) return;
  const paths = createRunPaths(ctx, options);
  if (!paths) return;
  await ensureRunDir(paths);
  await appendJsonlBuffered(
    paths.prompts,
    buildTracePromptRecord({
      promptId: id,
      point,
      content,
      maxPreviewChars: options.maxPreviewChars,
    }),
    options.jsonlFlushStrategy || options.jsonlBatchSize,
    options.jsonlFlushIntervalMs,
  );
}

export async function traceHook(point, ctx, options, plugin = {}) {
  if (!options.enabled || !options.trace) return;
  const paths = createRunPaths(ctx, options);
  if (!paths) return;
  await ensureRunDir(paths);
  const fsm = await advanceFsmState(point, ctx, paths, options);
  const event = buildTraceEvent({
    point,
    ctx,
    options,
    pluginName: plugin.name,
    pluginVersion: plugin.version,
  });
  const flushReason = resolveFlushReasonByPoint(point);

  await appendJsonlBuffered(
    paths.events,
    event,
    options.jsonlFlushStrategy || options.jsonlBatchSize,
    options.jsonlFlushIntervalMs,
    { reason: flushReason },
  );
  const capabilityTraceLogs = (Array.isArray(event.capabilityLogs) ? event.capabilityLogs : []).filter(
    (log) => log?.event === "capability_model_trace",
  );
  for (const log of capabilityTraceLogs) {
    await appendJsonlBuffered(
      paths.capabilityTraces,
      {
        eventId: event.eventId,
        point,
        timestamp: event.timestamp,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        dialogProcessId: resolveDialogProcessIdFromContext({
          dialogProcessId: ctx.dialogProcessId,
        }),
        ...log,
      },
      options.jsonlFlushStrategy || options.jsonlBatchSize,
      options.jsonlFlushIntervalMs,
      { reason: flushReason },
    );
  }

  if (point === HARNESS_HOOK_POINTS.AFTER_CONTEXT_BUILD && options.writeContextSnapshot) {
    await writeJson(
      paths.contextSnapshot,
      buildTraceContextSnapshot({
        ctx,
        pluginName: plugin.name,
        pluginVersion: plugin.version,
      }),
    );
  }

  const terminalStatus =
    point === HARNESS_HOOK_POINTS.AFTER_TURN
      ? HARNESS_RUN_STATUS.SUCCESS
      : point === HARNESS_HOOK_POINTS.ON_ERROR || point === HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR
        ? HARNESS_RUN_STATUS.ERROR
        : point === HARNESS_HOOK_POINTS.ON_ABORT
          ? HARNESS_RUN_STATUS.ABORT
          : null;

  await updateManifest(
    paths,
    ctx,
    {
      status: terminalStatus || HARNESS_RUN_STATUS.RUNNING,
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
    plugin,
  );

  return {
    fsmState: fsm.state,
    fsmRejected: fsm.rejected === true,
  };
}
