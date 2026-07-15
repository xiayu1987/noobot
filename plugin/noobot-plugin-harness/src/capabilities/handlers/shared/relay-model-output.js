import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { CAPABILITY_DOMAIN, LOCALE, PROMPT_ENVELOPE } from "./constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "./i18n.js";
import { injectMessageWithPolicy } from "./message/injection-utils.js";
import { containsExecutableScriptText } from "./script-content-risk.js";
const SHARED_EVENTS = WORKFLOW_PARAMS.logging.events.shared;

import {
  appendCapabilityLog,
  attachMetasToLatestInjectedMessage,
  getTransferPayloadFromAttachments,
} from "./attachment-log-utils.js";

export function relaySeparateModelOutputAsUserMessage(
  ctx = {},
  {
    locale = LOCALE.ZH_CN,
    purpose = "",
    pluginFlow = undefined,
    chain = undefined,
    content = "",
    dedupe = false,
    attachments = [],
    transferPayload = null,
  } = {},
) {
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  const text = String(content || "").trim();
  if (!text) return false;
  const prefix = translateI18nText(locale, HARNESS_I18N_KEYSET.RELAY.SEPARATE_MODEL_PREFIX, {
    purpose: String(purpose || "").trim() || "unknown",
  });
  const riskNotice = containsExecutableScriptText(text)
    ? ` ${translateI18nText(locale, HARNESS_I18N_KEYSET.RELAY.SCRIPT_CONTENT_RISK_NOTICE)}`
    : "";
  const normalizedPluginFlow = String(pluginFlow || "").trim() || undefined;
  const normalizedChain = String(chain || "").trim() || undefined;
  const relayAttachments = Array.isArray(attachments) ? attachments : [];
  const resolvedTransferPayload = getTransferPayloadFromAttachments(
    relayAttachments,
    transferPayload,
  );
  if (!messages) return false;
  const injection = injectMessageWithPolicy(ctx, {
    role: "user",
    content: `${prefix}${riskNotice}\n${text}`,
    injectedMessageType: `separate_model_relay:${String(purpose || "unknown").trim() || "unknown"}`,
    purpose: String(purpose || "").trim() || undefined,
    pluginFlow: normalizedPluginFlow,
    chain: normalizedChain,
    ...resolvedTransferPayload,
    injectAt: "append",
    dedupe,
    avoidBreakToolCallContinuity: true,
    persistToCurrentTurn: true,
  });
  if (!injection.injected && injection.deduped === true) {
    if (relayAttachments.length) {
      attachMetasToLatestInjectedMessage(ctx, relayAttachments, resolvedTransferPayload);
    }
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: SHARED_EVENTS.separateModelRelaySkippedDuplicate,
    });
    return false;
  }
  if (!injection.injected && injection.blockedByTurnEnded === true) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: SHARED_EVENTS.separateModelRelaySkippedTurnEnded,
      detail: { purpose: String(purpose || "").trim() || "unknown" },
    });
    return false;
  }
  if (injection.injected && injection.target === "agent_system") {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: SHARED_EVENTS.separateModelRelayInjectedAsSystemContext,
      detail: { purpose: String(purpose || "").trim() || "unknown" },
    });
  }
  return injection.injected === true;
}
