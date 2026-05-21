/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  GUIDANCE_REASON,
  GUIDANCE_WEB_SERVICE_NAME,
  GUIDANCE_WEB_TOOL_NAMES,
  LOCALE,
  TOOL_NAME_SET,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  ensureHarnessBucket,
  extractJsonObjectFromText,
  extractRawTextContent,
  getDefaultTaskOwner,
  parseRefinementChecklistFromModelOutput,
  markMessagesSummarized,
  parseTaskChecklistFromModelOutput,
  relaySeparateModelOutputAsUserMessage,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelName,
  resolveCapabilityModelMessages,
  resolveCapabilityToolAllowlist,
  resolveInjectedMessageSummarizer,
  shouldUseSeparateModel,
  translateI18nText,
} from "./shared.js";
import {
  extractPlanMetadataFromText,
  isPlanPayloadComplete,
  isSummaryCompletionMarked,
} from "./model-response-parser.js";
import {
  captureInjectedResult,
  injectScheduledPrompt,
  scheduleInjectTask,
} from "./inject-fallback.js";
import { setCaptureFlagStateWithMeta, setPendingStateWithMeta } from "../pending-cleanup.js";
import {
  FAILURE_THRESHOLD,
  MAX_PLAN_REVISION_ATTEMPTS,
} from "../../core/thresholds.js";

function markGuidanceSummarizedMessages(ctx = {}, meta = {}) {
  const historyMessages = ctx?.agentContext?.payload?.messages?.history;
  const currentMessages = ctx?.messages;
  const injectedSummarizer = resolveInjectedMessageSummarizer(meta);
  const safeMark = (messages = []) => {
    if (!Array.isArray(messages)) return 0;
    if (typeof injectedSummarizer === "function") {
      try {
        const result = injectedSummarizer({
          messages,
          taskSummaryToolName: "task_summary",
        });
        const normalized = Number(result);
        if (Number.isFinite(normalized)) return normalized;
      } catch {
        // fallback to local implementation
      }
    }
    return markMessagesSummarized(messages);
  };
  const currentMarked = safeMark(currentMessages);
  const historyMarked = safeMark(historyMessages);
  return currentMarked + historyMarked;
}

function markToolSignals(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const toolName = String(ctx?.toolName || ctx?.call?.name || "").trim();
  if (!toolName) return false;
  let changed = false;
  if (ctx?.success === true) {
    state.signals.successfulToolCount += 1;
    if (
      [
        TOOL_NAME_SET.MEDIA_TO_DATA,
        TOOL_NAME_SET.DOC_TO_DATA,
        TOOL_NAME_SET.WEB_TO_DATA,
        TOOL_NAME_SET.PROCESS_CONTENT_TASK,
      ].includes(toolName)
    ) {
      state.signals.parsedAttachment = true;
      changed = true;
    }
    if ([TOOL_NAME_SET.DELEGATE_TASK_ASYNC, TOOL_NAME_SET.PLAN_MULTI_TASK_COLLABORATION].includes(toolName)) {
      state.signals.subtaskStarted = true;
      changed = true;
    }
    if (toolName === TOOL_NAME_SET.WAIT_ASYNC_TASK_RESULT) {
      state.signals.subtaskWaited = true;
      changed = true;
    }
  }
  if (ctx?.commitType === "attachment_metas" && Array.isArray(ctx?.payload?.attachmentMetas) && ctx.payload.attachmentMetas.length) {
    state.signals.parsedAttachment = true;
    changed = true;
  }
  return changed;
}

function updateFailureCounters(ctx = {}, failed = false) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  if (failed) {
    state.counters.consecutiveToolFailures += 1;
    state.counters.totalToolFailures += 1;
    if (state.counters.consecutiveToolFailures >= FAILURE_THRESHOLD.CONSECUTIVE) {
      setPendingStateWithMeta(state, "guidance", GUIDANCE_REASON.CONSECUTIVE_FAILURES);
    } else if (state.counters.totalToolFailures >= FAILURE_THRESHOLD.ACCUMULATED) {
      setPendingStateWithMeta(state, "guidance", GUIDANCE_REASON.ACCUMULATED_FAILURES);
    }
    return true;
  }
  state.counters.consecutiveToolFailures = 0;
  return true;
}

