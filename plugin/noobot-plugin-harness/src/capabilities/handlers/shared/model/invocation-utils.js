/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateModelResponse } from "@noobot/model-protocol";
import { ensureHarnessBucket } from "../bucket-utils.js";
import { HARNESS_I18N_KEYSET, resolveLocale, translateI18nText } from "../i18n.js";
import { isHarnessAgentTurnEnded } from "../runtime/lifecycle-utils.js";
import { resolveIncrementalCapabilityMessages } from "./incremental-message-cache.js";
import { markMessageAsProtocol } from "./message-metadata.js";

function buildAuxiliaryModelNoScriptMessage(ctx = {}) {
  return markMessageAsProtocol(
    {
      role: "system",
      content: translateI18nText(
        resolveLocale(ctx),
        HARNESS_I18N_KEYSET.WORKFLOW_PROMPTS.AUXILIARY_MODEL_NO_SCRIPT_CONSTRAINT,
      ),
    },
    "harness:auxiliary-model-no-script-constraint",
  );
}

function appendReasoningAttemptsToBucket(ctx = {}, { purpose = "", response = null } = {}) {
  const attempts = Array.isArray(response?.execution?.attempts) ? response.execution.attempts : [];
  const reasoningAttempts = attempts.filter(
    (attempt = {}) =>
      attempt.kind === "reasoning_only" && String(attempt?.output?.reasoning || "").trim(),
  );
  if (!reasoningAttempts.length) return false;
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  if (!Array.isArray(holder.bucket.modelReasoningTraces)) {
    holder.bucket.modelReasoningTraces = [];
  }
  for (const attempt of reasoningAttempts) {
    holder.bucket.modelReasoningTraces.push({
      capturedAt: new Date().toISOString(),
      purpose: String(purpose || "unknown").trim() || "unknown",
      attempt: Number(attempt.attempt) || 1,
      content: String(attempt.output.reasoning),
    });
  }
  if (holder.bucket.modelReasoningTraces.length > 40) {
    holder.bucket.modelReasoningTraces.splice(0, holder.bucket.modelReasoningTraces.length - 40);
  }
  return true;
}

export async function invokeCapabilityModel({
  invoker = null,
  invokePayload = {},
  purpose = "",
  appendModelTrace = null,
  ctx = {},
} = {}) {
  if (typeof invoker !== "function") return null;
  if (isHarnessAgentTurnEnded(ctx)) return null;
  const payload = invokePayload && typeof invokePayload === "object" ? { ...invokePayload } : {};
  const runtimeMessages = [
    buildAuxiliaryModelNoScriptMessage(ctx),
    ...resolveIncrementalCapabilityMessages({
      ctx,
      purpose: purpose || payload.purpose,
      messages: Array.isArray(payload.messages) ? payload.messages : [],
    }),
  ];
  const response = validateModelResponse(await invoker({ ...payload, messages: runtimeMessages }));
  if (!String(response.output.text || "").trim()) {
    throw new TypeError(
      `harness capability model returned empty output: ${purpose || payload.purpose || "unknown"}`,
    );
  }
  appendReasoningAttemptsToBucket(ctx, { purpose, response });
  if (typeof appendModelTrace === "function") {
    await appendModelTrace(response);
  }
  return response;
}
