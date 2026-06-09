/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureTaskAcceptanceTool } from "../acceptance.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  CAPABILITY_DOMAIN,
  appendCapabilityLog,
  disableBlockedToolsInRegistry,
  ensureHarnessBucket,
  extractRawTextContent,
  sanitizeInternalMessages,
  shouldUseSeparateModel,
} from "./deps.js";
import { ensurePlanRefinementTool } from "./tool-injector.js";
import { maybeInjectPlanningPrompt } from "./prompt-builder.js";
import { maybeCapturePlanningResult, runPlanningBySeparateModel } from "./capture-runner.js";
import { canAttemptPlanUpdate, setPendingPlanUpdate } from "./plan-update-engine.js";
import { resolvePendingPlanUpdate } from "./plan-update-scheduler.js";
import { LOCALE } from "../shared/constants.js";
import { translateI18nText } from "../shared/i18n.js";
import {
  resolveWorkflowMode,
  runWorkflowLifecycle,
} from "../shared/workflow/pattern.js";
import { enforceWorkflowInvariants } from "../shared/workflow/invariants.js";

function isMessageSummarized(message = {}) {
  return message?.summarized === true || message?.lc_kwargs?.summarized === true;
}

function resolveUnsummarizedMessageChars(messages = []) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((total, message) => {
    if (!message || typeof message !== "object") return total;
    if (isMessageSummarized(message)) return total;
    const content = extractRawTextContent(message?.content ?? message);
    return total + String(content || "").length;
  }, 0);
}

const TASK_SUMMARY_TOOL_NAME = WORKFLOW_PARAMS.planning.tools.summaryToolName;
const PLANNING_DECISION = WORKFLOW_PARAMS.planning.decisions;
const PLANNING_EVENTS = WORKFLOW_PARAMS.logging.events.planning;
const ACCEPTANCE_EVENTS = WORKFLOW_PARAMS.logging.events.acceptance;
const LLM_SUMMARY_THRESHOLD = WORKFLOW_PARAMS.planning.summary.turnsThreshold;
const LLM_SUMMARY_TOOL_CALLS_THRESHOLD = LLM_SUMMARY_THRESHOLD;
const LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD = WORKFLOW_PARAMS.planning.summary.messageCharsThreshold;
const LLM_SUMMARY_OVERFLOW_POLICY = Object.freeze({
  ENABLE_PRUNE_AFTER_SUMMARY: WORKFLOW_PARAMS.planning.summary.overflowPolicy.enablePruneAfterSummary,
  PRUNE_TRIGGER_AFTER_CHAR_SUMMARY_ROUNDS:
    WORKFLOW_PARAMS.planning.summary.overflowPolicy.pruneTriggerAfterCharSummaryRounds,
  FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW:
    WORKFLOW_PARAMS.planning.summary.overflowPolicy.forceAcceptanceWhenStillOverflow,
});
const PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD = WORKFLOW_PARAMS.planning.planUpdate.triggerTurnsThreshold;
const PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.acceptance.phase.triggerTurnsThreshold;
const PLANNING_REASON_LABEL_KEY = Object.freeze({
  [PLANNING_DECISION.reason.idle]: "planningReasonIdle",
  [PLANNING_DECISION.reason.summaryThresholdTurns]: "planningReasonSummaryThresholdTurns",
  [PLANNING_DECISION.reason.summaryThresholdChars]: "planningReasonSummaryThresholdChars",
  [PLANNING_DECISION.reason.planUpdateThreshold]: "planningReasonPlanUpdateThreshold",
  [PLANNING_DECISION.reason.phaseAcceptanceThreshold]: "planningReasonPhaseAcceptanceThreshold",
  [PLANNING_DECISION.reason.afterLlmCapture]: "planningReasonAfterLlmCapture",
});
const PLANNING_BLOCKED_REASON_LABEL_KEY = Object.freeze({
  plan_update_blocked_by_pending_plan_update: "planningBlockedPlanUpdatePending",
  phase_acceptance_blocked_by_higher_priority_pending: "planningBlockedPhaseAcceptanceHigherPriority",
});

function resolvePlanningReasonLabel(locale = LOCALE.ZH_CN, reason = "") {
  const key = PLANNING_REASON_LABEL_KEY[String(reason || "").trim()];
  if (!key) return String(reason || "").trim();
  return translateI18nText(locale, key) || String(reason || "").trim();
}

function resolvePlanningBlockedReasonLabel(locale = LOCALE.ZH_CN, reason = "") {
  const key = PLANNING_BLOCKED_REASON_LABEL_KEY[String(reason || "").trim()];
  if (!key) return String(reason || "").trim();
  return translateI18nText(locale, key) || String(reason || "").trim();
}