function ensurePlanRefinementState(state = {}) {
  if (!state || typeof state !== "object") return { byMainStep: {} };
  if (!state.planRefinementState || typeof state.planRefinementState !== "object") {
    state.planRefinementState = { byMainStep: {} };
  }
  if (!state.planRefinementState.byMainStep || typeof state.planRefinementState.byMainStep !== "object") {
    state.planRefinementState.byMainStep = {};
  }
  return state.planRefinementState;
}

function isMainChecklistStep(item = {}) {
  const index = Number(item?.index);
  const mainStepIndex = Number(item?.mainStepIndex);
  if (!Number.isFinite(index)) return false;
  if (item?.isMainStep === true) return true;
  if (!Number.isFinite(mainStepIndex)) return true;
  return mainStepIndex === index;
}

function buildMainStepSnapshotMap(checklist = []) {
  const map = new Map();
  for (const item of Array.isArray(checklist) ? checklist : []) {
    const index = Number(item?.index);
    if (!Number.isFinite(index) || !isMainChecklistStep(item)) continue;
    const normalized = {
      index,
      task: String(item?.task || "").trim(),
      input: String(item?.input || "").trim(),
      output: String(item?.output || "").trim(),
      files: item?.files && typeof item.files === "object" ? item.files : { create: [], modify: [], delete: [] },
    };
    map.set(index, JSON.stringify(normalized));
  }
  return map;
}

function resetRefinementStateByRevision(state = {}, previousChecklist = [], nextChecklist = []) {
  const refinementState = ensurePlanRefinementState(state);
  const previousMap = buildMainStepSnapshotMap(previousChecklist);
  const nextMap = buildMainStepSnapshotMap(nextChecklist);
  for (const [index, currentSnapshot] of nextMap.entries()) {
    const previousSnapshot = previousMap.get(index);
    if (!previousSnapshot || previousSnapshot !== currentSnapshot) {
      refinementState.byMainStep[String(index)] = false;
    }
  }
  for (const index of previousMap.keys()) {
    if (!nextMap.has(index)) {
      delete refinementState.byMainStep[String(index)];
    }
  }
}

function markRefinementConsumed(state = {}, mainStepIndexes = []) {
  const refinementState = ensurePlanRefinementState(state);
  for (const index of Array.isArray(mainStepIndexes) ? mainStepIndexes : []) {
    const normalized = Number(index);
    if (!Number.isFinite(normalized)) continue;
    refinementState.byMainStep[String(normalized)] = true;
  }
}

function resolveRefinementTargetMainSteps(bucket = {}, state = {}) {
  const checklist = Array.isArray(bucket?.taskChecklist) ? bucket.taskChecklist : [];
  const mainSteps = checklist
    .filter((item = {}) => isMainChecklistStep(item))
    .map((item = {}) => ({
      index: Number(item.index),
      task: String(item.task || "").trim(),
    }))
    .filter((item) => Number.isFinite(item.index));
  const refinementState = ensurePlanRefinementState(state);
  const unrefined = mainSteps.filter((step) => refinementState.byMainStep[String(step.index)] !== true);
  if (!unrefined.length) return [];
  const nextIndexes = Array.isArray(bucket?.nextPhase?.checklistIndexes)
    ? bucket.nextPhase.checklistIndexes.map((item) => Number(item)).filter((item) => Number.isFinite(item))
    : [];
  const preferred = nextIndexes.length
    ? unrefined.filter((item) => nextIndexes.includes(item.index))
    : [];
  return (preferred.length ? preferred : unrefined).slice(0, 1);
}

function normalizeRefinementChecklist(checklist = [], targetMainStepIndexes = []) {
  const targetSet = new Set(
    (Array.isArray(targetMainStepIndexes) ? targetMainStepIndexes : [])
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item)),
  );
  if (!targetSet.size) return [];
  const normalized = [];
  for (const [index, item] of (Array.isArray(checklist) ? checklist : []).entries()) {
    const source = item && typeof item === "object" ? item : {};
    const mainStepIndex = Number(source.mainStepIndex);
    if (!Number.isFinite(mainStepIndex) || !targetSet.has(mainStepIndex) || source.isMainStep === true) {
      continue;
    }
    normalized.push({
      ...source,
      index: Number(source.index) || index + 1,
      mainStepIndex,
      isMainStep: false,
    });
  }
  return normalized;
}

