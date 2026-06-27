/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { useLocale } from "../../../client/noobot-chat/src/shared/i18n/useLocale";

const FALLBACK_LOCALE = "zh-CN";

const HARNESS_FRONTEND_MESSAGES = Object.freeze({
  "zh-CN": Object.freeze({
    common: Object.freeze({
      confirm: "确认",
      cancel: "取消",
    }),
    message: Object.freeze({
      toolResultFallback: "tool_result",
      injectedSourceHarness: "harness-plugin",
      unknownShort: "unknown",
      monotonicActionFailed: "操作失败，请稍后重试",
      contentRequired: "内容不能为空",
      monotonicDeleteConfirm: "将删除这条消息及其之后的所有消息，是否继续？",
      monotonicDeleteTitle: "删除单调消息",
      monotonicEditPlaceholder: "编辑这条消息后重新发送",
      monotonicEditTip: "发送会先删除这条消息及其之后的消息，再重新生成。",
      monotonicSendEdited: "发送",
      monotonicEdit: "编辑",
      monotonicDelete: "删除",
    }),
    modelExtension: Object.freeze({
      title: "Harness 插件",
      description: "为 planning / guidance / acceptance 等非主流程步骤单独指定模型。",
      placeholder: "使用主流程/默认模型",
      empty: "暂无可用于对话的启用模型",
      capabilitySuffix: "能力",
      enabled: "启用",
      disabled: "不启用",
      guidanceAnalysisIntensity: "分析强度",
      acceptanceModelDisabled: "启用 Planning Acceptance 后可选择模型",
    }),
  }),
  "en-US": Object.freeze({
    common: Object.freeze({
      confirm: "Confirm",
      cancel: "Cancel",
    }),
    message: Object.freeze({
      toolResultFallback: "tool_result",
      injectedSourceHarness: "harness-plugin",
      unknownShort: "unknown",
      monotonicActionFailed: "Action failed. Please try again later.",
      contentRequired: "Content is required",
      monotonicDeleteConfirm: "Delete this message and all following messages?",
      monotonicDeleteTitle: "Delete monotonic message",
      monotonicEditPlaceholder: "Edit this message and send again",
      monotonicEditTip: "Sending will delete this message and all following messages, then regenerate.",
      monotonicSendEdited: "Send",
      monotonicEdit: "Edit",
      monotonicDelete: "Delete",
    }),
    modelExtension: Object.freeze({
      title: "Harness Plugin",
      description: "Configure separate models for non-main-flow steps such as planning, guidance, and acceptance.",
      placeholder: "Use main/default model",
      empty: "No enabled chat models are available",
      capabilitySuffix: "Capability",
      enabled: "Enabled",
      disabled: "Disabled",
      guidanceAnalysisIntensity: "Analysis intensity",
      acceptanceModelDisabled: "Enable Planning Acceptance to select a model",
    }),
  }),
});

function resolvePath(source = {}, key = "") {
  return String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), source);
}

function applyParams(text = "", params = {}) {
  let output = String(text || "");
  for (const [key, value] of Object.entries(params || {})) {
    output = output.replaceAll(`{${key}}`, String(value ?? ""));
  }
  return output;
}


export function translateHarnessFallback(key = "", params = {}) {
  const fallbackTable = HARNESS_FRONTEND_MESSAGES[FALLBACK_LOCALE] || {};
  const raw = resolvePath(fallbackTable, key);
  if (raw === undefined || raw === null) return String(key || "");
  return applyParams(raw, params);
}

export function useHarnessLocale() {
  const { locale, translate: translateGlobal } = useLocale();

  function translate(key = "", params = {}) {
    const localTable = HARNESS_FRONTEND_MESSAGES[locale.value] || HARNESS_FRONTEND_MESSAGES[FALLBACK_LOCALE] || {};
    const fallbackTable = HARNESS_FRONTEND_MESSAGES[FALLBACK_LOCALE] || {};
    const localHit = resolvePath(localTable, key);
    const fallbackHit = resolvePath(fallbackTable, key);
    const raw = localHit ?? fallbackHit;
    if (raw === undefined || raw === null) return translateGlobal(key, params);
    return applyParams(raw, params);
  }

  return {
    locale,
    translate,
  };
}
