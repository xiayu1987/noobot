/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { flushAllManifests, flushAllJsonlBuffers } from "../store/store.js";
import { cleanupRunsBySessionIds } from "../utils/cleanup.js";
import { injectPrompt, traceHook } from "../tracing/buffer-manager.js";
import { createRunTraceSink } from "../tracing/run-trace-sink.js";
import { safeError } from "../data/record-builders.js";
import {
  emitHarnessHookProgress,
  extractBasePath,
  isPrimaryExecutionScope,
  normalizeHookContextProtocol,
} from "./context.js";
import { HARNESS_HOOK_POINTS } from "./constants.js";
import {
  HARNESS_MESSAGE_BLOCK_POLICY_FIELD,
  HARNESS_MESSAGE_BLOCK_POLICY_PRESERVE_FIELD,
  HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_FIELD,
  HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_SYSTEM,
  HARNESS_MESSAGE_BLOCK_POLICY_SLOT_FIELD,
} from "../capabilities/handlers/shared/constants.js";

export const HARNESS_TRACE_POINTS = Object.freeze([
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
  HARNESS_HOOK_POINTS.AFTER_TOOL_CALLS,
  HARNESS_HOOK_POINTS.BEFORE_TOOL_CALL,
  HARNESS_HOOK_POINTS.AFTER_TOOL_CALL,
  HARNESS_HOOK_POINTS.TOOL_CALL_ERROR,
  HARNESS_HOOK_POINTS.BEFORE_STATE_COMMIT,
  HARNESS_HOOK_POINTS.AFTER_STATE_COMMIT,
  HARNESS_HOOK_POINTS.BEFORE_LLM_CALL,
  HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT,
]);

export const HARNESS_FLUSH_POINTS = Object.freeze([
  HARNESS_HOOK_POINTS.AFTER_TURN,
  HARNESS_HOOK_POINTS.ON_ABORT,
  HARNESS_HOOK_POINTS.ON_ERROR,
  HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR,
]);

export const HARNESS_SESSION_CLEANUP_POINTS = Object.freeze([
  HARNESS_HOOK_POINTS.AFTER_SESSION_DELETE,
]);

export function shouldInjectPromptAtPoint(point = "", options = {}) {
  return (
    point === HARNESS_HOOK_POINTS.BEFORE_LLM_CALL ||
    (point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT && options.finalResponseGuard !== false)
  );
}

function resolveMessageRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
  if (role) return role;
  const type = String(
    message?.type ||
      message?.lc_kwargs?.type ||
      (typeof message?._getType === "function" ? message._getType() : ""),
  )
    .trim()
    .toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  return type;
}

function splitLeadingSystemMessages(messages = []) {
  let index = 0;
  while (index < messages.length && resolveMessageRole(messages[index]) === "system") {
    index += 1;
  }
  return {
    system: messages.slice(0, index),
    conversation: messages.slice(index),
  };
}

function normalizeMessageBlockList(value = []) {
  return Array.isArray(value) ? value : [];
}

function isMessageSummarized(message = {}) {
  return message?.summarized === true ||
    message?.lc_kwargs?.summarized === true ||
    message?.additional_kwargs?.summarized === true ||
    message?.lc_kwargs?.additional_kwargs?.summarized === true;
}

function filterSummarizedMessages(messages = []) {
  return normalizeMessageBlockList(messages).filter((message = {}) => !isMessageSummarized(message));
}

function resolveMessageBlocks(ctx = {}) {
  if (!ctx?.messageBlocks || typeof ctx.messageBlocks !== "object") return null;
  return {
    system: filterSummarizedMessages(ctx.messageBlocks.system),
    history: filterSummarizedMessages(ctx.messageBlocks.history),
    incremental: filterSummarizedMessages(ctx.messageBlocks.incremental),
  };
}

function resolveIsFrontendUserMessage(message = {}) {
  if (!message || typeof message !== "object") return false;
  if (message?.frontendUserMessage === true) return true;
  if (message?.additional_kwargs?.frontendUserMessage === true) return true;
  if (message?.lc_kwargs?.frontendUserMessage === true) return true;
  if (message?.lc_kwargs?.additional_kwargs?.frontendUserMessage === true) return true;
  return false;
}

