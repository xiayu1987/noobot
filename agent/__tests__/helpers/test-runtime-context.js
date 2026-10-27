/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  RUNTIME_CONTEXT_INPUT_FIELDS,
  createRuntimeContext,
} from "../../src/runtime/runtime-context-factory.js";
import { HOOK_RUNTIME_IDENTITY_FIELDS } from "@noobot/hook-protocol/runtime-identity";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { TEST_RUN_PREFERENCES } from "./run-preferences.js";
import { TEST_MODEL_GLOBAL_CONFIG } from "./test-model-config.js";

export const TEST_RUNTIME_IDENTITY = Object.freeze({
  userId: "u-test",
  sessionId: "s-1",
  parentSessionId: "",
  dialogProcessId: "d-1",
  turnScopeId: "t-1",
  caller: SESSION_CALLER.USER,
});

function createDefaultRuntimeContextInput() {
  return {
    basePath: "",
    globalConfig: { ...TEST_MODEL_GLOBAL_CONFIG },
    userConfig: {},
    eventListener: null,
    sessionManager: null,
    attachmentService: null,
    botManager: null,
    userInteractionBridge: null,
    abortSignal: new AbortController().signal,
    runtimeModel: "",
    allEnabledProviders: {},
    runConfig: { hookManager: null },
    systemRuntime: {},
    userMessageAttachments: [],
    sharedTools: {},
  };
}

const RUNTIME_POST_MOUNT_FIELDS = Object.freeze([
  "modelHost",
  "agentLifecycle",
  "activeMessageContext",
  "currentUserMessage",
  "consumeUserInterjections",
  "sealUserInterjectionQueueIfEmpty",
  "userInterjectionPort",
  "commitSummaryCheckpoint",
  "persistCurrentTurnMessages",
  "withCurrentTurnPersistenceBatch",
  "timelineCheckpointPersistedMessageUids",
  "projectCurrentTurnMessageEvent",
  "materializePendingCurrentTurnMessageEvents",
  "materializeUnownedCurrentTurnMessageEvents",
  "resumeFromStoppedSnapshot",
  "resumedStoppedSnapshotIdentity",
  "resumedStoppedSnapshotTurnProgress",
  "stoppedModelMessageSnapshotCandidate",
  "summaryCheckpointPersistedMessageUids",
  "summaryCheckpointPromotionSources",
  "summaryCheckpointRevision",
]);

export function createTestRuntimeContext(options = {}) {
  const input = createDefaultRuntimeContextInput();
  const mounted = {};
  const { identity: identityOverrides = {}, ...fields } = options;
  for (const [field, value] of Object.entries(fields)) {
    if (RUNTIME_CONTEXT_INPUT_FIELDS.includes(field)) input[field] = value;
    else if (RUNTIME_POST_MOUNT_FIELDS.includes(field)) mounted[field] = value;
    else throw new TypeError(`createTestRuntimeContext: unknown runtime field ${field}`);
  }
  const preset = HOOK_RUNTIME_IDENTITY_FIELDS.filter((field) => field in input.systemRuntime);
  if (preset.length) {
    throw new TypeError(
      `createTestRuntimeContext: pass identity via the identity option, not systemRuntime: ${preset.join(",")}`,
    );
  }
  Object.assign(input.systemRuntime, { ...TEST_RUNTIME_IDENTITY, ...identityOverrides });
  input.systemRuntime.config = { ...TEST_RUN_PREFERENCES, ...input.systemRuntime.config };
  return Object.assign(createRuntimeContext(input), mounted);
}
