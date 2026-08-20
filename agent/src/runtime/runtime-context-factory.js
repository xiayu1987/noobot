/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createCurrentTurnMessagesStore,
  createCurrentTurnTasksStore,
} from "./turn/current-turn-ledger.js";

export function createRuntimeContext({
  userId = "",
  basePath = "",
  globalConfig = {},
  userConfig = {},
  eventListener = null,
  sessionManager = null,
  attachmentService = null,
  botManager = null,
  userInteractionBridge = null,
  abortSignal = null,
  runtimeModel = "",
  allEnabledProviders = {},
  parentAsyncResultContainer = null,
  runConfig = {},
  systemRuntime = {},
  userMessageAttachments = [],
  sharedTools = null,
} = {}) {
  const normalizedRunConfig =
    runConfig && typeof runConfig === "object" && !Array.isArray(runConfig) ? runConfig : {};
  return {
    userId: String(userId || "").trim(),
    basePath: String(basePath || "").trim(),
    globalConfig,
    userConfig,
    eventListener,
    sessionManager,
    attachmentService,
    botManager,
    userInteractionBridge,
    abortSignal: abortSignal || null,
    runtimeModel: String(runtimeModel || "").trim(),
    runConfig: normalizedRunConfig,
    allEnabledProviders:
      allEnabledProviders && typeof allEnabledProviders === "object" ? allEnabledProviders : {},
    sharedTools:
      sharedTools && typeof sharedTools === "object"
        ? sharedTools
        : normalizedRunConfig.sharedTools && typeof normalizedRunConfig.sharedTools === "object"
          ? normalizedRunConfig.sharedTools
          : {},
    hookManager:
      normalizedRunConfig.hookManager && typeof normalizedRunConfig.hookManager === "object"
        ? normalizedRunConfig.hookManager
        : null,
    childAsyncResultContainers: [],
    parentAsyncResultContainer:
      parentAsyncResultContainer && typeof parentAsyncResultContainer === "object"
        ? parentAsyncResultContainer
        : null,
    systemRuntime: systemRuntime && typeof systemRuntime === "object" ? systemRuntime : {},
    currentTurnMessages: createCurrentTurnMessagesStore(),
    currentTurnTasks: createCurrentTurnTasksStore(),
    userMessageAttachments: Array.isArray(userMessageAttachments) ? userMessageAttachments : [],
    attachments: [],
  };
}
