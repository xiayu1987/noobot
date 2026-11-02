/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MESSAGE_ORIGIN, isDialogUserMessageRecord } from "@noobot/session-protocol";
import { TEST_MESSAGE_TS } from "./session-run-payload.js";

export function canonicalSessionMessages(messages, sessionId, namespace = "fixture") {
  return messages.map((message, index) => {
    const turnScopeId = Object.hasOwn(message, "turnScopeId")
      ? message.turnScopeId
      : `turn-${namespace}-${index + 1}`;
    const roleIdentity = {};
    if (message.role === "assistant") roleIdentity.modelMessageId = `mm_${namespace}_${index + 1}`;
    if (["assistant", "tool"].includes(message.role))
      roleIdentity.presentationMessageId = `pm_${turnScopeId}`;
    if (message.role === "user" && !message.injectedMessage)
      roleIdentity.userMessageId = `um_${namespace}_${index + 1}`;
    return {
      sessionId,
      messageUid: `sm_${namespace}_${index + 1}`,
      ts: TEST_MESSAGE_TS,
      attachments: [],
      ...roleIdentity,
      ...(isDialogUserMessageRecord(message) ? { messageOrigin: MESSAGE_ORIGIN.NATURAL } : {}),
      dialogProcessId: `dialog-${turnScopeId}`,
      turnScopeId,
      ...message,
    };
  });
}