function applyRevisedPlanFromText(
  ctx = {},
  text = "",
  { summary = "", source = "planning_revision", stage = "revision", targetMainStepIndexes = [] } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  const previousChecklist = Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist : [];
  const normalizedStage =
    String(stage || source || "revision").toLowerCase().includes("refinement") ? "refinement" : "revision";
  const checklist =
    normalizedStage === "refinement"
      ? parseRefinementChecklistFromModelOutput(text, locale)
      : parseTaskChecklistFromModelOutput(text, locale);
  if (!checklist.length) return false;
  if (!isPlanPayloadComplete(text, checklist)) return false;
  if (normalizedStage === "refinement") {
    const payloadObject = extractJsonObjectFromText(text);
    const payloadStage = String(payloadObject?.stage || "").trim().toLowerCase();
    if (payloadStage !== "refinement") {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        event: "planning_refinement_rejected_invalid_stage",
        detail: { stage: payloadStage || "missing" },
      });
      return false;
    }
    if (Array.isArray(payloadObject?.taskChecklist)) {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.PLANNING,
        event: "planning_refinement_rejected_forbidden_task_checklist",
      });
      return false;
    }
  }
  const normalizedChecklistForRevision =
    normalizedStage === "revision"
      ? checklist.map((item = {}, index) => ({
          ...item,
          index: Number(item?.index) || index + 1,
          mainStepIndex: Number(item?.index) || index + 1,
          isMainStep: true,
        }))
      : [];
  const normalizedChecklistForRefinement =
    normalizedStage === "refinement"
      ? normalizeRefinementChecklist(checklist, targetMainStepIndexes)
      : [];
  if (normalizedStage === "refinement" && !normalizedChecklistForRefinement.length) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_rejected_invalid_target_main_step",
      detail: { targetMainStepIndexes: Array.isArray(targetMainStepIndexes) ? targetMainStepIndexes : [] },
    });
    return false;
  }
  const previousMainPlanVersion = Number.isFinite(Number(bucket.mainPlanVersion))
    ? Number(bucket.mainPlanVersion)
    : 0;
  const mainPlanVersion =
    normalizedStage === "revision"
      ? previousMainPlanVersion + 1 || 1
      : previousMainPlanVersion || 1;
  const payload = extractPlanMetadataFromText(text);
  if (normalizedStage === "revision") {
    bucket.taskChecklist = normalizedChecklistForRevision;
    bucket.taskChecklistSource = source;
  }
  bucket.mainPlanVersion = mainPlanVersion;
  bucket.currentMainPlanVersion = mainPlanVersion;
  if (normalizedStage === "revision") {
    bucket.totalGoal = String(payload.totalGoal ?? bucket.totalGoal ?? "").trim();
    bucket.taskOwner =
      String(payload.taskOwner ?? bucket.taskOwner ?? getDefaultTaskOwner(locale)).trim() ||
      getDefaultTaskOwner(locale);
    const nextPhase = payload.nextPhase && typeof payload.nextPhase === "object" ? payload.nextPhase : {};
    if (nextPhase.objective || nextPhase.content || nextPhase.checklistIndexes.length) {
      bucket.nextPhase = nextPhase;
    }
  }
  bucket.planRefinementIncrementPlan = {
    source,
    stage: normalizedStage,
    mainPlanVersion,
    refinedAt: new Date().toISOString(),
    summary: String(summary || "").trim() || undefined,
    totalGoal: bucket.totalGoal || "",
    taskOwner: bucket.taskOwner || getDefaultTaskOwner(locale),
    nextPhase: bucket.nextPhase || null,
    taskChecklist:
      normalizedStage === "revision"
        ? Array.isArray(bucket.taskChecklist)
          ? bucket.taskChecklist
          : []
        : normalizedChecklistForRefinement,
    incrementalSource: "planning_checklist",
    targetMainStepIndexes: Array.isArray(targetMainStepIndexes) ? targetMainStepIndexes : [],
  };
  if (normalizedStage === "revision") {
    resetRefinementStateByRevision(state, previousChecklist, bucket.taskChecklist);
  } else {
    markRefinementConsumed(state, targetMainStepIndexes);
    if (!Array.isArray(bucket.planRefinementRecords)) bucket.planRefinementRecords = [];
    bucket.planRefinementRecords.push({
      source,
      stage: "refinement",
      mainPlanVersion,
      refinedAt: new Date().toISOString(),
      targetMainStepIndexes: Array.isArray(targetMainStepIndexes) ? targetMainStepIndexes : [],
      taskChecklist: normalizedChecklistForRefinement,
    });
    if (bucket.planRefinementRecords.length > 30) {
      bucket.planRefinementRecords.splice(0, bucket.planRefinementRecords.length - 30);
    }
  }
  if (!Array.isArray(bucket.planRevisions)) bucket.planRevisions = [];
  bucket.planRevisions.push({
    source,
    stage: normalizedStage,
    mainPlanVersion,
    revisedAt: new Date().toISOString(),
    summary: String(summary || "").trim() || undefined,
    totalGoal: bucket.totalGoal || "",
    nextPhase: bucket.nextPhase || null,
    taskChecklist:
      normalizedStage === "revision"
        ? Array.isArray(bucket.taskChecklist)
          ? [...bucket.taskChecklist]
          : []
        : normalizedChecklistForRefinement,
    checklistCount:
      normalizedStage === "revision"
        ? Array.isArray(bucket.taskChecklist)
          ? bucket.taskChecklist.length
          : 0
        : normalizedChecklistForRefinement.length,
  });
  if (bucket.planRevisions.length > 20) bucket.planRevisions.splice(0, bucket.planRevisions.length - 20);
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event:
      normalizedStage === "revision"
        ? "planning_checklist_revised_after_summary"
        : "planning_checklist_refined_after_revision",
    detail: {
      checklistCount:
        normalizedStage === "revision"
          ? Array.isArray(bucket.taskChecklist)
            ? bucket.taskChecklist.length
            : 0
          : normalizedChecklistForRefinement.length,
      hasNextPhase: Boolean(bucket.nextPhase),
      targetMainStepIndexes: Array.isArray(targetMainStepIndexes) ? targetMainStepIndexes : [],
    },
  });
  return true;
}

