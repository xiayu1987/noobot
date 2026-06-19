/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { createMessagePlan, renderMessagePlanForInject } from "../shared/model/message-plan.js";
import {
  CAPABILITY_DOMAIN,
  HARNESS_I18N_KEYSET,
  LOCALE,
  appendCapabilityLog,
  ensureHarnessBucket,
  extractRawTextContent,
  injectMessageWithPolicy,
  resolvePlanningToolAllowlist,
  resolveSceneToolNames,
  translateI18nText,
} from "./deps.js";
import {
  compactOperationDirectoryForPrompt,
  resolveOperationDirectoryContext,
} from "../shared/operation-directory.js";
import {
  buildWorkflowResponsibilityConstraintUserPrompt,
  buildWorkflowStrategyPolicyPromptText,
  buildPlanningMainPrompt,
  resolveWorkflowStrategyFlagsFromContext,
  getPlanningContextSummaryHeader,
  getPlanningPromptMarker,
  getPlanningPromptToolsHeader,
  getPlanningToolContextMarker,
} from "../shared/workflow/prompts.js";
import { buildPlanChecklistSystemContent } from "../shared/plan/checklist-context.js";

const PLANNING_EVENTS = WORKFLOW_PARAMS.logging.events.planning;

function isHarnessInjectedMessage(message = {}) {
  return (
    message?.injectedMessage === true &&
    String(message?.injectedBy || "").trim() === "harness-plugin"
  );
}

function resolvePlanningToolCatalog(ctx = {}, locale = LOCALE.ZH_CN) {
  const registry = Array.isArray(ctx?.agentContext?.payload?.tools?.registry)
    ? ctx.agentContext.payload.tools.registry
    : [];
  const fallbackDescription = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_TOOL_DESCRIPTION_FALLBACK,
  );
  const catalog = [];
  const seenNames = new Set();
  for (const toolItem of registry) {
    const name = String(toolItem?.name || "").trim();
    if (!name || seenNames.has(name)) continue;
    const description = String(toolItem?.description || "")
      .replace(/\s+/g, " ")
      .trim();
    catalog.push({
      name,
      description: description || fallbackDescription,
    });
    seenNames.add(name);
  }
  return catalog;
}

function buildPlanningToolCatalogPrompt(ctx = {}, locale = LOCALE.ZH_CN) {
  const catalog = resolvePlanningToolCatalog(ctx, locale);
  return [
    getPlanningPromptToolsHeader(locale),
    "```json",
    JSON.stringify(catalog, null, 2),
    "```",
  ].join("\n");
}

function isHarnessRelayMessage(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const prefixes = [LOCALE.ZH_CN, LOCALE.EN_US]
    .map((locale) =>
      translateI18nText(locale, HARNESS_I18N_KEYSET.RELAY.SEPARATE_MODEL_PREFIX, { purpose: "" }))
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return prefixes.some((prefix) => raw.startsWith(prefix));
}

function resolveCompatibleRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
  if (role === "human") return "user";
  if (role === "ai") return "assistant";
  if (role) return role;
  const type = String(message?.type || message?.lc_kwargs?.type || "").trim().toLowerCase();
  if (type === "human") return "user";
  if (type === "ai") return "assistant";
  if (type) return type;
  return "";
}

function isFrontendUserMessage(item = {}) {
  return (
    item?.frontendUserMessage === true ||
    item?.lc_kwargs?.frontendUserMessage === true ||
    item?.additional_kwargs?.frontendUserMessage === true ||
    item?.lc_kwargs?.additional_kwargs?.frontendUserMessage === true
  );
}

function resolveLatestUserTextFromMessages(messageList = [], { preferFrontend = false } = {}) {
  for (let index = messageList.length - 1; index >= 0; index -= 1) {
    const item = messageList[index] || {};
    if (isHarnessInjectedMessage(item)) continue;
    const role = resolveCompatibleRole(item);
    if (role !== "user") continue;
    if (preferFrontend && !isFrontendUserMessage(item)) continue;
    const text = String(extractRawTextContent(item?.content ?? item) || "").trim();
    if (isHarnessRelayMessage(text)) continue;
    if (text) return text;
  }
  return "";
}

export function buildPlanningToolContextPrompt(locale = LOCALE.ZH_CN, ctx = {}, meta = {}) {
  return [
    getPlanningToolContextMarker(locale),
    buildPlanningToolCatalogPrompt(ctx, locale),
    "",
    JSON.stringify(
      {
        sceneTools: resolveSceneToolNames(ctx),
        toolAllowlist: resolvePlanningToolAllowlist(meta),
      },
      null,
      2,
    ),
  ].join("\n");
}

export function buildPlanningContextSummaryPrompt(locale = LOCALE.ZH_CN, ctx = {}, meta = {}) {
  const latestUserGoal = resolveLatestUserMessageText(ctx) ||
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_LATEST_USER_GOAL_FALLBACK);
  const contextSummary = {
    locale,
    turn: Number.isFinite(Number(ctx?.turn)) ? Number(ctx.turn) : undefined,
    latestUserGoal: String(latestUserGoal || "").trim(),
    operationDirectory: compactOperationDirectoryForPrompt(resolveOperationDirectoryContext(ctx)),
    sceneTools: resolveSceneToolNames(ctx),
    toolAllowlist: resolvePlanningToolAllowlist(meta),
  };
  return [
    getPlanningContextSummaryHeader(locale),
    "```json",
    JSON.stringify(contextSummary, null, 2),
    "```",
  ].join("\n");
}

