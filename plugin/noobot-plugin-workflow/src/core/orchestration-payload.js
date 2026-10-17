/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_PHASE_STATUS,
  WORKFLOW_PLUGIN_DEFAULTS,
  WORKFLOW_PROTOCOL,
  WORKFLOW_RETRY,
  WORKFLOW_SEMANTIC,
} from "./constants.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { randomUUID } from "node:crypto";
import { text } from "@noobot/shared/value";

function normalizeMetaValue(value = "") {
  return text(value);
}

function createInteractionId(ctx = {}) {
  const provided = normalizeMetaValue(
    ctx?.interactionId || ctx?.runConfig?.interactionId || ctx?.dialogProcessId,
  );
  if (provided) return provided;
  const userId = normalizeMetaValue(ctx?.userId || "anonymous");
  const sessionId = normalizeMetaValue(ctx?.sessionId || "session");
  return `wf_${userId}_${sessionId}_${randomUUID()}`;
}

function resolveRunMeta(ctx = {}) {
  return {
    userId: normalizeMetaValue(ctx?.userId),
    sessionId: normalizeMetaValue(ctx?.sessionId),
    parentSessionId: normalizeMetaValue(ctx?.parentSessionId),
    dialogProcessId: normalizeMetaValue(ctx?.dialogProcessId),
    hookPoint: HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH,
    locale: normalizeMetaValue(ctx?.runConfig?.locale || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_LOCALE),
  };
}

function previewText(
  inputText = "",
  maxChars = LENGTH_THRESHOLDS.contextPreview.workflowPayloadPreviewChars,
) {
  const raw = String(inputText || "");
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}...(truncated)`;
}

export function buildWorkflowOrchestrationPayload({
  workflowRunId = "",
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
  const resolvedWorkflowRunId = normalizeMetaValue(workflowRunId);
  if (!resolvedWorkflowRunId) throw new Error("workflowRunId is required");
  const protocolVersion = WORKFLOW_PROTOCOL.ORCHESTRATION_VERSION;
  const now = new Date().toISOString();
  const success = !error && semantic && execution;
  const interactionId = createInteractionId(ctx);

  return {
    protocolVersion,
    workflowRunId: resolvedWorkflowRunId,
    status: success ? WORKFLOW_PHASE_STATUS.SUCCEEDED : WORKFLOW_PHASE_STATUS.FAILED,
    timestamp: now,
    interactionId,
    runMeta: resolveRunMeta(ctx),
    orchestration: {
      semanticPurpose: WORKFLOW_SEMANTIC.PURPOSE,
      semanticModel: normalizeMetaValue(options.semanticModel),
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
    semantic: semantic || null,
    execution,
    artifacts: success
      ? {
          semantic,
          execution,
        }
      : {
          semantic: semantic || null,
          execution,
        },
    diagnostics: {
      invokerTraceCount: Number(semanticResolution?.traceCount || 0),
      error: error
        ? {
            message: String(error?.message || error || ""),
          }
        : null,
    },
  };
}