function resolvePlanningTriggeredActions({
  summary = false,
  summaryByCharsPrompted = false,
  planUpdate = false,
  phaseAcceptance = false,
} = {}) {
  const actions = [];
  if (summaryByCharsPrompted && summary) {
    actions.push(PLANNING_DECISION.label.summaryOverflow);
  } else if (summary) {
    actions.push(PLANNING_DECISION.label.summaryTurns);
  }
  if (planUpdate) {
    actions.push(PLANNING_DECISION.label.planUpdateRevision);
  }
  if (phaseAcceptance) {
    actions.push(PLANNING_DECISION.label.phaseAcceptance);
  }
  return actions;
}

function getMessageToolCalls(messageItem = {}) {
  if (Array.isArray(messageItem?.tool_calls)) return messageItem.tool_calls;
  if (Array.isArray(messageItem?.lc_kwargs?.tool_calls)) return messageItem.lc_kwargs.tool_calls;
  if (Array.isArray(messageItem?.additional_kwargs?.tool_calls)) return messageItem.additional_kwargs.tool_calls;
  return [];
}

function resolveToolNameFromToolCall(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  if (toolCall.name) return String(toolCall.name || "").trim();
  const fn = toolCall.function && typeof toolCall.function === "object" ? toolCall.function : {};
  return String(fn.name || "").trim();
}

function resolveToolCallId(toolCall = {}) {
  return String(toolCall?.id ?? toolCall?.tool_call_id ?? toolCall?.toolCallId ?? "").trim();
}

function resolveToolCallIdFromToolMessage(messageItem = {}) {
  return String(
    messageItem?.tool_call_id ??
      messageItem?.toolCallId ??
      messageItem?.lc_kwargs?.tool_call_id ??
      "",
  ).trim();
}

function maybeScheduleSummaryByToolBurst(ctx = {}) {
  const threshold = Number(LLM_SUMMARY_TOOL_CALLS_THRESHOLD);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  const calls = Array.isArray(ctx?.calls) ? ctx.calls : [];
  if (!Array.isArray(calls) || calls.length < threshold) return false;
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  if (holder.state?.pending?.summary === true) return false;
  const toolNames = calls.map((call) => resolveToolNameFromToolCall(call)).filter(Boolean);
  if (toolNames.includes(TASK_SUMMARY_TOOL_NAME)) return false;

  setPendingStateWithMeta(holder.state, "summary", true);
  holder.state.flags.summaryByCharsPrompted = false;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: PLANNING_EVENTS.summaryScheduledByToolBurstThreshold,
    detail: {
      threshold,
      toolCallCount: calls.length,
      toolNames,
    },
  });
  return true;
}

function setMessageSummarized(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem.summarized === true && messageItem?.lc_kwargs?.summarized === true) return false;
  messageItem.summarized = true;
  if (messageItem?.lc_kwargs && typeof messageItem.lc_kwargs === "object") {
    messageItem.lc_kwargs.summarized = true;
  }
  return true;
}

function discardOldestToolCallPairs(messages = [], charsThreshold = 0) {
  if (!Array.isArray(messages) || !Number.isFinite(charsThreshold) || charsThreshold <= 0) {
    return { discardedMessages: 0, charsAfter: resolveUnsummarizedMessageChars(messages) };
  }
  let charsAfter = resolveUnsummarizedMessageChars(messages);
  if (charsAfter <= charsThreshold) {
    return { discardedMessages: 0, charsAfter };
  }

  let discardedMessages = 0;
  for (let index = 0; index < messages.length; index += 1) {
    if (charsAfter <= charsThreshold) break;
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    if (isMessageSummarized(message)) continue;
    const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
    if (role !== "assistant") continue;
    const contentText = extractRawTextContent(message?.content ?? "");
    if (String(contentText || "").trim()) continue;
    const toolCalls = getMessageToolCalls(message);
    if (!toolCalls.length) continue;

    const toolCallIds = toolCalls
      .filter((toolCall) => resolveToolNameFromToolCall(toolCall) !== TASK_SUMMARY_TOOL_NAME)
      .map((toolCall) => resolveToolCallId(toolCall))
      .filter(Boolean);
    if (!toolCallIds.length) continue;

    const toolResultIndexes = [];
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const maybeToolResult = messages[cursor];
      if (!maybeToolResult || typeof maybeToolResult !== "object") continue;
      if (isMessageSummarized(maybeToolResult)) continue;
      const resultRole = String(
        maybeToolResult?.role || maybeToolResult?.lc_kwargs?.role || "",
      ).trim().toLowerCase();
      if (resultRole !== "tool") continue;
      const toolCallId = resolveToolCallIdFromToolMessage(maybeToolResult);
      if (!toolCallId || !toolCallIds.includes(toolCallId)) continue;
      const explicitToolName = String(
        maybeToolResult?.toolName || maybeToolResult?.tool_name || "",
      ).trim();
      if (explicitToolName === TASK_SUMMARY_TOOL_NAME) continue;
      toolResultIndexes.push(cursor);
    }
    if (!toolResultIndexes.length) continue;

    if (setMessageSummarized(message)) discardedMessages += 1;
    for (const toolIndex of toolResultIndexes) {
      if (setMessageSummarized(messages[toolIndex])) discardedMessages += 1;
    }
    charsAfter = resolveUnsummarizedMessageChars(messages);
  }
  return { discardedMessages, charsAfter };
}