function mergeUniqueByReference(primary = [], extras = []) {
  const merged = [];
  const seenRef = new Set();
  const seenSignature = new Set();
  for (const item of [...primary, ...extras]) {
    if (!item || typeof item !== "object") {
      merged.push(item);
      continue;
    }
    if (seenRef.has(item)) continue;
    const role = resolveMessageRole(item);
    const content = String(item?.content || "");
    const toolCallId = String(item?.tool_call_id || item?.toolCallId || "").trim();
    const assistantToolCallIds = Array.isArray(item?.tool_calls)
      ? item.tool_calls
          .map((call = {}) =>
            String(call?.id || call?.tool_call_id || call?.toolCallId || "").trim(),
          )
          .filter(Boolean)
          .join(",")
      : "";
    const signature = [role, content, toolCallId, assistantToolCallIds].join("::");
    if (seenSignature.has(signature)) continue;
    seenRef.add(item);
    seenSignature.add(signature);
    merged.push(item);
  }
  return merged;
}

function resolveMessageContent(message = {}) {
  return String(message?.content || message?.lc_kwargs?.content || "").trim();
}

function resolveMessageMetaField(message = {}, field = "") {
  const key = String(field || "").trim();
  if (!key) return "";
  return String(
    message?.[key] ||
      message?.additional_kwargs?.[key] ||
      message?.lc_kwargs?.[key] ||
      message?.lc_kwargs?.additional_kwargs?.[key] ||
      "",
  ).trim();
}

function isPlainUserMessage(message = {}) {
  if (resolveMessageRole(message) !== "user") return false;
  const content = resolveMessageContent(message);
  if (!content) return false;
  if (content.startsWith("[")) return false;
  return true;
}

function resolveCurrentUserIdentity(message = {}) {
  if (!isPlainUserMessage(message)) return null;
  const turnScopeId = resolveMessageMetaField(message, "turnScopeId");
  if (turnScopeId) return { kind: "turnScopeId", value: turnScopeId };
  const dialogProcessId = resolveMessageMetaField(message, "dialogProcessId");
  if (dialogProcessId) return { kind: "dialogProcessId", value: dialogProcessId };
  const content = resolveMessageContent(message);
  return content ? { kind: "content", value: content } : null;
}

function filterCurrentUserResidueFromHistory(history = [], incremental = []) {
  const currentIdentities = new Set(
    normalizeMessageBlockList(incremental)
      .map((message) => resolveCurrentUserIdentity(message))
      .filter(Boolean)
      .map((identity) => `${identity.kind}:${identity.value}`),
  );
  if (!currentIdentities.size) return history;
  return normalizeMessageBlockList(history).filter((message) => {
    if (!isPlainUserMessage(message)) return true;
    const identity = resolveCurrentUserIdentity(message);
    if (!identity) return true;
    return !currentIdentities.has(`${identity.kind}:${identity.value}`);
  });
}


function readMessageBlockPolicy(message = {}) {
  const policy =
    message?.[HARNESS_MESSAGE_BLOCK_POLICY_FIELD] ||
    message?.lc_kwargs?.[HARNESS_MESSAGE_BLOCK_POLICY_FIELD] ||
    message?.additional_kwargs?.[HARNESS_MESSAGE_BLOCK_POLICY_FIELD] ||
    message?.lc_kwargs?.additional_kwargs?.[HARNESS_MESSAGE_BLOCK_POLICY_FIELD] ||
    null;
  return policy && typeof policy === "object" && !Array.isArray(policy) ? policy : null;
}

function shouldPreserveSystemMessage(message = {}) {
  if (resolveMessageRole(message) !== "system") return false;
  const policy = readMessageBlockPolicy(message);
  return policy?.[HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_FIELD] === HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_SYSTEM &&
    policy?.[HARNESS_MESSAGE_BLOCK_POLICY_PRESERVE_FIELD] === true;
}

function resolvePreservedSystemMessageSignature(message = {}) {
  if (!shouldPreserveSystemMessage(message)) return "";
  const policy = readMessageBlockPolicy(message);
  const slot = String(policy?.[HARNESS_MESSAGE_BLOCK_POLICY_SLOT_FIELD] || "").trim();
  if (slot) return `message_block_policy:${HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_SYSTEM}:${slot}`;
  return `message_block_policy:${HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_SYSTEM}:${String(message?.content || "")}`;
}

