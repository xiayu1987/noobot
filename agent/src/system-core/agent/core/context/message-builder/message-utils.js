/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MESSAGE_ROLE } from "../../../../bot-manage/config/constants.js";

export function resolveMessageRole(msg = {}) {
  const explicitType = String(msg?.type || msg?.lc_kwargs?.type || "").trim().toLowerCase();
  const langChainType = typeof msg?._getType === "function"
    ? String(msg._getType() || "").trim().toLowerCase()
    : "";
  const type = explicitType || langChainType;
  if (type === "human") return MESSAGE_ROLE.USER;
  if (type === "ai") return MESSAGE_ROLE.ASSISTANT;
  if (type === "tool" || type === "tool_result") return MESSAGE_ROLE.TOOL;
  if (type === "system") return MESSAGE_ROLE.SYSTEM;
  const explicitRole = String(msg?.role || "").trim().toLowerCase();
  if (explicitRole) return explicitRole;
  return "";
}

export function resolveMessageToolCalls(msg = {}) {
  if (Array.isArray(msg?.tool_calls)) return msg.tool_calls;
  if (Array.isArray(msg?.lc_kwargs?.tool_calls)) return msg.lc_kwargs.tool_calls;
  if (Array.isArray(msg?.additional_kwargs?.tool_calls)) return msg.additional_kwargs.tool_calls;
  return [];
}

export function resolveMessageToolCallId(msg = {}) {
  return String(
    msg?.tool_call_id ||
      msg?.toolCallId ||
      msg?.lc_kwargs?.tool_call_id ||
      msg?.lc_kwargs?.toolCallId ||
      msg?.additional_kwargs?.tool_call_id ||
      "",
  ).trim();
}

export function toLangChainToolCalls(toolCalls = []) {
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

export function buildModelMessageIdentityKwargs(msg = {}, fallbackMeta = {}) {
  const dialogProcessId = String(
    msg?.dialogProcessId || fallbackMeta?.dialogProcessId || "",
  ).trim();
  const parentDialogProcessId = String(
    msg?.parentDialogProcessId || fallbackMeta?.parentDialogProcessId || "",
  ).trim();
  const turnScopeId = String(msg?.turnScopeId || fallbackMeta?.turnScopeId || "").trim();
  return {
    ...(dialogProcessId ? { dialogProcessId } : {}),
    ...(parentDialogProcessId ? { parentDialogProcessId } : {}),
    ...(turnScopeId ? { turnScopeId } : {}),
    ...(msg?.frontendUserMessage === true ? { frontendUserMessage: true } : {}),
    ...(msg?.injectedMessage === true ? { injectedMessage: true } : {}),
    ...(String(msg?.injectedBy || "").trim() ? { injectedBy: String(msg.injectedBy).trim() } : {}),
    ...(String(msg?.injectedMessageType || msg?.injected_message_type || "").trim()
      ? { injectedMessageType: String(msg?.injectedMessageType || msg?.injected_message_type).trim() }
      : {}),
    ...(msg?.pluginMessage === true ? { pluginMessage: true } : {}),
    ...(String(msg?.messageOrigin || "").trim()
      ? { messageOrigin: String(msg.messageOrigin).trim() }
      : {}),
  };
}