export function createPlanningHandler({ shouldProcessPrimaryToolHooks = () => true } = {}) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    if (
      ["before_llm_call", "after_llm_call", "after_tool_calls", "before_final_output"].includes(point) &&
      !shouldProcessPrimaryToolHooks(ctx)
    ) {
      return { capability, point, status: "active", changed: false };
    }
    if (point === "before_llm_call") {
      const invariantChanged = enforceWorkflowInvariants(ctx, { domain: CAPABILITY_DOMAIN.PLANNING }) === true;
      let setupChanged = invariantChanged;
      const holder = ensureHarnessBucket(ctx);
      const mode = resolveWorkflowMode(meta);
      let decisionReason = PLANNING_DECISION.reason.idle;
      const blockedActions = [];
      const blockedReasons = [];
      let candidateActions = [];
      let pendingSnapshotRaw = {
        summary: false,
        summaryByCharsPrompted: false,
        guidance: null,
        planUpdate: false,
        phaseAcceptance: false,
        planningCaptured: false,
      };
      if (holder) {
        holder.state.counters.llmTurns += 1;
        holder.state.counters.planUpdateTurns = Number(holder.state.counters.planUpdateTurns || 0) + 1;
        holder.state.counters.phaseAcceptanceTurns =
          Number(holder.state.counters.phaseAcceptanceTurns || 0) + 1;
        let currentChars = resolveUnsummarizedMessageChars(ctx?.messages);
        const reachedTurnsSummary = holder.state.counters.llmTurns > LLM_SUMMARY_THRESHOLD;
        let reachedCharsSummary = currentChars > LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD;
        const reachedPlanUpdateTurns =
          holder.state.counters.planUpdateTurns >= PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD;
        const reachedPhaseAcceptanceTurns =
          holder.state.counters.phaseAcceptanceTurns >= PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD;

        const pruneEnabled = LLM_SUMMARY_OVERFLOW_POLICY.ENABLE_PRUNE_AFTER_SUMMARY === true;
        const pruneTriggerRounds = Number(
          LLM_SUMMARY_OVERFLOW_POLICY.PRUNE_TRIGGER_AFTER_CHAR_SUMMARY_ROUNDS || 1,
        );
        const canPruneAfterSummary =
          holder.state.flags.summaryByCharsPrompted === true && pruneTriggerRounds <= 1;
        if (reachedCharsSummary && pruneEnabled && canPruneAfterSummary) {
          const pruneResult = discardOldestToolCallPairs(
            ctx?.messages,
            LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD,
          );
          setupChanged = pruneResult.discardedMessages > 0 || setupChanged;
          currentChars = pruneResult.charsAfter;
          reachedCharsSummary = currentChars > LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD;
          if (
            reachedCharsSummary &&
            LLM_SUMMARY_OVERFLOW_POLICY.FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW === true
          ) {
            holder.state.flags.overflowForceAcceptancePending = true;
          } else {
            holder.state.flags.overflowForceAcceptancePending = false;
            holder.state.flags.summaryByCharsPrompted = false;
          }
        } else if (holder.state.flags.overflowForceAcceptancePending !== true) {
          holder.state.flags.overflowForceAcceptancePending = false;
        }

        if (reachedTurnsSummary || reachedCharsSummary) {
          setPendingStateWithMeta(holder.state, "summary", true);
          if (reachedCharsSummary) {
            holder.state.flags.summaryByCharsPrompted = true;
            decisionReason = PLANNING_DECISION.reason.summaryThresholdChars;
          } else if (decisionReason === PLANNING_DECISION.reason.idle) {
            decisionReason = PLANNING_DECISION.reason.summaryThresholdTurns;
          }
        } else {
          holder.state.flags.summaryByCharsPrompted = false;
          holder.state.flags.overflowForceAcceptancePending = false;
        }

        if (reachedPlanUpdateTurns) {
          const blockedByPendingPlanUpdate = resolvePendingPlanUpdate(holder.state).active === true;
          let planUpdateScheduled = false;
          if (
            !blockedByPendingPlanUpdate &&
            canAttemptPlanUpdate(ctx, holder.state, { increment: false, stage: "revision" })
          ) {
            setPendingPlanUpdate(holder.state, {
              active: true,
              stage: "revision",
              summaryText: String(holder.bucket?.summaryText || "").trim(),
            });
            setPendingStateWithMeta(holder.state, "planRevision", true);
            appendCapabilityLog(ctx, {
              domain: CAPABILITY_DOMAIN.PLANNING,
              event: PLANNING_EVENTS.revisionScheduledByTurnThreshold,
              detail: {
                triggerTurns: PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD,
                summaryPending: holder.state.pending?.summary === true,
              },
            });
            planUpdateScheduled = true;
            if (decisionReason === PLANNING_DECISION.reason.idle) {
              decisionReason = PLANNING_DECISION.reason.planUpdateThreshold;
            }
          }
          if (planUpdateScheduled) {
            holder.state.counters.planUpdateTurns = 0;
          } else if (blockedByPendingPlanUpdate) {
            // Keep threshold pressure while a prior plan-update is still pending.
            holder.state.counters.planUpdateTurns = PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD;
            blockedActions.push(PLANNING_DECISION.label.planUpdateRevision);
            blockedReasons.push("plan_update_blocked_by_pending_plan_update");
          } else {
            holder.state.counters.planUpdateTurns = 0;
          }
        }

        if (reachedPhaseAcceptanceTurns) {
          let phaseAcceptanceScheduled = false;
          if (
            holder.state.flags.planningCaptured === true &&
            holder.state.pending?.phaseAcceptance !== true &&
            holder.state.pending?.summary !== true &&
            !holder.state.pending?.guidance &&
            resolvePendingPlanUpdate(holder.state).active !== true
          ) {
            setPendingStateWithMeta(holder.state, "phaseAcceptance", true);
            phaseAcceptanceScheduled = true;
            appendCapabilityLog(ctx, {
              domain: CAPABILITY_DOMAIN.ACCEPTANCE,
              event: ACCEPTANCE_EVENTS.phaseAcceptanceScheduledByTurnThreshold,
              detail: {
                triggerTurns: PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD,
                summaryPending: holder.state.pending?.summary === true,
                guidancePending: Boolean(holder.state.pending?.guidance),
                planUpdatePending: resolvePendingPlanUpdate(holder.state).active === true,
              },
            });
          }
          if (phaseAcceptanceScheduled) {
            holder.state.counters.phaseAcceptanceTurns = 0;
            if (decisionReason === PLANNING_DECISION.reason.idle) {
              decisionReason = PLANNING_DECISION.reason.phaseAcceptanceThreshold;
            }
          } else {
            // Keep threshold pressure when blocked by higher-priority flows
            // (summary/guidance/plan-update), so phase acceptance can be
            // scheduled immediately after they are cleared.
            holder.state.counters.phaseAcceptanceTurns = PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD;
            blockedActions.push(WORKFLOW_PARAMS.acceptance.decisions.action.phaseAcceptance);
            blockedReasons.push("phase_acceptance_blocked_by_higher_priority_pending");
          }
        }

        pendingSnapshotRaw = {
          summary: holder.state.pending?.summary === true,
          summaryByCharsPrompted: holder.state.flags?.summaryByCharsPrompted === true,
          guidance: holder.state.pending?.guidance || null,
          planUpdate: resolvePendingPlanUpdate(holder.state).active === true,
          phaseAcceptance: holder.state.pending?.phaseAcceptance === true,
          planningCaptured: holder.state.flags?.planningCaptured === true,
        };
        candidateActions = resolvePlanningTriggeredActions({
          summary: pendingSnapshotRaw.summary,
          summaryByCharsPrompted: pendingSnapshotRaw.summaryByCharsPrompted,
          planUpdate: pendingSnapshotRaw.planUpdate,
          phaseAcceptance: pendingSnapshotRaw.phaseAcceptance,
        });
      }

      const planUpdateSnapshot = resolvePendingPlanUpdate(holder?.state || {});
      const normalizedPendingSnapshot = {
        summary: {
          active: pendingSnapshotRaw.summary === true,
          reason: pendingSnapshotRaw.summary === true
            ? (pendingSnapshotRaw.summaryByCharsPrompted === true
              ? PLANNING_DECISION.label.summaryOverflow
              : PLANNING_DECISION.label.summaryTurns)
            : "",
        },
        guidance: {
          active: Boolean(pendingSnapshotRaw.guidance),
          payload: pendingSnapshotRaw.guidance || null,
        },
        planUpdate: {
          active: planUpdateSnapshot.active === true,
          stage: planUpdateSnapshot.stage || "",
          context: {
            summaryText: planUpdateSnapshot.summaryText || "",
            targetMainStepIndexes: Array.isArray(planUpdateSnapshot.targetMainStepIndexes)
              ? planUpdateSnapshot.targetMainStepIndexes
              : [],
          },
        },
        phaseAcceptance: {
          active: pendingSnapshotRaw.phaseAcceptance === true,
          blockedBy: blockedActions.includes(WORKFLOW_PARAMS.acceptance.decisions.action.phaseAcceptance)
            ? ["summary_or_guidance_or_plan_update_or_planning_not_captured"]
            : [],
        },
        acceptanceSemanticValidation: {
          active: false,
        },
        flags: {
          planningCaptured: pendingSnapshotRaw.planningCaptured === true,
          summaryByCharsPrompted: pendingSnapshotRaw.summaryByCharsPrompted === true,
          overflowForceAcceptancePending: holder?.state?.flags?.overflowForceAcceptancePending === true,
        },
      };

      const lifecycle = await runWorkflowLifecycle(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        point: "before_llm_call",
        mode,
        resolveDecision: () => ({
          chosenAction: PLANNING_DECISION.action.planningBootstrap,
          chosenReason: decisionReason,
          chosenReasonLabel: resolvePlanningReasonLabel(holder?.state?.locale || LOCALE.ZH_CN, decisionReason),
          candidateActions,
          deferredActions: candidateActions,
          triggeredActions: candidateActions,
          blockedActions,
          blockedReasons,
          blockedReasonLabels: blockedReasons.map((reason) =>
            resolvePlanningBlockedReasonLabel(holder?.state?.locale || LOCALE.ZH_CN, reason),
          ),
          pending: normalizedPendingSnapshot,
        }),
        execute: async () => {
          let changed = setupChanged;
          let planningPrimaryExecuted = false;
          changed = sanitizeInternalMessages(ctx) || changed;
          changed = disableBlockedToolsInRegistry(ctx) || changed;
          changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
          changed = ensurePlanRefinementTool(ctx, meta) || changed;
          if (shouldUseSeparateModel(meta)) {
            const planningPrimaryChanged = (await runPlanningBySeparateModel(ctx, meta)) || false;
            planningPrimaryExecuted = planningPrimaryChanged === true;
            changed = planningPrimaryChanged || changed;
          } else {
            const planningPrimaryChanged = maybeInjectPlanningPrompt(ctx, meta) || false;
            planningPrimaryExecuted = planningPrimaryChanged === true;
            changed = planningPrimaryChanged || changed;
          }
          return {
            requestedAction:
              mode === "separate_model"
                ? PLANNING_DECISION.requestedAction.planningSeparateModel
                : PLANNING_DECISION.requestedAction.planningInject,
            executedPrimary: planningPrimaryExecuted,
            changed,
          };
        },
      });
      return { capability, point, status: "active", changed: lifecycle.execution.changed };
    }
    if (point === "after_llm_call") {
      const mode = resolveWorkflowMode(meta);
      const holder = ensureHarnessBucket(ctx);
      const lifecycle = await runWorkflowLifecycle(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        point: "after_llm_call",
        mode,
        resolveDecision: () => ({
          chosenAction: PLANNING_DECISION.action.planningCapture,
          chosenReason: PLANNING_DECISION.reason.afterLlmCapture,
          chosenReasonLabel: resolvePlanningReasonLabel(
            holder?.state?.locale || LOCALE.ZH_CN,
            PLANNING_DECISION.reason.afterLlmCapture,
          ),
        }),
        execute: async () => {
          const captureChanged = (await maybeCapturePlanningResult(ctx, meta)) || false;
          return {
            requestedAction: PLANNING_DECISION.requestedAction.planningCapture,
            executedPrimary: captureChanged === true,
            changed: captureChanged === true,
          };
        },
      });
      return { capability, point, status: "active", changed: lifecycle.execution.changed };
    }
    if (point === "after_tool_calls") {
      const changed = maybeScheduleSummaryByToolBurst(ctx);
      return { capability, point, status: "active", changed };
    }
    return { capability, point, status: "active", changed: false };
  };
}
