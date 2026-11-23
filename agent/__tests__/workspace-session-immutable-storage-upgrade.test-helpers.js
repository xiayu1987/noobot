/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestPartitionStorageBudget } from "./helpers/partition-journal-cases.js";
import { mkdtemp, mkdir, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  createEmptyTurnLifecycle,
  SESSION_COMMAND,
  appendCommandReceipt,
} from "@noobot/session-protocol";
import { prepareAttachmentBinding } from "../src/session/attachment-binding-request.js";
import { parseTurnSummaryCheckpointRequest } from "@noobot/context-protocol/policy/summary-checkpoint-request";
import { immutableCheckpointKey } from "../src/session/session-artifact-session/immutable-checkpoint-index.js";
import { immutableOrderKey } from "../src/session/session-artifact-session/immutable-order-key.js";
import { TEST_STORAGE_SERVICE as storageService } from "./helpers/storage-service.js";
import {
  writeSessionArtifact,
  SESSION_ARTIFACT_PREDECESSOR,
} from "../src/session/session-artifact-store.js";
import { migrateSessionImmutableStorage } from "../src/workspace-lifecycle/session-immutable-storage-upgrade.js";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { ImmutableSessionStore } from "../src/session/session-artifact-session/immutable-session-store.js";

async function fixture(t, binding = null) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-upgrade-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const timestamp = "2026-01-01T00:00:00.000Z";
  await writeSessionArtifact({
    storageService,
    sessionDir,
    atomic: true,
    predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
    sessionPayload: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: binding ? 1 : 0,
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
        commandReceipts: binding
          ? appendCommandReceipt([], {
              commandId: binding.commandId,
              type: SESSION_COMMAND.TURN_ATTACHMENTS_BIND,
              turnScopeId: binding.turnScopeId,
              requestHash: prepareAttachmentBinding(binding).requestHash,
              aggregateVersion: 1,
              result: { messageUid: binding.messageUid },
              committedAt: timestamp,
            })
          : [],
      },
      turnTimings: [],
      sessionArtifactEvents: [],
      selectedConnectorIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [0, 1, 2].map((index) => ({
        messageUid: `m${index}`,
        userMessageId: `u${index}`,
        sessionId: "s1",
        parentSessionId: "",
        dialogProcessId: `d${index}`,
        turnScopeId: `t${index}`,
        parentDialogProcessId: "",
        role: "user",
        messageOrigin: "natural",
        type: "message",
        content: `message ${index}`,
        attachments: binding && index === 0 ? binding.attachments : [],
        transferEnvelopes: [],
        ts: timestamp,
      })),
      dialogOrder: [0, 1, 2].map((index) => ({
        dialogProcessId: `d${index}`,
        turnScopeId: `t${index}`,
        userMessageUid: `m${index}`,
        dialogOrdinal: index + 1,
      })),
    },
  });
  return sessionDir;
}

async function migratedWorkspace(t) {
  const original = await fixture(t);
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "session-workspace-upgrade-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const base = path.join(workspaceRoot, "user");
  const sessionDir = path.join(base, WORKSPACE_LAYOUT.SESSION_DIR, "s1");
  await mkdir(path.dirname(sessionDir), { recursive: true });
  await rename(original, sessionDir);
  await migrateSessionImmutableStorage({ storageService, sessionDir });
  const store = await ImmutableSessionStore.open({ sessionDir });
  return { base, sessionDir, store };
}

async function checkpointWorkspace(t) {
  const { base, sessionDir, store } = await migratedWorkspace(t);
  const head = await store.snapshot();
  const record = await store.get(head, "messages", "m0");
  const checkpoint = parseTurnSummaryCheckpointRequest({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d0",
    turnScopeId: "t0",
    checkpointId: "legacy-cp",
    expectedCheckpointRevision: 0,
    persistedMessageUids: ["m0"],
    summarizedMessageUids: ["m0"],
    retainedMessageUids: [],
    messages: [record.message],
  });
  const committedAt = "2026-01-01T00:00:00.000Z";
  const request = {
    sessionDir,
    sessionId: "s1",
    expectedGeneration: head.generation,
    operationId: "legacy-cp-operation",
    changes: { summaryCheckpoints: [checkpoint] },
    committedAt,
  };
  const receipt = {
    checkpointId: checkpoint.checkpointId,
    checkpointRevision: 1,
    requestHash: checkpoint.requestHash,
    persistedMessageUids: ["m0"],
    summarizedMessageUids: ["m0"],
    retainedMessageUids: [],
    markedCount: 1,
    committedAt,
  };
  const evidence = {
    expectedGeneration: head.generation,
    input: { changes: request.changes, committedAt },
  };
  await store.transact({
    expectedGeneration: head.generation,
    operationId: request.operationId,
    input: evidence.input,
    prepare: async () => ({
      changes: [
        { collection: "messages", key: "m0", value: record },
        {
          collection: "checkpointHeads",
          key: checkpoint.turnScopeId,
          value: {
            turnScopeId: checkpoint.turnScopeId,
            dialogProcessId: checkpoint.dialogProcessId,
            checkpointRevision: receipt.checkpointRevision,
          },
        },
        {
          collection: "checkpointOrder",
          key: immutableCheckpointKey(
            checkpoint.turnScopeId,
            immutableOrderKey(receipt.checkpointRevision),
          ),
          value: checkpoint.checkpointId,
        },
        {
          collection: "checkpoints",
          key: immutableCheckpointKey("t0", checkpoint.checkpointId),
          value: receipt,
        },
      ],
      result: {
        summaryCheckpoints: [{ committed: true, markedCount: 1, checkpointRevision: 1, receipt }],
      },
    }),
  });
  const options = {
    base,
    backupBase: path.join(base, "backups"),
    created: false,
    scopedSessionRoots: [],
    targetStorageBudget: createTestPartitionStorageBudget(),
    storageService,
  };
  return { options, sessionDir, store, request, evidence };
}

export { fixture, migratedWorkspace, checkpointWorkspace };