function buildPlanningRefinementPrompt(locale = LOCALE.ZH_CN, bucket = {}, state = {}, summaryText = "") {
  const targetMainSteps = resolveRefinementTargetMainSteps(bucket, state);
  const planJsonExample =
    '{"stage":"refinement","totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"refinementChecklist":[{"index":101,"mainStepIndex":1,"isMainStep":false,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}';
  return [
    translateI18nText(locale, "planningRefinementMarker"),
    translateI18nText(locale, "planningRefinementPromptBody", {
      example: planJsonExample,
    }),
    JSON.stringify({
      currentSummary: String(summaryText || "").trim(),
      currentPlan: {
        totalGoal: bucket.totalGoal || "",
        taskOwner: bucket.taskOwner || getDefaultTaskOwner(locale),
        taskChecklist: bucket.taskChecklist || [],
        nextPhase: bucket.nextPhase || null,
      },
      harnessState: {
        signals: state.signals || {},
        counters: state.counters || {},
      },
      targetMainSteps,
      refinementRules: {
        oneRefinementPerMainStep: true,
        returnItemsMustBelongToTargetMainSteps: true,
      },
    }, null, 2),
  ].join("\n");
}

function buildPlanningRevisionPrompt(locale = LOCALE.ZH_CN, bucket = {}, state = {}, summaryText = "") {
  const planJsonExample =
    '{"totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}';
  return [
    translateI18nText(locale, "planningRevisionMarker"),
    translateI18nText(locale, "planningRevisionPromptBody", {
      example: planJsonExample,
    }),
    JSON.stringify({
      currentSummary: String(summaryText || "").trim(),
      currentPlan: {
        totalGoal: bucket.totalGoal || "",
        taskOwner: bucket.taskOwner || getDefaultTaskOwner(locale),
        taskChecklist: bucket.taskChecklist || [],
        nextPhase: bucket.nextPhase || null,
      },
      harnessState: {
        signals: state.signals || {},
        counters: state.counters || {},
      },
    }, null, 2),
  ].join("\n");
}

