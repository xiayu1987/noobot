/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

import { SessionExecutionEngine } from "../../src/bot/session/session-execution-engine.js";
import { prepareTurnInput } from "../../src/bot/session/turn-execution-preparer.js";
import { publishAttachmentCatalog } from "../../src/artifacts/index-manager.js";
import { AttachmentService } from "../../src/artifacts/service/attachment-service.js";

const CONTEXT_BUILDER = Object.freeze({ kind: "context-builder" });
const NON_RESUME_RUN_CONFIG = Object.freeze({ resumeFromStoppedSnapshot: false });

test("_prepareAgentTurnExecution takes canonical payload attachments as the single source", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return {
        agentContext: {
          bindings: {
            runtime: {
              userMessageAttachments: [],
            },
          },
        },
      };
    },
  };

  const prepared = await engine._prepareAgentTurnExecution({
    buildContextPayload: {
      contextBuilder: CONTEXT_BUILDER,
      runConfig: NON_RESUME_RUN_CONFIG,
      persistenceScope: null,
      runtimeIdentity: {
        userId: "admin",
        sessionId: "session-payload-1",
        parentSessionId: "",
        dialogProcessId: "dialog-test",
        turnScopeId: "turn-test",
        caller: SESSION_CALLER.USER,
      },
      userMessageAttachments: [
        {
          attachmentId: "att-payload-1",
          sessionId: "session-payload-1",
          attachmentSource: "user",
          name: "AI 体系现状概览.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: 1407731,
        },
      ],
    },
  });

  assert.equal(prepared.userMessageAttachments.length, 1);
  assert.equal(prepared.userMessageAttachments[0].name, "AI 体系现状概览.docx");
  assert.equal(
    prepared.userMessageAttachments[0].mimeType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(prepared.userMessageAttachments[0].size, 1407731);
});

test("_prepareAgentTurnExecution preserves explicit empty payload userMessageAttachments", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return {
        agentContext: {
          bindings: {
            runtime: {
              userMessageAttachments: [],
            },
          },
        },
      };
    },
  };

  const prepared = await engine._prepareAgentTurnExecution({
    buildContextPayload: {
      contextBuilder: CONTEXT_BUILDER,
      runConfig: NON_RESUME_RUN_CONFIG,
      persistenceScope: null,
      runtimeIdentity: {
        userId: "admin",
        sessionId: "session-empty-attachments",
        parentSessionId: "",
        dialogProcessId: "dialog-test",
        turnScopeId: "turn-test",
        caller: SESSION_CALLER.USER,
      },
      userMessageAttachments: [],
    },
  });

  assert.deepEqual(prepared.userMessageAttachments, []);
});

test("turn input reads stored metadata without reading attachment content", async (context) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-attach-index-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const userWorkspace = path.join(workspaceRoot, "admin");
  const sessionId = "session-index-a";
  const scope = { sessionId, attachmentSource: "user" };
  const identity = { ...scope, attachmentId: "att-rich" };
  await publishAttachmentCatalog(userWorkspace, scope, {
    migrationDigest: null,
    records: [
      {
        schema: "noobot.attachment-record",
        version: 1,
        identity,
        descriptor: {
          identity,
          name: "AI 体系现状概览.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: 1407731,
        },
        storageRef: {
          kind: "attachment-store",
          ref: "runtime/attach/scoped/session-index-a/user/att-rich/AI 体系现状概览.docx",
        },
        relations: [],
        createdAt: "2026-08-16T00:00:00.000Z",
        updatedAt: "2026-08-16T00:00:00.000Z",
      },
    ],
  });

  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return { agentContext: { bindings: { runtime: { userMessageAttachments: [] } } } };
    },
  };

  const buildContextPayload = {
    contextBuilder: CONTEXT_BUILDER,
    runConfig: NON_RESUME_RUN_CONFIG,
    persistenceScope: null,
    runtimeIdentity: {
      userId: "admin",
      sessionId,
      parentSessionId: "",
      dialogProcessId: "dialog-test",
      turnScopeId: "turn-test",
      caller: SESSION_CALLER.USER,
    },
    userMessageAttachments: [
      {
        attachmentId: "att-rich",
        sessionId,
        attachmentSource: "user",
        name: "stale.docx",
        path: "/untrusted.docx",
      },
    ],
  };
  const attachmentService = new AttachmentService({ workspaceRoot });
  Object.assign(
    buildContextPayload,
    await prepareTurnInput({ attachmentService, buildContextPayload }),
  );
  const prepared = await engine._prepareAgentTurnExecution({ buildContextPayload });

  assert.equal(prepared.userMessageAttachments.length, 1);
  const meta = prepared.userMessageAttachments[0];
  assert.equal(meta.attachmentId, "att-rich");
  assert.equal(meta.name, "AI 体系现状概览.docx");
  assert.equal(meta.sessionId, sessionId);
  assert.equal(meta.path.includes("att-rich"), true);
  assert.equal(meta.relativePath.includes("att-rich"), true);
  assert.equal(meta.sandboxPath, "");
  assert.equal(meta.previewUrl, "");
  assert.equal(meta.downloadUrl, "");
  assert.equal(meta.parsedResult, undefined);
});

test("turn input fails closed when the referenced attachment metadata is missing", async () => {
  await assert.rejects(
    prepareTurnInput({
      attachmentService: {
        async ingest() {
          assert.fail("existing attachment must not be ingested");
        },
        async readAttachmentMetadata() {
          return [null];
        },
      },
      buildContextPayload: {
        contextBuilder: CONTEXT_BUILDER,
        runConfig: NON_RESUME_RUN_CONFIG,
        persistenceScope: null,
        runtimeIdentity: {
          userId: "admin",
          sessionId: "session-missing-workspace-service",
          parentSessionId: "",
          dialogProcessId: "dialog-test",
          turnScopeId: "turn-test",
          caller: SESSION_CALLER.USER,
        },
        userMessageAttachments: [
          {
            attachmentId: "att-missing-workspace-service",
            sessionId: "session-missing-workspace-service",
            attachmentSource: "user",
            name: "input.txt",
          },
        ],
      },
    }),
    { code: "ATTACHMENT_METADATA_MISSING" },
  );
});

test("_prepareAgentTurnExecution keeps explicit empty payload attachments without session lookup", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return { agentContext: { bindings: { runtime: { userMessageAttachments: [] } } } };
    },
  };

  const prepared = await engine._prepareAgentTurnExecution({
    buildContextPayload: {
      contextBuilder: CONTEXT_BUILDER,
      runConfig: NON_RESUME_RUN_CONFIG,
      persistenceScope: null,
      runtimeIdentity: {
        userId: "admin",
        sessionId: "session-delete",
        parentSessionId: "",
        dialogProcessId: "dialog-test",
        turnScopeId: "turn-delete",
        caller: SESSION_CALLER.USER,
      },
      userMessageAttachments: [],
    },
  });

  assert.deepEqual(prepared.userMessageAttachments, []);
});
