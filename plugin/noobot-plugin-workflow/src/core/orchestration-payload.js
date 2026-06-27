/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_BOT_HOOK_POINTS,
  WORKFLOW_PHASE_STATUS,
  WORKFLOW_PLUGIN_DEFAULTS,
  WORKFLOW_PROTOCOL,
  WORKFLOW_RETRY,
  WORKFLOW_SEMANTIC,
} from "./constants.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

function normalizeMetaValue(value = "") {
  return String(value || "").trim();
}

function createInteractionId(ctx = {}) {
  const provided = normalizeMetaValue(
    ctx?.interactionId || ctx?.runConfig?.interactionId || ctx?.dialogProcessId,
  );
  if (provided) return provided;
  const userId = normalizeMetaValue(ctx?.userId || "anonymous");
  const sessionId = normalizeMetaValue(ctx?.sessionId || "session");
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `wf_${userId}_${sessionId}_${ts}_${rand}`;
}

function resolveRunMeta(ctx = {}, options = {}) {
  return {
    userId: normalizeMetaValue(ctx?.userId),
    sessionId: normalizeMetaValue(ctx?.sessionId),
    parentSessionId: normalizeMetaValue(ctx?.parentSessionId),
    dialogProcessId: normalizeMetaValue(ctx?.dialogProcessId),
    hookPoint: WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH,
    locale: normalizeMetaValue(ctx?.runConfig?.locale || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_LOCALE),
  };
}

function previewText(text = "", maxChars = LENGTH_THRESHOLDS.contextPreview.workflowPayloadPreviewChars) {
  const raw = String(text || "");
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}...(truncated)`;
}

export function buildWorkflowOrchestrationPayload({
  ctx = {},
  options = {},
  sourceText = "",
  semanticText = "",
  semantic = null,
  execution = null,
  semanticResolution = {},
  phaseTimeline = [],
  retryMeta = {},
  error = null,
} = {}) {
  const protocolVersion = WORKFLOW_PROTOCOL.ORCHESTRATION_VERSION;
  const now = new Date().toISOString();
  const success = !error && semantic && execution;
  const mode =
    semanticResolution?.invoked === true
      ? WORKFLOW_SEMANTIC.MODE_SEPARATE_MODEL
      : WORKFLOW_SEMANTIC.MODE_INLINE_TEXT;
  const interactionId = createInteractionId(ctx);

  return {
    protocolVersion,
    status: success ? WORKFLOW_PHASE_STATUS.SUCCEEDED : WORKFLOW_PHASE_STATUS.FAILED,
    timestamp: now,
    interactionId,
    runMeta: resolveRunMeta(ctx, options),
    orchestration: {
      mode,
      semanticPurpose: WORKFLOW_SEMANTIC.PURPOSE,
      semanticModel: normalizeMetaValue(semanticResolution?.model || options?.semanticModel || ""),
    },
    interaction: {
      sourceTextPreview: previewText(sourceText),
      semanticTextPreview: previewText(semanticText),
    },
    phaseTimeline: Array.isArray(phaseTimeline) ? phaseTimeline : [],
    retryMeta: {
      policy: WORKFLOW_RETRY.POLICY_SINGLE_SHOT,
      maxAttempts: Number(retryMeta?.maxAttempts || WORKFLOW_RETRY.MAX_ATTEMPTS),
      attempts: Number(retryMeta?.attempts || WORKFLOW_RETRY.MAX_ATTEMPTS),
      retried: Number(retryMeta?.attempts || WORKFLOW_RETRY.MAX_ATTEMPTS) > 1,
      history: Array.isArray(retryMeta?.history) ? retryMeta.history : [],
    },
    // backward-compatible shortcut fields
    semantic: semantic || null,
    execution: execution || null,
    artifacts: success
      ? {
          semantic,
          execution,
        }
      : {
          semantic: semantic || null,
          execution: execution || null,
        },
    diagnostics: {
      invokerUsed: semanticResolution?.invoked === true,
      invokerTraceCount: Number(semanticResolution?.traceCount || 0),
      error: error
        ? {
            message: String(error?.message || error || ""),
          }
        : null,
    },
  };
}
