/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createExecutionCancellationScope } from "@noobot/session-protocol/execution-cancellation-scope";
import {
  createCurrentTurnMessagesStore,
  createCurrentTurnTasksStore,
} from "./turn/current-turn-ledger.js";
import { isPlainObject, text } from "@noobot/shared/value";

export function createRuntimeContext({
  basePath = "",
  globalConfig = {},
  userConfig = {},
  eventListener = null,
  sessionManager = null,
  attachmentService = null,
  botManager = null,
  userInteractionBridge = null,
  abortSignal,
  runtimeModel = "",
  allEnabledProviders = {},
  runConfig = {},
  systemRuntime = {},
  userMessageAttachments = [],
  sharedTools = null,
} = {}) {
  const normalizedRunConfig = isPlainObject(runConfig) ? runConfig : {};
  return {
    basePath: text(basePath),
    globalConfig,
    userConfig,
    eventListener,
    sessionManager,
    attachmentService,
    botManager,
    userInteractionBridge,
    abortSignal,
    cancellationScope: createExecutionCancellationScope({ abortSignal }),
    runtimeModel: text(runtimeModel),
    runConfig: normalizedRunConfig,
    allEnabledProviders:
      allEnabledProviders && typeof allEnabledProviders === "object" ? allEnabledProviders : {},
    sharedTools: isPlainObject(sharedTools) ? sharedTools : {},
    hookManager:
      normalizedRunConfig.hookManager && typeof normalizedRunConfig.hookManager === "object"
        ? normalizedRunConfig.hookManager
        : null,
    systemRuntime: systemRuntime && typeof systemRuntime === "object" ? systemRuntime : {},
    currentTurnMessages: createCurrentTurnMessagesStore(),
    currentTurnTasks: createCurrentTurnTasksStore(),
    userMessageAttachments: Array.isArray(userMessageAttachments) ? userMessageAttachments : [],
    userMetaBackwrites: [],
    summaryCheckpointRevision: 0,
    attachments: [],
  };
}
