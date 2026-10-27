/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { TEST_MESSAGE_TS } from "../../helpers/session-run-payload.js";

export function createPersistedCurrentUserMessage(content, overrides = {}) {
  return {
    messageUid: "sm_current_user_fixture",
    role: "user",
    type: "message",
    content,
    userName: "u1",
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "dlg-current",
    parentDialogProcessId: "",
    turnScopeId: "turn-current",
    messageOrigin: "natural",
    attachments: [],
    ts: TEST_MESSAGE_TS,
    ...overrides,
  };
}
