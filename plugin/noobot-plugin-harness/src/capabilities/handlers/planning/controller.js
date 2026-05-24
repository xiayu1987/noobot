/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureTaskAcceptanceTool } from "../acceptance.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import {
  LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD,
  LLM_SUMMARY_THRESHOLD,
} from "../../../core/thresholds.js";
import {
  disableBlockedToolsInRegistry,
  ensureHarnessBucket,
  extractRawTextContent,
  sanitizeInternalMessages,
  shouldUseSeparateModel,
} from "./deps.js";
import { ensurePlanRefinementTool } from "./tool-injector.js";
import { maybeInjectPlanningPrompt } from "./prompt-builder.js";
import { maybeCapturePlanningResult, runPlanningBySeparateModel } from "./capture-runner.js";

function isMessageSummarized(message = {}) {
  return message?.summarized === true || message?.lc_kwargs?.summarized === true;
}

function resolveUnsummarizedMessageChars(messages = []) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((total, message) => {
    if (!message || typeof message !== "object") return total;
    if (isMessageSummarized(message)) return total;
    const content = extractRawTextContent(message?.content ?? message);
    return total + String(content || "").length;
  }, 0);
}

export function createPlanningHandler({ shouldProcessPrimaryToolHooks = () => true } = {}) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    let changed = false;
    if (
      ["before_llm_call", "after_llm_call", "before_final_output"].includes(point) &&
      !shouldProcessPrimaryToolHooks(ctx)
    ) {
      return { capability, point, status: "active", changed: false };
    }
    if (point === "before_llm_call") {
      const holder = ensureHarnessBucket(ctx);
      if (holder) {
        holder.state.counters.llmTurns += 1;
        const unsummarizedChars = resolveUnsummarizedMessageChars(ctx?.messages);
        if (
          holder.state.counters.llmTurns > LLM_SUMMARY_THRESHOLD ||
          unsummarizedChars > LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD
        ) {
          setPendingStateWithMeta(holder.state, "summary", true);
        }
      }
      changed = sanitizeInternalMessages(ctx) || changed;
      changed = disableBlockedToolsInRegistry(ctx) || changed;
      changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
      changed = ensurePlanRefinementTool(ctx, meta) || changed;
      if (shouldUseSeparateModel(meta)) {
        changed = (await runPlanningBySeparateModel(ctx, meta)) || changed;
      } else {
        changed = maybeInjectPlanningPrompt(ctx, meta) || changed;
      }
    }
    if (point === "after_llm_call") {
      changed = (await maybeCapturePlanningResult(ctx, meta)) || changed;
    }
    return { capability, point, status: "active", changed };
  };
}
