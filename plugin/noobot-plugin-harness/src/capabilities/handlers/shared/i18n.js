/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  DEFAULT_SUBTASK_OWNERS,
  DEFAULT_TASK_OWNER,
  DEFAULT_TASK_TEMPLATE,
  HARNESS_I18N_KEYSET,
  I18N_TEXT,
  LOCALE,
  PROMPT_JSON_FORMAT_EXAMPLES,
} from "../../../i18n.js";
export { HARNESS_I18N_KEYSET };

export function resolveLocale(ctx = {}) {
  const runtime =
    ctx?.agentContext?.execution?.controllers?.runtime &&
    typeof ctx.agentContext.execution.controllers.runtime === "object"
      ? ctx.agentContext.execution.controllers.runtime
      : {};
  const localeCandidates = [
    ctx?.locale,
    runtime?.systemRuntime?.config?.locale,
    runtime?.userConfig?.locale,
    runtime?.globalConfig?.locale,
    runtime?.runConfig?.locale,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const locale = localeCandidates[0] || LOCALE.ZH_CN;
  return String(locale).toLowerCase().startsWith("en") ? LOCALE.EN_US : LOCALE.ZH_CN;
}

export function translateI18nText(locale = LOCALE.ZH_CN, key = "", params = {}) {
  const dict = I18N_TEXT[locale] || I18N_TEXT[LOCALE.ZH_CN];
  const raw = String(dict?.[key] || I18N_TEXT[LOCALE.ZH_CN]?.[key] || "").trim();
  if (!raw) return "";
  return raw.replace(/\{(\w+)\}/g, (_all, token) => String(params?.[token] ?? ""));
}

export function getDefaultTaskOwner(locale = LOCALE.ZH_CN) {
  return DEFAULT_TASK_OWNER[locale] || DEFAULT_TASK_OWNER[LOCALE.ZH_CN];
}

export function getDefaultSubtaskOwners(locale = LOCALE.ZH_CN) {
  const owners = DEFAULT_SUBTASK_OWNERS[locale] || DEFAULT_SUBTASK_OWNERS[LOCALE.ZH_CN];
  return Array.isArray(owners) ? [...owners] : [];
}

export function getTaskTemplate(locale = LOCALE.ZH_CN) {
  return DEFAULT_TASK_TEMPLATE[locale] || DEFAULT_TASK_TEMPLATE[LOCALE.ZH_CN];
}

export function getPromptJsonFormatExample(type = "planning_main") {
  const key = String(type || "").trim();
  return PROMPT_JSON_FORMAT_EXAMPLES[key] || PROMPT_JSON_FORMAT_EXAMPLES.planning_main || "{}";
}
