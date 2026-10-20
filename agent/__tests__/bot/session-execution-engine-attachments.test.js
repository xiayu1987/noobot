/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionExecutionEngine } from "../../src/bot/session/session-execution-engine.js";

const CONTEXT_BUILDER = Object.freeze({ kind: "context-builder" });
const NON_RESUME_RUN_CONFIG = Object.freeze({ resumeFromStoppedSnapshot: false });

async function createAttachmentWorkspaceService() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-attach-workspace-"));
  return {
    async ensureUserWorkspace(userId) {
      const userWorkspace = path.join(workspaceRoot, userId);
      await mkdir(userWorkspace, { recursive: true });
      return userWorkspace;
    },
  };
}

test("_prepareAgentTurnExecution takes canonical payload attachments as the single source", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.workspaceService = await createAttachmentWorkspaceService();
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
      userId: "admin",
      sessionId: "session-payload-1",
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
      userId: "admin",
      userMessageAttachments: [],
    },
  });

  assert.deepEqual(prepared.userMessageAttachments, []);
});

test("_prepareAgentTurnExecution enriches raw userMessageAttachments from scoped attachment index", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-attach-index-"));
  const userWorkspace = path.join(workspaceRoot, "admin");
  const sessionId = "session-index-a";
  const indexDir = path.join(userWorkspace, "runtime/attach/scoped", sessionId, "user");
  await mkdir(indexDir, { recursive: true });
  await writeFile(
    path.join(indexDir, "attachments.json"),
    JSON.stringify({
      sessionId,
      attachmentSource: "user",
      attachments: {
        "att-rich": {
          schema: "noobot.attachment-record",
          version: 1,
          identity: { attachmentId: "att-rich", sessionId, attachmentSource: "user" },
          descriptor: {
            identity: { attachmentId: "att-rich", sessionId, attachmentSource: "user" },
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
      },
    }),
    "utf8",
  );

  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.globalConfig = { workspaceRoot };
  engine.workspaceService = {
    async ensureUserWorkspace(userId) {
      return path.join(workspaceRoot, userId);
    },
  };
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
      userId: "admin",
      sessionId,
      userMessageAttachments: [
        {
          attachmentId: "att-rich",
          sessionId,
          attachmentSource: "user",
          name: "AI 体系现状概览.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: 1407731,
        },
      ],
    },
  });

  assert.equal(prepared.userMessageAttachments.length, 1);
  const meta = prepared.userMessageAttachments[0];
  assert.equal(meta.attachmentId, "att-rich");
  assert.equal(meta.sessionId, sessionId);
  assert.equal(meta.path.includes("att-rich"), true);
  assert.equal(meta.relativePath.includes("att-rich"), true);
  assert.equal(meta.sandboxPath, "");
  assert.equal(meta.previewUrl, "");
  assert.equal(meta.downloadUrl, "");
  assert.equal(meta.parsedResult, undefined);
});

test("_prepareAgentTurnExecution fails closed when attachment enrichment has no WorkspaceService", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return { agentContext: { bindings: { runtime: { userMessageAttachments: [] } } } };
    },
  };

  await assert.rejects(
    engine._prepareAgentTurnExecution({
      buildContextPayload: {
        contextBuilder: CONTEXT_BUILDER,
        runConfig: NON_RESUME_RUN_CONFIG,
        persistenceScope: null,
        userId: "admin",
        sessionId: "session-missing-workspace-service",
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
    /attachment enrichment requires WorkspaceService/,
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
      userId: "admin",
      sessionId: "session-delete",
      turnScopeId: "turn-delete",
      userMessageAttachments: [],
    },
  });

  assert.deepEqual(prepared.userMessageAttachments, []);
});
