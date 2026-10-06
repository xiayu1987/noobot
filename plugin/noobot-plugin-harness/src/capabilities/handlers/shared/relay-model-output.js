/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { resolveModelMessages } from "../../../core/message-store.js";
import { CAPABILITY_DOMAIN, LOCALE } from "./constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "./i18n.js";
import { injectMessageWithPolicy } from "./message/injection-utils.js";
import { containsExecutableScriptText } from "./script-content-risk.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
const SHARED_EVENTS = WORKFLOW_PARAMS.logging.events.shared;

import {
  appendCapabilityLog,
  attachTransferPayloadToLatestInjectedMessage,
  normalizeTransferPayload,
} from "./attachment-log-utils.js";

function optionalText(value) {
  return String(value || "").trim() || undefined;
}

function limitRelayText(locale, rawText) {
  const maxChars = Number(LENGTH_THRESHOLDS.harness.relayInjectionMaxChars || 0);
  if (!(maxChars > 0 && rawText.length > maxChars)) return rawText;
  const notice = translateI18nText(locale, HARNESS_I18N_KEYSET.RELAY.CONTENT_TRUNCATED_NOTICE, {
    originalLength: rawText.length,
    maxChars,
  });
  return `${rawText.slice(0, maxChars)}\n${notice}`;
}

function buildRelayContent(locale, purposeLabel, text) {
  const prefix = translateI18nText(locale, HARNESS_I18N_KEYSET.RELAY.SEPARATE_MODEL_PREFIX, {
    purpose: purposeLabel,
  });
  const capabilityBoundaryNotice = translateI18nText(
    locale,
    HARNESS_I18N_KEYSET.RELAY.CAPABILITY_BOUNDARY_NOTICE,
  );
  const riskNotice = containsExecutableScriptText(text)
    ? ` ${translateI18nText(locale, HARNESS_I18N_KEYSET.RELAY.SCRIPT_CONTENT_RISK_NOTICE)}`
    : "";
  return `${prefix}${riskNotice}\n${capabilityBoundaryNotice}\n${text}`;
}

function buildTurnEndedDetail(ctx, purposeLabel) {
  const harnessState = ctx?.agentContext?.bindings?.extensions?.harness?.state;
  return {
    purpose: purposeLabel,
    dialogProcessId: optionalText(ctx?.dialogProcessId),
    activeDialogProcessId: optionalText(harnessState?.signals?.activeDialogProcessId),
    agentTurnEnded: harnessState?.flags?.agentTurnEnded === true,
  };
}

function logRelayOutcome(ctx, injection, { purposeLabel, transferPayload }) {
  if (!injection.injected && injection.deduped === true) {
    attachTransferPayloadToLatestInjectedMessage(ctx, transferPayload);
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
      detail: buildTurnEndedDetail(ctx, purposeLabel),
    });
    return false;
  }
  if (injection.injected && injection.target === "agent_system") {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: SHARED_EVENTS.separateModelRelayInjectedAsSystemContext,
      detail: { purpose: purposeLabel },
    });
  }
  return injection.injected === true;
}

export function relaySeparateModelOutputAsUserMessage(
  ctx = {},
  {
    locale = LOCALE.ZH_CN,
    purpose = "",
    pluginFlow = undefined,
    chain = undefined,
    relayCorrelationId = "",
    content = "",
    dedupe = false,
    transferPayload = null,
  } = {},
) {
  const messages = resolveModelMessages(ctx);
  const rawText = String(content || "").trim();
  if (!rawText) return false;
  const purposeLabel = optionalText(purpose) || "unknown";
  const relayContent = buildRelayContent(locale, purposeLabel, limitRelayText(locale, rawText));
  const resolvedTransferPayload = normalizeTransferPayload(transferPayload || {});
  if (!messages) return false;
  const injection = injectMessageWithPolicy(ctx, {
    role: "user",
    content: relayContent,
    injectedMessageType: `separate_model_relay:${String(purpose || "unknown").trim() || "unknown"}`,
    purpose: optionalText(purpose),
    pluginFlow: optionalText(pluginFlow),
    chain: optionalText(chain),
    relayCorrelationId: optionalText(relayCorrelationId),
    ...resolvedTransferPayload,
    injectAt: "append",
    dedupe,
    avoidBreakToolCallContinuity: true,
    persistToCurrentTurn: true,
  });
  return logRelayOutcome(ctx, injection, {
    purposeLabel,
    transferPayload: resolvedTransferPayload,
  });
}
