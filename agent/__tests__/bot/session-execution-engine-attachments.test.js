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

test("_prepareAgentTurnExecution uses canonical payload attachments when prepared runtime has none", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.workspaceService = await createAttachmentWorkspaceService();
  engine._buildContextBuilder = () => ({ kind: "context-builder" });
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
      userId: "admin",
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
  engine._buildContextBuilder = () => ({ kind: "context-builder" });
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
  engine._buildContextBuilder = () => ({ kind: "context-builder" });
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return { agentContext: { bindings: { runtime: { userMessageAttachments: [] } } } };
    },
  };

  const prepared = await engine._prepareAgentTurnExecution({
    buildContextPayload: {
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

test("_prepareAgentTurnExecution enriches raw resend payload from existing session message attachments", async () => {
  const richAttachment = {
    attachmentId: "att-session-rich",
    sessionId: "session-existing-a",
    attachmentSource: "user",
    name: "需求说明.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 2048,
    path: "/workspace/admin/runtime/attach/scoped/session-existing-a/user/att-session-rich/需求说明.docx",
    relativePath: "runtime/attach/scoped/session-existing-a/user/att-session-rich/需求说明.docx",
    sandboxPath:
      "/workspace/admin/runtime/attach/scoped/session-existing-a/user/att-session-rich/需求说明.docx",
    previewUrl: "/preview/att-session-rich",
    downloadUrl: "/download/att-session-rich",
  };
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine.workspaceService = await createAttachmentWorkspaceService();
  engine._buildContextBuilder = () => ({ kind: "context-builder" });
  engine.session = {
    async findById() {
      return {
        messages: [
          {
            role: "user",
            turnScopeId: "turn-existing",
            dialogProcessId: "dp-existing",
            attachments: [richAttachment],
          },
        ],
      };
    },
  };
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return { agentContext: { bindings: { runtime: { userMessageAttachments: [] } } } };
    },
  };

  const prepared = await engine._prepareAgentTurnExecution({
    buildContextPayload: {
      userId: "admin",
      sessionId: "session-existing-a",
      turnScopeId: "turn-existing",
      dialogProcessId: "dp-existing",
      userMessageAttachments: [
        {
          attachmentId: richAttachment.attachmentId,
          sessionId: richAttachment.sessionId,
          attachmentSource: richAttachment.attachmentSource,
          name: "需求说明.docx",
          mimeType: richAttachment.mimeType,
          size: 2048,
        },
      ],
    },
  });

  assert.equal(prepared.userMessageAttachments.length, 1);
  assert.equal(prepared.userMessageAttachments[0].attachmentId, "att-session-rich");
  assert.equal(prepared.userMessageAttachments[0].path, richAttachment.path);
});

test("_prepareAgentTurnExecution fails closed when attachment enrichment has no WorkspaceService", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine._buildContextBuilder = () => ({ kind: "context-builder" });
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return { agentContext: { bindings: { runtime: { userMessageAttachments: [] } } } };
    },
  };

  await assert.rejects(
    engine._prepareAgentTurnExecution({
      buildContextPayload: {
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

test("_prepareAgentTurnExecution does not restore old rich attachments when payload explicitly deletes all", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine._buildContextBuilder = () => ({ kind: "context-builder" });
  engine.session = {
    async findById() {
      return {
        messages: [
          {
            role: "user",
            turnScopeId: "turn-delete",
            attachments: [{ attachmentId: "old", name: "old.txt" }],
          },
        ],
      };
    },
  };
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return { agentContext: { bindings: { runtime: { userMessageAttachments: [] } } } };
    },
  };

  const prepared = await engine._prepareAgentTurnExecution({
    buildContextPayload: {
      userId: "admin",
      sessionId: "session-delete",
      turnScopeId: "turn-delete",
      userMessageAttachments: [],
    },
  });

  assert.deepEqual(prepared.userMessageAttachments, []);
});
