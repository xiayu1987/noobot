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
import { isPlainObject } from "@noobot/shared/value";

const RUNTIME_CONTEXT_INPUT_FIELDS = Object.freeze([
  "basePath",
  "globalConfig",
  "userConfig",
  "eventListener",
  "sessionManager",
  "attachmentService",
  "botManager",
  "userInteractionBridge",
  "abortSignal",
  "runtimeModel",
  "allEnabledProviders",
  "runConfig",
  "systemRuntime",
  "userMessageAttachments",
  "sharedTools",
]);
const RUNTIME_CONTEXT_PLAIN_OBJECT_FIELDS = Object.freeze([
  "globalConfig",
  "allEnabledProviders",
  "runConfig",
  "systemRuntime",
  "sharedTools",
]);

function assertRuntimeContextInput(input) {
  if (!isPlainObject(input)) throw new TypeError("createRuntimeContext requires an input object");
  const missing = RUNTIME_CONTEXT_INPUT_FIELDS.filter((field) => !Object.hasOwn(input, field));
  if (missing.length) {
    throw new TypeError(`createRuntimeContext requires: ${missing.join(",")}`);
  }
  for (const field of ["basePath", "runtimeModel"]) {
    if (typeof input[field] !== "string") {
      throw new TypeError(`createRuntimeContext ${field} must be a string`);
    }
  }
  for (const field of RUNTIME_CONTEXT_PLAIN_OBJECT_FIELDS) {
    if (!isPlainObject(input[field])) {
      throw new TypeError(`createRuntimeContext ${field} must be a plain object`);
    }
  }
  if (!Array.isArray(input.userMessageAttachments)) {
    throw new TypeError("createRuntimeContext userMessageAttachments must be an array");
  }
}

export function createRuntimeContext(input) {
  assertRuntimeContextInput(input);
  const { abortSignal, runConfig } = input;
  return {
    basePath: input.basePath,
    globalConfig: input.globalConfig,
    userConfig: input.userConfig,
    eventListener: input.eventListener,
    sessionManager: input.sessionManager,
    attachmentService: input.attachmentService,
    botManager: input.botManager,
    userInteractionBridge: input.userInteractionBridge,
    abortSignal,
    cancellationScope: createExecutionCancellationScope({ abortSignal }),
    runtimeModel: input.runtimeModel,
    runConfig,
    allEnabledProviders: input.allEnabledProviders,
    sharedTools: input.sharedTools,
    hookManager: runConfig.hookManager,
    systemRuntime: input.systemRuntime,
    currentTurnMessages: createCurrentTurnMessagesStore(),
    currentTurnTasks: createCurrentTurnTasksStore(),
    userMessageAttachments: input.userMessageAttachments,
    userMetaBackwrites: [],
    summaryCheckpointRevision: 0,
    attachments: [],
  };
}