function buildNextPhaseRelayContent(bucket = {}, locale = LOCALE.ZH_CN, stage = "revision") {
  const nextPhase = bucket?.nextPhase && typeof bucket.nextPhase === "object" ? bucket.nextPhase : null;
  const normalizedStage = String(stage || "revision").trim().toLowerCase() === "refinement" ? "refinement" : "revision";
  const refinementPlan =
    bucket?.planRefinementIncrementPlan &&
    typeof bucket.planRefinementIncrementPlan === "object" &&
    bucket.planRefinementIncrementPlan.stage === "refinement"
      ? bucket.planRefinementIncrementPlan
      : null;
  const selected =
    normalizedStage === "refinement"
      ? Array.isArray(refinementPlan?.taskChecklist)
        ? refinementPlan.taskChecklist
        : []
      : nextPhase?.checklistIndexes?.length
        ? (bucket.taskChecklist || []).filter((item) => nextPhase.checklistIndexes.includes(Number(item.index)))
        : [];
  const payload = {
    totalGoal: bucket.totalGoal || "",
    nextPhase: nextPhase || {},
    taskChecklist:
      selected.length
        ? selected
        : normalizedStage === "refinement"
          ? []
          : bucket.taskChecklist || [],
  };
  const title =
    normalizedStage === "refinement"
      ? locale === LOCALE.EN_US
        ? "Refined next phase substeps:"
        : "细化后的下一阶段子步骤："
      : locale === LOCALE.EN_US
        ? "Next phase plan checklist:"
        : "下一阶段计划清单：";
  return `${title}
${JSON.stringify(payload, null, 2)}`;
}

function canAttemptPlanRevision(ctx = {}, state = {}, { increment = false } = {}) {
  if (!state || typeof state !== "object") return false;
  if (!state.counters || typeof state.counters !== "object") state.counters = {};
  const current = Number.isFinite(Number(state.counters.planRevisionAttempts))
    ? Number(state.counters.planRevisionAttempts)
    : 0;
  if (current >= MAX_PLAN_REVISION_ATTEMPTS) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_revision_skipped_by_max_attempts",
      detail: { current, limit: MAX_PLAN_REVISION_ATTEMPTS },
    });
    return false;
  }
  if (increment) state.counters.planRevisionAttempts = current + 1;
  return true;
}

function schedulePlanRevisionByInject(ctx = {}, summaryText = "", stage = "revision") {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const normalizedStage =
    String(stage || "revision").trim().toLowerCase() === "revision"
      ? "revision"
      : "refinement";
  const targetMainSteps =
    normalizedStage === "refinement" ? resolveRefinementTargetMainSteps(bucket, state) : [];
  if (normalizedStage === "refinement" && !targetMainSteps.length) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_converged_no_target_main_step",
    });
    return false;
  }
  if (normalizedStage === "revision" && !canAttemptPlanRevision(ctx, state, { increment: false })) {
    return false;
  }
  return scheduleInjectTask(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    scheduledEvent:
      normalizedStage === "revision"
        ? "planning_revision_scheduled_by_inject"
        : "planning_refinement_scheduled_by_inject",
    setPendingData: ({ state }) => {
      setPendingStateWithMeta(state, "planRevision", true);
      state.pending.planRevisionStage = normalizedStage;
      state.pending.summaryText = String(summaryText || "").trim();
      state.pending.planRevisionTargetMainStepIndexes =
        normalizedStage === "refinement" ? targetMainSteps.map((item) => item.index) : [];
      return true;
    },
    buildScheduledDetail: ({ bucket, state }) => ({
      stage: normalizedStage,
      hasSummaryText: Boolean(state.pending.summaryText),
      checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
    }),
  });
}

function maybeInjectPlanRevisionPrompt(ctx = {}) {
  return injectScheduledPrompt(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    injectedEvent: "planning_plan_update_prompt_injected",
    getPendingData: ({ state }) =>
      state.pending.planRevision === true
        ? {
            summaryText: String(state.pending.summaryText || "").trim(),
            stage:
              String(state.pending.planRevisionStage || "refinement").trim().toLowerCase() === "revision"
                ? "revision"
                : "refinement",
            targetMainStepIndexes: Array.isArray(state.pending.planRevisionTargetMainStepIndexes)
              ? state.pending.planRevisionTargetMainStepIndexes
              : [],
          }
        : null,
    consumePendingData: ({ state }) => {
      setPendingStateWithMeta(state, "planRevision", false);
      delete state.pending.planRevisionStage;
      delete state.pending.planRevisionTargetMainStepIndexes;
    },
    markCapturePending: ({ state, pendingData }) => {
      setCaptureFlagStateWithMeta(state, "planRevisionCapturePending", true);
      state.flags.planRevisionCaptureStage =
        String(pendingData?.stage || "refinement").trim().toLowerCase() === "revision"
          ? "revision"
          : "refinement";
      state.flags.planRevisionCaptureSummaryText = String(pendingData?.summaryText || "").trim();
      state.flags.planRevisionCaptureTargetMainStepIndexes = Array.isArray(pendingData?.targetMainStepIndexes)
        ? pendingData.targetMainStepIndexes
        : [];
    },
    buildPromptContent: ({ locale, bucket, state, pendingData }) =>
      pendingData.stage === "revision"
        ? buildPlanningRevisionPrompt(locale, bucket, state, pendingData.summaryText || "")
        : buildPlanningRefinementPrompt(locale, bucket, state, pendingData.summaryText || ""),
    messageRole: "user",
    injectAt: "append",
  });
}