function preserveSystemMessagesByPolicy(source = [], resolved = []) {
  const output = Array.isArray(resolved) ? [...resolved] : [];
  const signatures = new Set(
    output
      .map((message = {}) => resolvePreservedSystemMessageSignature(message))
      .filter(Boolean),
  );
  for (const message of Array.isArray(source) ? source : []) {
    const signature = resolvePreservedSystemMessageSignature(message);
    if (!signature || signatures.has(signature)) continue;
    output.push(message);
    signatures.add(signature);
  }
  return output;
}

function resolveFrontendUserAnchoredIncremental(source = [], resolved = []) {
  const sourceList = Array.isArray(source) ? source : [];
  const resolvedList = Array.isArray(resolved) ? resolved : [];
  const anchor = sourceList.find((message) => resolveIsFrontendUserMessage(message));
  if (!anchor) return resolvedList;
  if (resolvedList.includes(anchor)) return resolvedList;
  const anchorIdentity = resolveCurrentUserIdentity(anchor);
  if (
    anchorIdentity &&
    resolvedList.some((message) => {
      const identity = resolveCurrentUserIdentity(message);
      return identity?.kind === anchorIdentity.kind && identity?.value === anchorIdentity.value;
    })
  ) {
    return resolvedList;
  }
  return [anchor, ...resolvedList];
}

function writeMessageBlocksInPlace(
  ctx = {},
  { system = [], history = [], incremental = [] } = {},
) {
  const existing =
    ctx?.messageBlocks && typeof ctx.messageBlocks === "object" ? ctx.messageBlocks : null;
  const target = existing || {};
  target.system = Array.isArray(system) ? system : [];
  target.history = Array.isArray(history) ? history : [];
  target.incremental = Array.isArray(incremental) ? incremental : [];
  ctx.messageBlocks = target;
  return target;
}

function compactFinalMessageBlocks(point = "", ctx = {}, options = {}) {
  if (point !== HARNESS_HOOK_POINTS.BEFORE_LLM_CALL) return null;
  const blocks = resolveMessageBlocks(ctx);
  if (!blocks) return null;
  if (typeof options?.resolveMessageBlock !== "function") return null;
  const allMessages = Array.isArray(ctx?.messages) ? ctx.messages : [];
  const knownRefs = new Set([
    ...normalizeMessageBlockList(blocks.system),
    ...normalizeMessageBlockList(blocks.history),
    ...normalizeMessageBlockList(blocks.incremental),
  ]);
  const extras = allMessages.filter((message) => !knownRefs.has(message));
  const extraSystem = extras.filter((message) => resolveMessageRole(message) === "system");
  const extraIncremental = extras.filter((message) => resolveMessageRole(message) !== "system");

  const systemSource = mergeUniqueByReference(blocks.system, extraSystem);
  const historySource = normalizeMessageBlockList(blocks.history);
  const incrementalSource = mergeUniqueByReference(blocks.incremental, extraIncremental);

  const systemResolved = options.resolveMessageBlock({
    scope: "system",
    messages: systemSource,
    ctx,
  });
  const historyResolved = options.resolveMessageBlock({
    scope: "history",
    messages: historySource,
    ctx,
  });
  const incrementalResolved = options.resolveMessageBlock({
    scope: "incremental",
    messages: incrementalSource,
    ctx,
  });

  const system = preserveSystemMessagesByPolicy(
    systemSource,
    filterSummarizedMessages(Array.isArray(systemResolved) ? systemResolved : systemSource),
  );
  const history = filterSummarizedMessages(Array.isArray(historyResolved) ? historyResolved : historySource);
  const incrementalBase = resolveFrontendUserAnchoredIncremental(
    incrementalSource,
    filterSummarizedMessages(Array.isArray(incrementalResolved) ? incrementalResolved : incrementalSource),
  );
  const conversationResolved = options.resolveMessageBlock({
    scope: "conversation",
    messages: incrementalBase,
    ctx,
  });
  const incrementalConversation = resolveFrontendUserAnchoredIncremental(
    incrementalSource,
    filterSummarizedMessages(Array.isArray(conversationResolved) ? conversationResolved : incrementalBase),
  );
  const historyConversation = filterCurrentUserResidueFromHistory(history, incrementalConversation);
  const conversation = [...historyConversation, ...incrementalConversation];
  return {
    system,
    history,
    incremental: incrementalBase,
    conversation,
    sourceBlocks: {
      system: systemSource,
      history: historySource,
      incremental: incrementalSource,
    },
  };
}

