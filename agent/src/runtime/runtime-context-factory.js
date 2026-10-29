/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createExecutionCancellationScope } from "@noobot/session-protocol/execution-cancellation-scope";
import { createCurrentTurnMessagesStore } from "./turn/current-turn-ledger.js";
import { assertOptionalHookManager } from "@noobot/hook-protocol/runtime";
import {
  HOOK_RUNTIME_IDENTITY_FIELDS,
  createHookRuntimeIdentity,
} from "@noobot/hook-protocol/runtime-identity";
import { AGENT_CONTEXT_IDENTITY_SHAPE } from "@noobot/context-protocol/agent-context/schema";
import { isPlainObject } from "@noobot/shared/value";
import { createMainFlowControlState } from "./main-flow-control.js";
import { createMessageEventStreamState } from "../events/message-event-stream.js";

export const RUNTIME_CONTEXT_INPUT_FIELDS = Object.freeze([
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

const ENVELOPE_ONLY_IDENTITY_FIELDS = Object.freeze(
  Object.keys(AGENT_CONTEXT_IDENTITY_SHAPE).filter(
    (field) => !HOOK_RUNTIME_IDENTITY_FIELDS.includes(field),
  ),
);
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
  const envelopeOnly = ENVELOPE_ONLY_IDENTITY_FIELDS.filter((field) =>
    Object.hasOwn(input.systemRuntime, field),
  );
  if (envelopeOnly.length) {
    throw new TypeError(
      `createRuntimeContext systemRuntime must not carry envelope identity: ${envelopeOnly.join(",")}`,
    );
  }
  if (Object.hasOwn(input.systemRuntime, "messageEventStream")) {
    throw new TypeError("createRuntimeContext owns systemRuntime.messageEventStream");
  }

  createHookRuntimeIdentity(
    Object.fromEntries(
      HOOK_RUNTIME_IDENTITY_FIELDS.map((field) => [field, input.systemRuntime[field]]),
    ),
  );
}

export function createRuntimeContext(input) {
  assertRuntimeContextInput(input);
  const { abortSignal, runConfig } = input;
  input.systemRuntime.messageEventStream = createMessageEventStreamState();
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
    hookManager: assertOptionalHookManager(runConfig.hookManager, "runConfig.hookManager"),
    systemRuntime: input.systemRuntime,
    mainFlowControlState: createMainFlowControlState(),
    activeMessageContext: null,
    currentTurnMessages: createCurrentTurnMessagesStore(),
    userMessageAttachments: input.userMessageAttachments,
    summaryCheckpointRevision: 0,
    summaryCheckpointPersistedMessageUids: [],
    summaryCheckpointPromotionSources: [],
    timelineCheckpointPersistedMessageUids: [],
    attachments: [],
  };
}