export function buildPlanningPromptBase(locale = LOCALE.ZH_CN, _ctx = {}, _meta = {}, options = {}) {
  const userGoal = resolveLatestUserMessageText(_ctx) ||
    translateI18nText(locale, HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.PLANNING_LATEST_USER_GOAL_FALLBACK);
  const {
    programmingMode,
    textMode,
    workflowStrategy,
    executionFirstMode,
  } = resolveWorkflowStrategyFlagsFromContext(_ctx, _meta);
  return buildPlanningMainPrompt({
    locale,
    marker: getPlanningPromptMarker(locale),
    data: { userGoal },
    programmingMode,
    textMode,
    workflowStrategy,
    executionFirstMode,
    includeWorkflowPolicy: options?.includeWorkflowPolicy !== false,
  });
}

export function resolveLatestUserMessageText(ctx = {}) {
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : [];
  const latestFrontendFromMessages = resolveLatestUserTextFromMessages(messages, { preferFrontend: true });
  if (latestFrontendFromMessages) return latestFrontendFromMessages;
  const latestFromMessages = resolveLatestUserTextFromMessages(messages);
  if (latestFromMessages) return latestFromMessages;
  const history = Array.isArray(ctx?.agentContext?.payload?.messages?.history)
    ? ctx.agentContext.payload.messages.history
    : [];
  const latestFrontendFromHistory = resolveLatestUserTextFromMessages(history, { preferFrontend: true });
  if (latestFrontendFromHistory) return latestFrontendFromHistory;
  const latestFromHistory = resolveLatestUserTextFromMessages(history);
  if (latestFromHistory) return latestFromHistory;
  const fallbackCandidates = [
    ctx?.userMessage,
    ctx?.message,
    ctx?.agentContext?.execution?.controllers?.runtime?.systemRuntime?.currentTurnUserMessage,
    ctx?.latestUserGoal,
    ctx?.agentContext?.payload?.latestUserGoal,
    ctx?.agentContext?.payload?.context?.latestUserGoal,
  ];
  for (const candidate of fallbackCandidates) {
    const text = String(candidate || "").trim();
    if (text) return text;
  }
  return "";
}

export function buildPlanningMessagePlan(
  locale = LOCALE.ZH_CN,
  ctx = {},
  meta = {},
  {
    contextSummaryContent = "",
    toolContextContent = "",
    taskContent = "",
    includeWorkflowPolicy = false,
  } = {},
) {
  const bucket = ctx?.agentContext?.payload?.harness && typeof ctx.agentContext.payload.harness === "object"
    ? ctx.agentContext.payload.harness
    : {};
  const planChecklistContent = buildPlanChecklistSystemContent({
    locale,
    planText: bucket?.planText || "",
    bucket,
    ctx,
  });
  const {
    programmingMode,
    textMode,
    workflowStrategy,
    executionFirstMode,
    riskFirstMode,
    dynamicPolicyPrompt,
  } = resolveWorkflowStrategyFlagsFromContext(ctx, meta);
  const workflowPolicyPrompt = buildWorkflowStrategyPolicyPromptText(locale, {
    programmingMode,
    textMode,
    workflowStrategy,
    executionFirstMode,
    riskFirstMode,
    dynamicPolicyPrompt,
  });
  return createMessagePlan([
    {
      kind: "planning_context_summary",
      injectRole: "system",
      separateRole: "constraint",
      content: contextSummaryContent || buildPlanningContextSummaryPrompt(locale, ctx, meta),
    },
    {
      kind: "planning_plan_checklist_context",
      injectRole: "system",
      separateRole: "constraint",
      content: planChecklistContent,
    },
    {
      kind: "planning_tool_context",
      injectRole: "system",
      separateRole: "constraint",
      content: toolContextContent || buildPlanningToolContextPrompt(locale, ctx, meta),
    },
    {
      kind: "planning_task",
      injectRole: "user",
      separateRole: "task",
      content: taskContent || buildPlanningPromptBase(locale, ctx, meta, { includeWorkflowPolicy }),
    },
    {
      kind: "planning_workflow_policy",
      injectRole: "system",
      separateRole: "workflow_policy",
      content: workflowPolicyPrompt,
    },
    {
      kind: "planning_responsibility_constraint",
      injectRole: "user",
      separateRole: "task",
      content: buildWorkflowResponsibilityConstraintUserPrompt(locale, "planning", {
        programmingMode,
        textMode,
        workflowStrategy,
        executionFirstMode,
        riskFirstMode,
        dynamicPolicyPrompt,
        includeWorkflowPolicy,
      }),
    },
  ]);
}

export function maybeInjectPlanningPrompt(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  if (state.flags.planningPromptInjected === true) return false;
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;
  const messagePlan = buildPlanningMessagePlan(locale, ctx, meta);
  const injectMessages = renderMessagePlanForInject(messagePlan);
  for (const messageItem of injectMessages) {
    injectMessageWithPolicy(ctx, {
      role: messageItem.role,
      content: messageItem.content,
      injectedMessageType: messageItem.kind === "planning_workflow_policy"
        ? "workflow_policy"
        : messageItem.kind || "planning_prompt",
      injectAt: "append",
      avoidBreakToolCallContinuity: true,
    });
  }
  state.flags.planningPromptInjected = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: PLANNING_EVENTS.promptInjected,
  });
  return true;
}
