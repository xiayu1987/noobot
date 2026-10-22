/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  RUNTIME_CONTEXT_INPUT_FIELDS,
  createRuntimeContext,
} from "../../src/runtime/runtime-context-factory.js";

function createDefaultRuntimeContextInput() {
  return {
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
  "currentUserMessageUid",
  "currentUserMessageOrigin",
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
  for (const [field, value] of Object.entries(options)) {
    if (RUNTIME_CONTEXT_INPUT_FIELDS.includes(field)) input[field] = value;
    else if (RUNTIME_POST_MOUNT_FIELDS.includes(field)) mounted[field] = value;
    else throw new TypeError(`createTestRuntimeContext: unknown runtime field ${field}`);
  }
  return Object.assign(createRuntimeContext(input), mounted);
}
