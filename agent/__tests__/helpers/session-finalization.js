/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function createTestSessionFinalizationContext() {
  return {
    parentDialogProcessId: "",

    startedAt: "2026-07-30T00:00:00.000Z",
    userConfig: {},
    lifecycle: { enterPersisting() {}, enterMemory() {} },
    runtimeEventListener: { onEvent() {}, async flush() {} },
  };
}
