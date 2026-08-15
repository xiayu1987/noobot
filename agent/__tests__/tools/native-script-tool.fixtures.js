/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const IDENTITY = Object.freeze({
  transferId: "transfer:native-script:output",
  messageId: "message:native-script",
  sessionId: "session-1",
  turnScopeId: "turn:native-script",
  runId: "run:native-script",
  producer: { type: "tool", id: "call:native-script" },
});

export function createRuntime(basePath, patch = {}) {
  return {
    basePath,
    userId: "admin",
    globalConfig: { tools: { execute_native_script: { enabled: true } } },
    userConfig: {},
    systemRuntime: {
      sessionId: "session-1",
      rootSessionId: "session-1",
      config: { safeConfirm: false },
    },
    ...patch,
  };
}