function compactFinalConversationWindow(point = "", ctx = {}, options = {}) {
  if (point !== HARNESS_HOOK_POINTS.BEFORE_LLM_CALL) return false;
  if (!Array.isArray(ctx?.messages)) return false;
  if (typeof options?.resolveMessageBlock !== "function") return false;
  const compactedBlocks = compactFinalMessageBlocks(point, ctx, options);
  if (compactedBlocks) {
    const conversation = Array.isArray(compactedBlocks.conversation)
      ? compactedBlocks.conversation
      : [...compactedBlocks.history, ...compactedBlocks.incremental];
    const composed = [
      ...compactedBlocks.system,
      ...conversation,
    ];
    ctx.messages.splice(0, ctx.messages.length, ...composed);
    // Keep messageBlocks as the re-computable source blocks, not as the final
    // compacted model window. The final ctx.messages window is intentionally
    // lossy; messageBlocks must remain lossless for the current turn so a later
    // summary pass can filter summarized tool burst messages and recover older
    // current-turn injections from the same source.
    writeMessageBlocksInPlace(ctx, compactedBlocks.sourceBlocks || {
      system: compactedBlocks.system,
      history: compactedBlocks.history,
      incremental: compactedBlocks.incremental,
    });
    return true;
  }
  const { system, conversation } = splitLeadingSystemMessages(ctx.messages);
  const resolved = options.resolveMessageBlock({
    scope: "conversation",
    messages: conversation,
    ctx,
  });
  if (!Array.isArray(resolved)) return false;
  ctx.messages.splice(0, ctx.messages.length, ...system, ...resolved);
  return true;
}

