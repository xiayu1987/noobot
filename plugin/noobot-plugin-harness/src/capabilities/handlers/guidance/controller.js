/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  CAPABILITY_DOMAIN,
  HARNESS_I18N_KEYSET,
  LOCALE,
  getTransferPayloadFromAttachmentMetas,
  saveCapabilityOutputAsTransferArtifacts,
  relaySeparateModelOutputAsUserMessage,
  ensureHarnessBucket,
  extractRawTextContent,
  translateI18nText,
} from "./deps.js";
import { isSummaryCompletionMarked } from "../model-response-parser.js";
import {
  parseSummaryOverviewAndDetailFromText,
  resolveSummaryDetailAttachmentText,
} from "../shared/plan/summary-text-protocol.js";
import {
  maybeInjectPlanUpdatePrompt,
  maybeCapturePlanUpdateByInject,
} from "./revision-injector.js";
import { maybeInjectGuidanceOrSummaryPrompt } from "./prompt-injector.js";
import {
  runPendingPlanUpdateBySeparateModel,
  runGuidanceBySeparateModel,
} from "./model-runner.js";
import { resolveGuidancePriorityDecision, resolveNextGuidanceAction } from "../planning/plan-update-scheduler.js";
import { markGuidanceSummarizedMessages, markToolSignals, updateFailureCounters } from "./signal-tracker.js";
import {
  applySummaryText,
  recordLatestSummaryFullText,
  recordSummaryDetailAttachmentMetas,
  shouldSaveSummaryDetailToAttachment,
  transferSummaryInjectionMessage,
} from "./summary-manager.js";
import { appendCapabilityLog } from "../shared/attachment-log-utils.js";
import { resolveAttachmentDisplayPath } from "../shared/sandbox-path.js";
import {
  resolveWorkflowMode,
  runWorkflowLifecycle,
} from "../shared/workflow/pattern.js";
import { enforceWorkflowInvariants } from "../shared/workflow/invariants.js";

const GUIDANCE_EVENTS = WORKFLOW_PARAMS.logging.events.guidance;
const GUIDANCE_DECISION = WORKFLOW_PARAMS.guidance.decisions;

function resolveDetailPath(meta = {}, ctx = {}) {
  return resolveAttachmentDisplayPath(meta, ctx);
}

function buildSummaryDetailPathRelayContent(ctx = {}, locale = LOCALE.ZH_CN, detailAttachmentMetas = []) {
  const metas = Array.isArray(detailAttachmentMetas) ? detailAttachmentMetas : [];
  if (!metas.length) return "";
  const lines = metas.map((item = {}) => resolveDetailPath(item, ctx)).filter(Boolean);
  if (!lines.length) return "";
  const header = translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.SUMMARY_DETAIL_PATHS_HEADER);
  const footer = translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROTOCOLS.SUMMARY_DETAIL_PATHS_FOOTER);
  return [
    header,
    ...lines.map((item) => `DETAIL_PATH: ${item}`),
    footer,
  ].join("\n");
}

function resolveWorkflowActionName(action = "", stage = "", mode = "inject") {
  const normalizedMode = String(mode || "").trim() === "separate_model" ? "separate_model" : "inject";
  if (action === GUIDANCE_DECISION.action.planUpdate) {
    const revisionStage = String(stage || "").trim().toLowerCase() === GUIDANCE_DECISION.stage.revision;
    if (revisionStage) {
      return normalizedMode === "separate_model"
        ? GUIDANCE_DECISION.requestedAction.planUpdateRevisionSeparateModel
        : GUIDANCE_DECISION.requestedAction.planUpdateRevisionInject;
    }
    return normalizedMode === "separate_model"
      ? GUIDANCE_DECISION.requestedAction.planUpdateRefinementSeparateModel
      : GUIDANCE_DECISION.requestedAction.planUpdateRefinementInject;
  }
  if (action === GUIDANCE_DECISION.action.summary) {
    return normalizedMode === "separate_model"
      ? GUIDANCE_DECISION.requestedAction.summarySeparateModel
      : GUIDANCE_DECISION.requestedAction.summaryInject;
  }
  if (action === GUIDANCE_DECISION.action.guidance) {
    return normalizedMode === "separate_model"
      ? GUIDANCE_DECISION.requestedAction.guidanceSeparateModel
      : GUIDANCE_DECISION.requestedAction.guidanceInject;
  }
  return GUIDANCE_DECISION.requestedAction.none;
}

