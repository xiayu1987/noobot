/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createRuntimeContext } from "../../src/runtime/runtime-context-factory.js";

export function createTestRuntimeContext(options = {}) {
  return createRuntimeContext({
    basePath: "",
    globalConfig: {},
    userConfig: {},
    eventListener: null,
    sessionManager: null,
    attachmentService: null,
    botManager: null,
    userInteractionBridge: null,
    abortSignal: new AbortController().signal,
    runtimeModel: "",
    allEnabledProviders: {},
    runConfig: {},
    systemRuntime: {},
    userMessageAttachments: [],
    sharedTools: {},
    ...options,
  });
}
