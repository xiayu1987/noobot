/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { tEngine } from "../i18n-adapter.js";
import { MESSAGE_ROLE } from "../../../bot-manage/config/constants.js";
import { resolveModelContextMessages } from "../../../session/utils/context-window-normalizer.js";
import {
  resolveDialogProcessIdFromContext,
  resolveDialogProcessId,
  resolveMessageDialogProcessId,
} from "../../../context/session/dialog-process-id-resolver.js";

export function buildContextMessages(
  agentContext,
  { currentUserMessage = "" } = {},
) {
  const runtime = agentContext?.execution?.controllers?.runtime || {};
  
  function toLangChainToolCalls(toolCalls = []) {
    return (toolCalls || [])
      .map((tc) => {
        if (!tc) return null;
        if (tc.name) {
          return {
            id: tc.id || "",
            name: tc.name,
            args: tc.args || {},
            type: "tool_call",
          };
        }
        const fn = tc.function || {};
        let args = {};
        try {
          args =
            typeof fn.arguments === "string"
              ? JSON.parse(fn.arguments || "{}")
              : fn.arguments || {};
        } catch {
          args = {};
        }
        if (!fn.name) return null;
        return {
          id: tc.id || "",
          name: fn.name,
          args,
          type: "tool_call",
        };
      })
      .filter(Boolean);
  }

  function resolveAttachmentMetas(msg = {}, fallbackAttachmentMetas = []) {
    if (Array.isArray(msg?.attachmentMetas)) return msg.attachmentMetas;
    return Array.isArray(fallbackAttachmentMetas) ? fallbackAttachmentMetas : [];
  }

  function buildHumanMessageContent(msg = {}, fallbackAttachmentMetas = []) {
    const textContent = String(msg?.content || "");
    void fallbackAttachmentMetas;
    return textContent;
  }

  function buildUserMetaInfoContent(msg = {}, fallbackMeta = {}) {
    const attachmentMetas = resolveAttachmentMetas(
      msg,
      fallbackMeta?.attachmentMetas || [],
    );
    const payload = {
      userName: String(msg?.userName || fallbackMeta?.userName || "").trim(),
      sessionId: String(msg?.sessionId || fallbackMeta?.sessionId || "").trim(),
      parentSessionId: String(
        msg?.parentSessionId || fallbackMeta?.parentSessionId || "",
      ).trim(),
      dialogProcessId:
        resolveMessageDialogProcessId(msg) ||
        resolveDialogProcessIdFromContext({
          dialogProcessId: fallbackMeta?.dialogProcessId,
        }),
      parentDialogProcessId: String(
        msg?.parentDialogProcessId || fallbackMeta?.parentDialogProcessId || "",
      ).trim(),
      attachments: attachmentMetas.map((attachmentItem) => ({
        attachmentId: String(attachmentItem?.attachmentId || "").trim(),
        name: String(attachmentItem?.name || "").trim(),
        path: String(attachmentItem?.path || "").trim(),
        relativePath: String(attachmentItem?.relativePath || "").trim(),
        parsedResultAttachmentId: String(
          attachmentItem?.parsedResultAttachmentId || "",
        ).trim(),
        parsedResultPath: String(attachmentItem?.parsedResultPath || "").trim(),
        parsedResultRelativePath: String(
          attachmentItem?.parsedResultRelativePath || "",
        ).trim(),
        parsedResultTool: String(attachmentItem?.parsedResultTool || "").trim(),
        parsedResultUpdatedAt: String(
          attachmentItem?.parsedResultUpdatedAt || "",
        ).trim(),
      })),
    };
    return JSON.stringify(payload, null, 2);
  }

  function buildHumanMessagesForUser(msg = {}, fallbackMeta = {}) {
    const contentMessage = new HumanMessage(
      buildHumanMessageContent(msg, fallbackMeta?.attachmentMetas || []),
    );
    const userMetaTag = tEngine(runtime, "agent.userMetaTag");
    const metaMessage = new HumanMessage(
      `[${userMetaTag}]\n${buildUserMetaInfoContent(msg, fallbackMeta)}\n[/${userMetaTag}]`,
    );
    return [contentMessage, metaMessage];
  }

  const out = [];
  const systemRuntime = runtime?.systemRuntime || {};
  const fallbackUserMeta = {
    userName: String(runtime?.userId || "").trim(),
    sessionId: String(systemRuntime?.sessionId || "").trim(),
    parentSessionId: String(systemRuntime?.parentSessionId || "").trim(),
    dialogProcessId: "",
    parentDialogProcessId: String(
      systemRuntime?.parentDialogProcessId || "",
    ).trim(),
    attachmentMetas: Array.isArray(runtime?.attachmentMetas)
      ? runtime.attachmentMetas
      : [],
  };
  const systemMessages = Array.isArray(agentContext?.payload?.messages?.system)
    ? agentContext.payload.messages.system
    : [];
  const historyMessages = Array.isArray(agentContext?.payload?.messages?.history)
    ? agentContext.payload.messages.history
    : [];
  const resolvedDialogProcessId = resolveDialogProcessId({
    ctx: {
      agentContext: {
        execution: {
          dialogProcessId: systemRuntime?.dialogProcessId,
          controllers: { runtime: { systemRuntime } },
        },
      },
    },
    messages: historyMessages,
  });
  fallbackUserMeta.dialogProcessId = resolvedDialogProcessId;
  const effectiveHistoryMessages = resolveModelContextMessages({
    sourceMessages: historyMessages,
    currentDialogProcessId: resolvedDialogProcessId,
    mode: "agent",
  });
  const knownHistoryToolCallIds = new Set();

  for (const msg of effectiveHistoryMessages) {
    if (msg?.summarized === true) continue;
    if ((msg?.role || "") !== MESSAGE_ROLE.ASSISTANT) continue;
    const normalizedToolCalls = toLangChainToolCalls(msg.tool_calls || []);
    for (const toolCall of normalizedToolCalls) {
      const toolCallId = String(toolCall?.id || "").trim();
      if (toolCallId) knownHistoryToolCallIds.add(toolCallId);
    }
  }

  for (const content of systemMessages) {
    out.push(new SystemMessage(content));
  }

  for (const msg of effectiveHistoryMessages) {
    if (msg?.summarized === true) continue;
    const role = msg.role || "";
    if (role === MESSAGE_ROLE.SYSTEM) {
      out.push(new SystemMessage(msg.content || ""));
      continue;
    }

    if (role === MESSAGE_ROLE.ASSISTANT) {
      const toolCalls = toLangChainToolCalls(msg.tool_calls || []);
      const resolvedAssistantContent =
        typeof msg?.rawModelContent === "string" || Array.isArray(msg?.rawModelContent)
          ? msg.rawModelContent
          : msg.content || "";
      out.push(
        new AIMessage({
          content: resolvedAssistantContent,
          tool_calls: toolCalls,
        }),
      );
      continue;
    }

    if (role === MESSAGE_ROLE.TOOL) {
      const toolCallId = String(msg?.tool_call_id || "").trim();
      if (toolCallId && !knownHistoryToolCallIds.has(toolCallId)) {
        continue;
      }
      out.push(
        new ToolMessage({
          tool_call_id: toolCallId,
          content: msg.content || "",
        }),
      );
      continue;
    }

    out.push(...buildHumanMessagesForUser(msg, fallbackUserMeta));
  }
  const normalizedCurrentUserMessage = String(currentUserMessage || "").trim();
  if (normalizedCurrentUserMessage) {
    out.push(
      ...buildHumanMessagesForUser(
        {
          role: MESSAGE_ROLE.USER,
          content: normalizedCurrentUserMessage,
          userName: fallbackUserMeta.userName,
          attachmentMetas: fallbackUserMeta.attachmentMetas,
          sessionId: fallbackUserMeta.sessionId,
          parentSessionId: fallbackUserMeta.parentSessionId,
          dialogProcessId: fallbackUserMeta.dialogProcessId,
          parentDialogProcessId: fallbackUserMeta.parentDialogProcessId,
        },
        fallbackUserMeta,
      ),
    );
  }
  return out;
}