async function executeGuidanceWorkflowAction({
  nextAction = { action: "none", stage: "", reason: "idle" },
  ctx = {},
  meta = {},
} = {}) {
  const mode = resolveWorkflowMode(meta);
  let changed = false;
  let executedPrimary = false;
  let executedFollowup = false;

  if (mode === "separate_model") {
    if (nextAction.action === GUIDANCE_DECISION.action.summary) {
      const result = await runGuidanceBySeparateModel(ctx, meta);
      changed = result || changed;
      executedPrimary = result === true;
    } else if (nextAction.action === GUIDANCE_DECISION.action.guidance) {
      const result = await runGuidanceBySeparateModel(ctx, meta);
      changed = result || changed;
      executedPrimary = result === true;
    } else if (nextAction.action === GUIDANCE_DECISION.action.planUpdate) {
      const firstChanged = await runPendingPlanUpdateBySeparateModel(ctx, meta);
      changed = firstChanged || changed;
      executedPrimary = firstChanged === true;

      const holder = ensureHarnessBucket(ctx);
      const pending = holder?.state?.pending && typeof holder.state.pending === "object"
        ? holder.state.pending
        : {};
      const hasSummaryOrGuidancePending = pending.summary === true || Boolean(pending.guidance);
      if (hasSummaryOrGuidancePending) {
        const followupChanged = await runGuidanceBySeparateModel(ctx, meta);
        changed = followupChanged || changed;
        executedFollowup = followupChanged === true;
      }
    }
  } else if (nextAction.action === "summary" || nextAction.action === "guidance") {
    const result = maybeInjectGuidanceOrSummaryPrompt(ctx);
    changed = result || changed;
    executedPrimary = result === true;
  } else if (nextAction.action === "plan_update") {
    const result = maybeInjectPlanUpdatePrompt(ctx);
    changed = result || changed;
    executedPrimary = result === true;
  }

  return {
    mode,
    changed,
    executedPrimary,
    executedFollowup,
    actionName: resolveWorkflowActionName(nextAction.action, nextAction.stage, mode),
  };
}