function buildGuidancePromptContent(locale = LOCALE.ZH_CN, reason = "", { includeMarker = false } = {}) {
  const lines = [
    translateI18nText(locale, "guidanceBody", { reason }),
    translateI18nText(locale, "guidancePreferTools", { tools: GUIDANCE_WEB_TOOL_NAMES.join(", ") }),
    translateI18nText(locale, "guidanceWebService", {
      service: GUIDANCE_WEB_SERVICE_NAME,
      tool: TOOL_NAME_SET.CALL_SERVICE,
    }),
  ];
  if (includeMarker) {
    lines.unshift(translateI18nText(locale, "guidanceMarker"));
  }
  return lines.join("\n");
}

async function maybeCapturePlanRevisionByInject(ctx = {}) {
  return captureInjectedResult(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    completedEvent: "planning_plan_update_capture_completed_inject",
    failedEvent: "planning_plan_update_capture_failed_inject",
    isCapturePending: ({ state }) => state.flags.planRevisionCapturePending === true,
    consumeCaptureMeta: ({ state }) => {
      const stage =
        String(state.flags.planRevisionCaptureStage || "refinement").trim().toLowerCase() === "revision"
          ? "revision"
          : "refinement";
      const summaryText = String(state.flags.planRevisionCaptureSummaryText || "").trim();
      const targetMainStepIndexes = Array.isArray(state.flags.planRevisionCaptureTargetMainStepIndexes)
        ? state.flags.planRevisionCaptureTargetMainStepIndexes
        : [];
      setCaptureFlagStateWithMeta(state, "planRevisionCapturePending", false);
      delete state.flags.planRevisionCaptureStage;
      delete state.flags.planRevisionCaptureSummaryText;
      delete state.flags.planRevisionCaptureTargetMainStepIndexes;
      return { stage, summaryText, targetMainStepIndexes };
    },
    applyCaptureResult: ({ responseText, ctx: currentCtx, state, bucket, captureMeta }) => {
      const stage = captureMeta?.stage === "revision" ? "revision" : "refinement";
      if (stage === "revision" && !canAttemptPlanRevision(currentCtx, state, { increment: true })) {
        return { applied: false, detail: { stage, reason: "max_revision_attempts" } };
      }
      const applied = applyRevisedPlanFromText(currentCtx, responseText, {
        source: stage === "revision" ? "planning_revision_inject" : "planning_refinement_inject",
        summary: captureMeta?.summaryText || "",
        stage,
        targetMainStepIndexes: Array.isArray(captureMeta?.targetMainStepIndexes)
        ? captureMeta.targetMainStepIndexes
        : [],
      });
      const locale = state?.locale || LOCALE.ZH_CN;
      if (applied) {
        relaySeparateModelOutputAsUserMessage(currentCtx, {
          locale,
          purpose: stage === "revision" ? "next_phase_plan" : "next_phase_plan_refinement",
          content: buildNextPhaseRelayContent(bucket, locale, stage),
          dedupe: true,
        });
      }
      if (stage === "revision") {
        const scheduled = schedulePlanRevisionByInject(currentCtx, captureMeta?.summaryText || "", "refinement");
        return {
          applied: applied || scheduled,
          detail: {
            stage,
            revisionApplied: applied === true,
            refinementScheduled: scheduled === true,
            checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
          },
        };
      }
      return {
        applied,
        detail: {
          stage,
          checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
        },
      };
    },
  });
}

