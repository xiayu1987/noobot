/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { consumeContextInjectedMessages } from "./context-mutation.js";
import { readMessageField } from "./message-policy.js";
import { DEFAULT_TASK_SUMMARY_TOOL_NAME } from "./summary-policy.js";

export const CONTEXT_INJECTED_MESSAGE_TYPE = Object.freeze({
  PHASE_SUMMARY_PROMPT: "noobot.phase_summary_prompt",
  TASK_CHECK_PROMPT: "noobot.task_check_prompt",
  HELP_TOOL_LOOP_PROMPT: "noobot.help_tool_loop_prompt",
  HELP_TOOL_FAILURE_PROMPT: "noobot.help_tool_failure_prompt",
  TOOL_LOOP_LIMIT_FINALIZE_PROMPT: "tool_loop_limit_finalize_prompt",
  TASK_SUMMARY_SINGLE_TOOL_RETRY_PROMPT: "task_summary_single_tool_retry_prompt",
});

export const CONTEXT_INJECTED_MESSAGE_TRIGGER = Object.freeze({
  MODEL_INVOCATION_COMPLETED: "model_invocation_completed",
  TOOL_CALLS_COMPLETED: "tool_calls_completed",
});

export const CONTEXT_INJECTED_MESSAGE_POLICIES = Object.freeze([
  Object.freeze({
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_PROMPT,
    consumeOn: CONTEXT_INJECTED_MESSAGE_TRIGGER.TOOL_CALLS_COMPLETED,
    requiredToolName: DEFAULT_TASK_SUMMARY_TOOL_NAME,
  }),
  Object.freeze({
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_PROMPT,
    consumeOn: CONTEXT_INJECTED_MESSAGE_TRIGGER.MODEL_INVOCATION_COMPLETED,
  }),
  Object.freeze({
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.TASK_SUMMARY_SINGLE_TOOL_RETRY_PROMPT,
    consumeOn: CONTEXT_INJECTED_MESSAGE_TRIGGER.MODEL_INVOCATION_COMPLETED,
  }),
]);

export function resolveContextInternalMessageType(message = {}) {
  return String(readMessageField(message, "noobotInternalMessageType") || "").trim();
}

function normalizeTrigger(trigger = {}) {
  const prototype = trigger && typeof trigger === "object"
    ? Object.getPrototypeOf(trigger)
    : null;
  if (!trigger || typeof trigger !== "object" || Array.isArray(trigger) ||
      (prototype !== Object.prototype && prototype !== null)) {
    throw new TypeError("injected message lifecycle trigger must be a plain object");
  }
  const type = String(trigger.type || "").trim();
  if (!Object.values(CONTEXT_INJECTED_MESSAGE_TRIGGER).includes(type)) {
    throw new TypeError(`unsupported injected message lifecycle trigger: ${type}`);
  }
  if (type === CONTEXT_INJECTED_MESSAGE_TRIGGER.MODEL_INVOCATION_COMPLETED) {
    if (Object.hasOwn(trigger, "toolNames")) {
      throw new TypeError("model_invocation_completed trigger must not contain toolNames");
    }
    return { type, toolNames: [] };
  }
  if (!Array.isArray(trigger.toolNames)) {
    throw new TypeError("tool_calls_completed trigger requires toolNames");
  }
  const toolNames = [...new Set(
    trigger.toolNames.map((value) => String(value || "").trim()).filter(Boolean),
  )];
  return { type, toolNames };
}

export function resolveInjectedMessageTypesForTrigger(trigger = {}) {
  const normalized = normalizeTrigger(trigger);
  const completedTools = new Set(normalized.toolNames);
  return CONTEXT_INJECTED_MESSAGE_POLICIES
    .filter((policy) => policy.consumeOn === normalized.type)
    .filter((policy) => !policy.requiredToolName || completedTools.has(policy.requiredToolName))
    .map((policy) => policy.internalType);
}

export function consumeInjectedContextMessages(modelContext = {}, { trigger } = {}) {
  const internalTypes = resolveInjectedMessageTypesForTrigger(trigger);
  if (internalTypes.length === 0) {
    return { removedCount: 0, removedMessageIds: [], removedInternalTypes: [] };
  }
  const blocks = modelContext?.messageBlocks;
  if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) {
    throw new TypeError("modelContext.messageBlocks is required");
  }
  const typeSet = new Set(internalTypes);
  const hasMatch = ["system", "history", "incremental"].some((blockName) =>
    (Array.isArray(blocks[blockName]) ? blocks[blockName] : [])
      .some((message) => typeSet.has(resolveContextInternalMessageType(message))),
  );
  if (!hasMatch) {
    return { removedCount: 0, removedMessageIds: [], removedInternalTypes: [] };
  }
  return consumeContextInjectedMessages(modelContext, internalTypes);
}