export function createGuidanceHandler({ shouldProcessPrimaryToolHooks }) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    let changed = false;
    if (point === "before_llm_call") {
      const invariantChanged = enforceWorkflowInvariants(ctx, { domain: CAPABILITY_DOMAIN.GUIDANCE }) === true;
      const holder = ensureHarnessBucket(ctx);
      const nextAction = resolveNextGuidanceAction(holder?.state || {});
      const decision = resolveGuidancePriorityDecision(holder?.state || {});
      const mode = resolveWorkflowMode(meta);
      const lifecycle = await runWorkflowLifecycle(ctx, {
        domain: CAPABILITY_DOMAIN.GUIDANCE,
        point: "before_llm_call",
        mode,
        resolveDecision: () => ({
          chosenAction: decision.chosenAction,
          chosenReason: decision.chosenReason,
          chosenReasonLabel: decision.chosenReasonLabel,
          chosenStage: decision.chosenStage,
          candidateActions: decision.candidateActions,
          deferredActions: decision.deferredActions,
          blockedActions: decision.blockedActions,
          blockedReasons: decision.blockedReasons,
          blockedReasonLabels: decision.blockedReasonLabels,
          pending: decision.pendingSnapshot,
        }),
        execute: async () => {
          const execution = await executeGuidanceWorkflowAction({
            nextAction,
            ctx,
            meta,
          });
          return {
            requestedAction: execution.actionName,
            executedPrimary: execution.executedPrimary,
            executedFollowup: execution.executedFollowup,
            changed: execution.changed || invariantChanged,
          };
        },
      });
      changed = lifecycle.execution.changed || changed;
    }
    if (point === "after_tool_call" && shouldProcessPrimaryToolHooks(ctx)) {
      changed = markToolSignals(ctx) || changed;
      const failed = ctx?.success === false;
      changed = updateFailureCounters(ctx, failed) || changed;
    }
    if (point === "tool_call_error" && shouldProcessPrimaryToolHooks(ctx)) {
      changed = updateFailureCounters(ctx, true) || changed;
    }
    if (point === "after_llm_call") {
      const holder = ensureHarnessBucket(ctx);
      if (holder?.state?.flags?.guidanceSummaryMarkPending === true) {
        holder.state.flags.guidanceSummaryMarkPending = false;
        const markedCount = await markGuidanceSummarizedMessages(ctx, meta);
        appendCapabilityLog(ctx, {
          domain: CAPABILITY_DOMAIN.GUIDANCE,
          event: GUIDANCE_EVENTS.summaryMessagesMarked,
          detail: { markedCount },
        });
        const rawSummaryText = extractRawTextContent(ctx?.ai?.content) || extractRawTextContent(ctx?.modelResponse?.content) || "";
        const locale = holder.state?.locale || LOCALE.ZH_CN;
        const parsedSummary = parseSummaryOverviewAndDetailFromText(rawSummaryText);
        const summaryOverviewText = String(parsedSummary?.overviewText || "").trim() || rawSummaryText;
        const saveDetailToAttachment = shouldSaveSummaryDetailToAttachment(meta);
        const summaryDetailAttachmentText = resolveSummaryDetailAttachmentText(parsedSummary);
        const detailAttachmentMetas = saveDetailToAttachment && summaryDetailAttachmentText
          ? await saveCapabilityOutputAsTransferArtifacts(ctx, {
            purpose: "summary_detail",
            content: summaryDetailAttachmentText,
            generationSource: "harness_summary_detail",
            domain: CAPABILITY_DOMAIN.GUIDANCE,
          })
          : [];
        recordSummaryDetailAttachmentMetas(ctx, detailAttachmentMetas);
        const detailPathRelay = buildSummaryDetailPathRelayContent(
          ctx,
          locale,
          detailAttachmentMetas,
        );
        if (detailPathRelay) {
          relaySeparateModelOutputAsUserMessage(ctx, {
            locale,
            purpose: "summary_detail_path",
            content: detailPathRelay,
            dedupe: true,
            transferPayload: getTransferPayloadFromAttachmentMetas(detailAttachmentMetas),
          });
        }
        if (!saveDetailToAttachment && rawSummaryText) {
          const summaryInjectionContent = await transferSummaryInjectionMessage(ctx, {
            fullText: rawSummaryText,
            summaryText: summaryOverviewText,
            detailText: summaryDetailAttachmentText,
            injectMode: "full",
            meta,
          });
          relaySeparateModelOutputAsUserMessage(ctx, {
            locale,
            purpose: "summary",
            content: summaryInjectionContent || rawSummaryText,
            dedupe: true,
          });
        }
        recordLatestSummaryFullText(ctx, rawSummaryText);
        const summaryText = applySummaryText(ctx, summaryOverviewText);
        if (!isSummaryCompletionMarked(summaryText, locale)) {
          appendCapabilityLog(ctx, {
            domain: CAPABILITY_DOMAIN.GUIDANCE,
            event: GUIDANCE_EVENTS.summaryCompletionMarkerMissing,
          });
        }
        changed = markedCount > 0 || changed;
      }
      changed = (await maybeCapturePlanUpdateByInject(ctx)) || changed;
    }
    return { capability, point, status: "active", changed };
  };
}