async function revisePlanAfterSummary(ctx = {}, meta = {}, summaryText = "", { baseMessages = null } = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) {
    return schedulePlanRevisionByInject(ctx, summaryText, "revision");
  }
  const locale = state?.locale || LOCALE.ZH_CN;
  const fallbackMessages = resolveCapabilityModelMessages(meta, {
    ctx,
    purpose: "summary",
    messages: Array.isArray(ctx?.messages) ? ctx.messages : [],
  });
  const modelMessages = [
    ...(Array.isArray(baseMessages) ? baseMessages : fallbackMessages),
  ];
  let changed = false;

  if (!canAttemptPlanRevision(ctx, state, { increment: true })) {
    return changed;
  }
  const revisionMessagesFinal = [...modelMessages];
  revisionMessagesFinal.push({
    role: "user",
    content: buildPlanningRevisionPrompt(locale, bucket, state, summaryText),
  });
  let revisionResponse = null;
  try {
    revisionResponse = await invoker({
      purpose: "planning_revision",
      domain: CAPABILITY_DOMAIN.PLANNING,
      model: resolveCapabilityModelName(meta, {
        purpose: "planning_revision",
        domain: CAPABILITY_DOMAIN.PLANNING,
      }),
      locale,
      prompt: "",
      messages: revisionMessagesFinal,
      ctx,
      toolAllowlist: resolveCapabilityToolAllowlist(meta, "planning_revision"),
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_revision_model_failed",
      detail: { error: String(error?.message || error || "") },
    });
    return changed;
  }
  await appendCapabilityModelTraceLog(ctx, meta, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    purpose: "planning_revision",
    response: revisionResponse,
  });
  const revisionText =
    extractRawTextContent(revisionResponse?.content) ||
    String(revisionResponse?.text || revisionResponse?.output || "").trim();
  const revisionApplied = applyRevisedPlanFromText(ctx, revisionText, {
    summary: summaryText,
    source: "planning_revision",
    stage: "revision",
  });
  if (!revisionApplied) return changed;
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "next_phase_plan",
    content: buildNextPhaseRelayContent(bucket, locale, "revision"),
    dedupe: true,
  });
  changed = true;

  const refinementTargetMainSteps = resolveRefinementTargetMainSteps(bucket, state);
  if (!refinementTargetMainSteps.length) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_converged_no_target_main_step",
    });
    return changed;
  }
  const refinementMessages = [...modelMessages];
  refinementMessages.push({
    role: "user",
    content: buildPlanningRefinementPrompt(locale, bucket, state, summaryText),
  });
  let refinementResponse = null;
  try {
    refinementResponse = await invoker({
      purpose: "planning_refinement",
      domain: CAPABILITY_DOMAIN.PLANNING,
      model: resolveCapabilityModelName(meta, {
        purpose: "planning_refinement",
        domain: CAPABILITY_DOMAIN.PLANNING,
      }),
      locale,
      prompt: "",
      messages: refinementMessages,
      ctx,
      toolAllowlist: resolveCapabilityToolAllowlist(meta, "planning_refinement"),
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_refinement_model_failed",
      detail: { error: String(error?.message || error || "") },
    });
    return changed;
  }
  await appendCapabilityModelTraceLog(ctx, meta, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    purpose: "planning_refinement",
    response: refinementResponse,
  });
  const refinementText =
    extractRawTextContent(refinementResponse?.content) ||
    String(refinementResponse?.text || refinementResponse?.output || "").trim();
  const refinementApplied = applyRevisedPlanFromText(ctx, refinementText, {
    summary: summaryText,
    source: "planning_refinement",
    stage: "refinement",
    targetMainStepIndexes: refinementTargetMainSteps.map((item) => item.index),
  });
  if (refinementApplied) {
    relaySeparateModelOutputAsUserMessage(ctx, {
      locale,
      purpose: "next_phase_plan_refinement",
      content: buildNextPhaseRelayContent(bucket, locale, "refinement"),
      dedupe: true,
    });
    changed = true;
  }
  return changed;
}

function maybeInjectGuidanceOrSummaryPrompt(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;

  if (state.pending.summary === true) {
    messages.unshift({
      role: "system",
      content: [
        translateI18nText(locale, "guidanceSummaryMarker"),
        translateI18nText(locale, "guidanceSummaryBody"),
      ].join("\n"),
    });
    setPendingStateWithMeta(state, "summary", false);
    state.counters.llmTurns = 0;
    state.flags.guidanceSummaryMarkPending = true;
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: "summary_prompt_injected",
    });
    return true;
  }

  if (!state.pending.guidance) return false;
  const reason = state.pending.guidance;
  messages.unshift({
    role: "system",
    content: buildGuidancePromptContent(locale, reason, { includeMarker: true }),
  });
  setPendingStateWithMeta(state, "guidance", null);
  state.counters.consecutiveToolFailures = 0;
  state.counters.totalToolFailures = 0;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event: "guidance_prompt_injected",
    detail: { reason },
  });
  return true;
}