export function createRegisterHarnessHooks(deps = {}) {
  const tracePoints = deps.tracePoints || HARNESS_TRACE_POINTS;
  const flushPoints = deps.flushPoints || HARNESS_FLUSH_POINTS;
  const emitHarnessHookProgressFn = deps.emitHarnessHookProgress || emitHarnessHookProgress;
  const isPrimaryExecutionScopeFn = deps.isPrimaryExecutionScope || isPrimaryExecutionScope;
  const shouldInjectPromptAtPointFn = deps.shouldInjectPromptAtPoint || shouldInjectPromptAtPoint;
  const injectPromptFn = deps.injectPrompt || injectPrompt;
  const traceHookFn = deps.traceHook || traceHook;
  const createRunTraceSinkFn = deps.createRunTraceSink || createRunTraceSink;
  const safeErrorFn = deps.safeError || safeError;
  const flushAllManifestsFn = deps.flushAllManifests || flushAllManifests;
  const flushAllJsonlBuffersFn = deps.flushAllJsonlBuffers || flushAllJsonlBuffers;
  const sessionCleanupPoints = deps.sessionCleanupPoints || HARNESS_SESSION_CLEANUP_POINTS;
  const cleanupRunsBySessionIdsFn = deps.cleanupRunsBySessionIds || cleanupRunsBySessionIds;
  const extractBasePathFn = deps.extractBasePath || extractBasePath;

  return function registerHarnessHooks({ hookManager, options, capabilityRuntime, plugin }) {
    const disposers = [];

    for (const point of tracePoints) {
      disposers.push(
        hookManager.on(
          point,
          async (ctx = {}) => {
            if (!isPrimaryExecutionScopeFn(ctx)) return;
            normalizeHookContextProtocol(point, ctx);
            emitHarnessHookProgressFn(ctx, "hook_start", { point });
            try {
              await capabilityRuntime.runHook(point, ctx, {
                pluginName: plugin.name,
                pluginVersion: plugin.version,
                harness: {
                  planningGuidanceMode: options.planningGuidanceMode,
                  summaryOnToolBurstThreshold: options.summaryOnToolBurstThreshold === true,
                  summaryDetailSaveToAttachment: options.summaryDetailSaveToAttachment === true,
                  saveSummaryDetailToAttachment: options.summaryDetailSaveToAttachment === true,
                  clipNonMainModelContextMessages: options.clipNonMainModelContextMessages === true,
                  capabilityModelInvoker: options.capabilityModelInvoker,
                  capabilityModelByPurpose: options.capabilityModelByPurpose,
                  stepModels: options.stepModels,
                  resolveModelMessages: options.resolveModelMessages,
                  resolveMessageBlock: options.resolveMessageBlock,
                  markMessagesSummarized: options.markMessagesSummarized,
                  capabilityToolAllowlist: options.capabilityToolAllowlist,
                  capabilityToolAllowlistByPurpose: options.capabilityToolAllowlistByPurpose,
                  acceptance: options.acceptance,
                  review: options.review,
                  pendingTtlHookTurns: options.pendingTtlHookTurns,
                  planRefinementEnabled: options.planRefinementEnabled,
                  runTraceSink: createRunTraceSinkFn(ctx, options),
                },
              });
              emitHarnessHookProgressFn(ctx, "capability_runtime_done", { point });

              if (shouldInjectPromptAtPointFn(point, options)) {
                await injectPromptFn(point, ctx, options, plugin);
                emitHarnessHookProgressFn(ctx, "prompt_injected", { point });
              }
              compactFinalConversationWindow(point, ctx, options);

              const traceResult = await traceHookFn(point, ctx, options, plugin);
              emitHarnessHookProgressFn(ctx, "hook_end", {
                point,
                fsmState: traceResult?.fsmState,
                fsmRejected: traceResult?.fsmRejected === true,
              });
            } catch (error) {
              emitHarnessHookProgressFn(ctx, "hook_error", { point, error: safeErrorFn(error) });
              throw error;
            }
          },
          {
            id: `${plugin.name}.trace.${point}`,
            priority: options.tracePriority,
            timeoutMs: options.timeoutMs,
          },
        ),
      );
    }

    for (const point of flushPoints) {
      disposers.push(
        hookManager.on(
          point,
          async () => {
            await flushAllManifestsFn();
            await flushAllJsonlBuffersFn();
          },
          {
            id: `${plugin.name}.flush.${point}`,
            priority: Number.isFinite(Number(options?.flushHookPriority))
              ? Number(options.flushHookPriority)
              : 5,
            timeoutMs: Number.isFinite(Number(options?.flushHookTimeoutMs))
              ? Math.max(1, Number(options.flushHookTimeoutMs))
              : 2000,
          },
        ),
      );
    }

    for (const point of sessionCleanupPoints) {
      disposers.push(
        hookManager.on(
          point,
          async (ctx = {}) => {
            const deletedSessionIds = Array.isArray(ctx?.deletedSessionIds)
              ? ctx.deletedSessionIds.map((id) => String(id || "").trim()).filter(Boolean)
              : [];
            const fallbackSessionId = String(ctx?.sessionId || "").trim();
            const sessionIds = deletedSessionIds.length
              ? deletedSessionIds
              : fallbackSessionId
                ? [fallbackSessionId]
                : [];
            if (!sessionIds.length) return;

            await flushAllManifestsFn();
            await flushAllJsonlBuffersFn();

            const basePath = extractBasePathFn(ctx, options);
            if (!basePath) return;
            const cleanup = await cleanupRunsBySessionIdsFn(basePath, sessionIds, options);
            emitHarnessHookProgressFn(ctx, "session_cleanup_done", {
              point,
              deleted: cleanup?.deleted || 0,
              matchedRuns: cleanup?.matchedRuns || 0,
              errors: cleanup?.errors || 0,
              skippedLocked: cleanup?.skippedLocked || 0,
            });
          },
          {
            id: `${plugin.name}.cleanup.${point}`,
            priority: 10,
            timeoutMs: Math.max(2000, Number(options?.timeoutMs) || 0),
          },
        ),
      );
    }

    return disposers;
  };
}

export const registerHarnessHooks = createRegisterHarnessHooks();
