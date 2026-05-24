/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
  ensureHarnessBucket,
  extractRawTextContent,
  getPromptJsonFormatExample,
  injectMessageWithPolicy,
  resolvePlanningToolAllowlist,
  resolveSceneToolNames,
  translateI18nText,
} from "./deps.js";

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
    translateI18nText(locale, "planningPromptToolsHeader"),
    "```json",
    JSON.stringify(catalog, null, 2),
    "```",
  ].join("\n");
}

function isHarnessRelayMessage(text = "") {
  const raw = String(text || "").trim();
  return raw.startsWith("[来自harness外部模型输出/") || raw.startsWith("[Relay from harness external model/");
}

function resolveLatestUserTextFromMessages(messageList = []) {
  for (let index = messageList.length - 1; index >= 0; index -= 1) {
    const item = messageList[index] || {};
    if (isHarnessInjectedMessage(item)) continue;
    const role = String(item?.role || "").trim().toLowerCase();
    if (role !== "user") continue;
    const text = String(extractRawTextContent(item?.content ?? item) || "").trim();
    if (isHarnessRelayMessage(text)) continue;
    if (text) return text;
  }
  return "";
}

export function buildPlanningToolContextPrompt(locale = LOCALE.ZH_CN, ctx = {}, meta = {}) {
  return [
    translateI18nText(locale, "planningToolContextMarker"),
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

export function buildPlanningPromptBase(locale = LOCALE.ZH_CN, _ctx = {}, _meta = {}) {
  return [
    translateI18nText(locale, "planningPromptMarker"),
    translateI18nText(locale, "planningPromptBody"),
    translateI18nText(locale, "planningPromptFormatExample", {
      example: getPromptJsonFormatExample("planning_main"),
    }),
    translateI18nText(locale, "jsonOnlyOutputRequirement"),
  ].join("\n");
}

export function resolveLatestUserMessageText(ctx = {}) {
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : [];
  const latestFromMessages = resolveLatestUserTextFromMessages(messages);
  if (latestFromMessages) return latestFromMessages;
  const history = Array.isArray(ctx?.agentContext?.payload?.messages?.history)
    ? ctx.agentContext.payload.messages.history
    : [];
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

export function maybeInjectPlanningPrompt(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  if (state.flags.planningPromptInjected === true) return false;
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;
  injectMessageWithPolicy(ctx, {
    role: "system",
    content: buildPlanningToolContextPrompt(locale, ctx, meta),
    injectAt: "append",
    avoidBreakToolCallContinuity: true,
  });
  injectMessageWithPolicy(ctx, {
    role: "user",
    content: buildPlanningPromptBase(locale, ctx, meta),
    injectAt: "append",
    avoidBreakToolCallContinuity: true,
  });
  state.flags.planningPromptInjected = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_prompt_injected",
  });
  return true;
}
