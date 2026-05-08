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
      dialogProcessId: String(
        msg?.dialogProcessId || fallbackMeta?.dialogProcessId || "",
      ).trim(),
      parentDialogProcessId: String(
        msg?.parentDialogProcessId || fallbackMeta?.parentDialogProcessId || "",
      ).trim(),
      attachments: attachmentMetas.map((attachmentItem) => ({
        attachmentId: String(attachmentItem?.attachmentId || "").trim(),
        name: String(attachmentItem?.name || "").trim(),
        path: String(attachmentItem?.path || "").trim(),
        relativePath: String(attachmentItem?.relativePath || "").trim(),
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
    dialogProcessId: String(systemRuntime?.dialogProcessId || "").trim(),
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

  for (const content of systemMessages) {
    out.push(new SystemMessage(content));
  }

  for (const msg of historyMessages) {
    const role = msg.role || "";
    if (role === "assistant") {
      const toolCalls = toLangChainToolCalls(msg.tool_calls || []);
      if (toolCalls.length) {
        out.push(
          new AIMessage({
            content: msg.content || "",
            tool_calls: toolCalls,
          }),
        );
      } else {
        out.push(new AIMessage(msg.content || ""));
      }
      continue;
    }

    if (role === "tool") {
      out.push(
        new ToolMessage({
          tool_call_id: msg.tool_call_id || "",
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
          role: "user",
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
