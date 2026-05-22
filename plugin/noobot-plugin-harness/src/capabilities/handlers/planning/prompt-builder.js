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
  getDefaultTaskOwner,
  getTaskTemplate,
  resolvePlanningToolAllowlist,
  resolveSceneToolNames,
  translateI18nText,
} from "./deps.js";

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

export function buildPlanningPromptBase(locale = LOCALE.ZH_CN, ctx = {}, meta = {}) {
  return [
    translateI18nText(locale, "planningPromptMarker"),
    translateI18nText(locale, "planningPromptBody", {
      example: `{"totalGoal":"完成用户请求","taskOwner":"${getDefaultTaskOwner(locale)}","nextPhase":{"objective":"...","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"${getTaskTemplate(locale).PARSE_ATTACHMENT}","owner":"${getDefaultTaskOwner(locale)}","input":"用户请求/上下文/附件","output":"可用于后续步骤的解析结果","files":{"create":[],"modify":[],"delete":[]}}]}`,
    }),
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

export function maybeInjectPlanningPrompt(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  if (state.flags.planningPromptInjected === true) return false;
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;
  messages.push({
    role: "user",
    content: buildPlanningPromptBase(locale, ctx, meta),
  });
  state.flags.planningPromptInjected = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_prompt_injected",
  });
  return true;
}

