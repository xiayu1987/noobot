/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import {
  resolveContextToolCallArgs,
  resolveContextToolCallName,
  resolveContextToolCalls,
} from "@noobot/context-protocol/message/codec";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/message/injected-types";
import {
  createTaskSummaryReceipt,
  parseTaskSummaryContent,
} from "@noobot/context-protocol/task/summary";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";
import {
  withoutRetiredFlowControlPolicy,
  withoutRetiredToolCallPolicies,
} from "./retired-flow-control-policy.js";

function invalid(message) {
  return Object.assign(new TypeError(`Legacy phase summary migration failed: ${message}`), {
    code: SESSION_REPAIR_ERROR_CODE.PHASE_SUMMARY_UNMIGRATABLE,
  });
}

const key = (message, id) => JSON.stringify([message.dialogProcessId, message.turnScopeId, id]);

function summaryMessage(message, content) {
  const next = {
    ...message,
    role: "user",
    type: "message",
    content,
    chatPresentation: false,
    injectedMessage: true,
    injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
    noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
  };
  for (const field of [
    "tool_call_id",
    "toolName",
    "contextPolicy",
    "tool_calls",
    "modelMessageId",
    "presentationMessageId",
  ])
    delete next[field];
  return next;
}

function collectSummaryDeclarations(message, declarations) {
  for (const call of resolveContextToolCalls(message)) {
    if (resolveContextToolCallName(call) !== "task_summary") continue;
    const id = key(message, call.id);
    if (declarations.has(id)) throw invalid("duplicate tool declaration");
    declarations.set(id, call);
  }
}

export function migrateLegacyPhaseSummaryMessages(messages) {
  const declarations = new Map();
  for (const message of messages) collectSummaryDeclarations(message, declarations);
  const converted = new Set();
  let changed = false;
  const next = messages
    .map((message) => {
      if (message.injectedMessageType === "separate_model_relay:summary") {
        changed = true;
        return summaryMessage(message, message.content);
      }
      if (message.role !== "tool" || message.toolName !== "task_summary") return message;
      let result;
      try {
        result = JSON.parse(message.content);
      } catch {
        throw invalid("invalid tool receipt JSON");
      }
      const id = key(message, message.tool_call_id);
      if (result.ok !== true) return message;
      const call = declarations.get(id);
      if (!call) throw invalid(`missing original summary for ${message.messageUid}`);
      const parsed = parseTaskSummaryContent(resolveContextToolCallArgs(call).summaryContent);
      if (
        result.protocolVersion !== 1 ||
        !isDeepStrictEqual(createTaskSummaryReceipt(parsed), result.summary)
      )
        throw invalid(`receipt does not match original summary for ${message.messageUid}`);
      converted.add(id);
      changed = true;
      return summaryMessage(message, parsed.content);
    })
    .map((message) => {
      const stripped = withoutRetiredFlowControlPolicy(message);
      const calls = resolveContextToolCalls(stripped);
      const remaining = withoutRetiredToolCallPolicies(
        calls.filter((call) => !converted.has(key(message, call.id))),
      );
      if (
        stripped === message &&
        remaining.length === calls.length &&
        remaining.every((call, i) => call === calls[i])
      )
        return message;
      changed = true;
      if (!calls.length) return stripped;
      const next = { ...stripped, tool_calls: remaining };
      if (!remaining.length) {
        next.type = "message";
        delete next.contextPolicy;
        delete next.tool_calls;
      }

      if (Array.isArray(next.rawModelContent))
        next.rawModelContent = next.rawModelContent.filter(
          (block) => !converted.has(key(message, block.id)),
        );
      if (Array.isArray(next.modelResponseMetadata?.output))
        next.modelResponseMetadata = {
          ...next.modelResponseMetadata,
          output: next.modelResponseMetadata.output.filter(
            (block) => !converted.has(key(message, block.call_id)),
          ),
        };
      return next;
    });
  return { messages: changed ? next : messages, changed };
}