async function runGuidanceBySeparateModel(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) return false;
  const locale = state?.locale || LOCALE.ZH_CN;

  let purpose = "";
  let prompt = "";
  let reason = "";
  if (state.pending.summary === true) {
    purpose = "summary";
    prompt = translateI18nText(locale, "guidanceSummaryBody");
    setPendingStateWithMeta(state, "summary", false);
    state.counters.llmTurns = 0;
  } else if (state.pending.guidance) {
    purpose = "guidance";
    reason = state.pending.guidance;
    prompt = buildGuidancePromptContent(locale, reason);
    setPendingStateWithMeta(state, "guidance", null);
    state.counters.consecutiveToolFailures = 0;
    state.counters.totalToolFailures = 0;
  } else {
    return false;
  }

  const modelMessages = resolveCapabilityModelMessages(meta, {
    ctx,
    purpose,
    messages: Array.isArray(ctx?.messages) ? ctx.messages : [],
  });

  let response = null;
  try {
    response = await invoker({
      purpose,
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      model: resolveCapabilityModelName(meta, {
        purpose,
        domain: CAPABILITY_DOMAIN.GUIDANCE,
      }),
      locale,
      prompt,
      messages: modelMessages,
      ctx,
      toolAllowlist: resolveCapabilityToolAllowlist(meta, purpose),
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: "guidance_separate_model_call_failed",
      detail: { purpose, error: String(error?.message || error || "") },
    });
    return false;
  }
  await appendCapabilityModelTraceLog(ctx, meta, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    purpose,
    response,
  });
  const responseText =
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim();
  if (!Array.isArray(bucket.guidanceOutputs)) {
    bucket.guidanceOutputs = [];
  }
  bucket.guidanceOutputs.push({
    purpose,
    reason: reason || undefined,
    content: responseText,
    timestamp: new Date().toISOString(),
  });
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose,
    content: responseText,
  });
  if (purpose === "summary") {
    const markedCount = markGuidanceSummarizedMessages(ctx, meta);
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: "summary_messages_marked",
      detail: { markedCount },
    });
    if (isSummaryCompletionMarked(responseText, locale)) {
      await revisePlanAfterSummary(ctx, meta, responseText, { baseMessages: modelMessages });
    } else {
      appendCapabilityLog(ctx, {
        domain: CAPABILITY_DOMAIN.GUIDANCE,
        event: "summary_completion_marker_missing",
      });
    }
  }
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event:
      purpose === "summary"
        ? "summary_generated_by_separate_model"
        : "guidance_generated_by_separate_model",
    detail: { reason: reason || undefined },
  });
  return true;
}

export function createGuidanceHandler({ shouldProcessPrimaryToolHooks }) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    let changed = false;
    if (point === "before_llm_call") {
      if (shouldUseSeparateModel(meta)) {
        changed = (await runGuidanceBySeparateModel(ctx, meta)) || changed;
      } else {
        changed = maybeInjectPlanRevisionPrompt(ctx) || changed;
        changed = maybeInjectGuidanceOrSummaryPrompt(ctx) || changed;
      }
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
        const markedCount = markGuidanceSummarizedMessages(ctx, meta);
        appendCapabilityLog(ctx, {
          domain: CAPABILITY_DOMAIN.GUIDANCE,
          event: "summary_messages_marked",
          detail: { markedCount },
        });
        const summaryText = extractRawTextContent(ctx?.ai?.content) || extractRawTextContent(ctx?.modelResponse?.content) || "";
        const locale = holder.state?.locale || LOCALE.ZH_CN;
        if (isSummaryCompletionMarked(summaryText, locale)) {
          if (!shouldUseSeparateModel(meta) && !resolveCapabilityModelInvoker(meta)) {
            changed = schedulePlanRevisionByInject(ctx, summaryText) || changed;
          } else {
            changed = (await revisePlanAfterSummary(ctx, meta, summaryText)) || changed;
          }
        } else {
          appendCapabilityLog(ctx, {
            domain: CAPABILITY_DOMAIN.GUIDANCE,
            event: "summary_completion_marker_missing",
          });
        }
        changed = markedCount > 0 || changed;
      }
      changed = (await maybeCapturePlanRevisionByInject(ctx)) || changed;
    }
    return { capability, point, status: "active", changed };
  };
}
