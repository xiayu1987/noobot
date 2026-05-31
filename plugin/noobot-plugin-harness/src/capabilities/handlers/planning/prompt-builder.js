/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { createMessagePlan, renderMessagePlanForInject } from "../shared/model/message-plan.js";
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  ensureHarnessBucket,
  extractRawTextContent,
  injectMessageWithPolicy,
  resolvePlanningToolAllowlist,
  resolveSceneToolNames,
} from "./deps.js";
import {
  buildWorkflowResponsibilityConstraintUserPrompt,
  buildPlanningMainPrompt,
  getPlanningContextSummaryHeader,
  getPlanningPromptMarker,
  getPlanningPromptToolsHeader,
  getPlanningToolContextMarker,
} from "../shared/workflow/prompts.js";

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
  const fallbackDescription = locale === LOCALE.EN_US ? "(no description)" : "（无说明）";
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
  return raw.startsWith("[来自harness外部模型输出/") || raw.startsWith("[Relay from harness external model/");
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
    (locale === LOCALE.EN_US ? "N/A" : "（未获取到用户目标）");
  const contextSummary = {
    locale,
    turn: Number.isFinite(Number(ctx?.turn)) ? Number(ctx.turn) : undefined,
    latestUserGoal: String(latestUserGoal || "").trim(),
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

export function buildPlanningPromptBase(locale = LOCALE.ZH_CN, _ctx = {}, _meta = {}) {
  const userGoal = resolveLatestUserMessageText(_ctx) || (locale === LOCALE.EN_US ? "N/A" : "（未获取到用户目标）");
  return buildPlanningMainPrompt({
    locale,
    marker: getPlanningPromptMarker(locale),
    data: { userGoal },
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
  } = {},
) {
  return createMessagePlan([
    {
      kind: "planning_context_summary",
      injectRole: "system",
      separateRole: "constraint",
      content: contextSummaryContent || buildPlanningContextSummaryPrompt(locale, ctx, meta),
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
      content: taskContent || buildPlanningPromptBase(locale, ctx, meta),
    },
    {
      kind: "planning_responsibility_constraint",
      injectRole: "user",
      separateRole: "task",
      content: buildWorkflowResponsibilityConstraintUserPrompt(locale, "planning"),
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
