/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const timestamp = "2026-01-01T00:00:00.000Z";

export function repositoryMessage(mode, sequence, sessionId = "s1") {
  return {
    messageUid: `m${sequence}`,
    userMessageId: `m${sequence}`,
    sessionId,
    parentSessionId: "",
    dialogProcessId: mode === "long-turn" ? "d1" : `d${sequence}`,
    parentDialogProcessId: "",
    turnScopeId: mode === "long-turn" ? "t1" : `t${sequence}`,
    role: "user",
    type: "message",
    messageOrigin: "natural",
    content: "x".repeat(1024),
    attachments: [],
    transferEnvelopes: [],
    ts: timestamp,
  };
}
