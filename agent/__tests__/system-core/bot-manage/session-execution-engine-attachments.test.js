import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionExecutionEngine } from "../../../src/system-core/bot-manage/session/session-execution-engine.js";

test("_prepareAgentTurnExecution falls back to payload userMessageAttachments when prepared runtime has none", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine._buildContextBuilder = () => ({ kind: "context-builder" });
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return {
        agentContext: {
          runtime: {
            userMessageAttachments: [],
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
          runtime: {
            userMessageAttachments: [],
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
  await writeFile(path.join(indexDir, "attachments.json"), JSON.stringify({
    sessionId,
    attachmentSource: "user",
    attachments: {
      "att-rich": {
        attachmentId: "att-rich",
        sessionId,
        attachmentSource: "user",
        name: "AI 体系现状概览.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 1407731,
        path: "/workspace/admin/runtime/attach/scoped/session-index-a/user/att-rich/AI 体系现状概览.docx",
        relativePath: "runtime/attach/scoped/session-index-a/user/att-rich/AI 体系现状概览.docx",
        sandboxPath: "/workspace/admin/runtime/attach/scoped/session-index-a/user/att-rich/AI 体系现状概览.docx",
        previewUrl: "/preview/att-rich",
        downloadUrl: "/download/att-rich",
        parsedResultUrl: "/download/parsed-rich",
        parsedResultName: "AI 体系现状概览.txt",
        parsedResultAttachmentId: "parsed-rich",
      },
    },
  }), "utf8");

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
      return { agentContext: { runtime: { userMessageAttachments: [] } } };
    },
  };

  const prepared = await engine._prepareAgentTurnExecution({
    buildContextPayload: {
      userId: "admin",
      sessionId,
      userMessageAttachments: [
        {
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
  assert.equal(meta.sandboxPath.includes("att-rich"), true);
  assert.equal(meta.previewUrl, "/preview/att-rich");
  assert.equal(meta.downloadUrl, "/download/att-rich");
  assert.equal(meta.parsedResultUrl, "/download/parsed-rich");
  assert.equal(meta.parsedResultAttachmentId, "parsed-rich");
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
    sandboxPath: "/workspace/admin/runtime/attach/scoped/session-existing-a/user/att-session-rich/需求说明.docx",
    previewUrl: "/preview/att-session-rich",
    downloadUrl: "/download/att-session-rich",
    parsedResultUrl: "/download/parsed-session-rich",
    parsedResultAttachmentId: "parsed-session-rich",
    parsedResult: { attachmentId: "parsed-session-rich", path: "/tmp/需求说明.txt" },
  };
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine._buildContextBuilder = () => ({ kind: "context-builder" });
  engine.session = {
    async findById() {
      return {
        messages: [
          { role: "user", turnScopeId: "turn-existing", dialogProcessId: "dp-existing", attachments: [richAttachment] },
        ],
      };
    },
  };
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return { agentContext: { runtime: { userMessageAttachments: [] } } };
    },
  };

  const prepared = await engine._prepareAgentTurnExecution({
    buildContextPayload: {
      userId: "admin",
      sessionId: "session-existing-a",
      turnScopeId: "turn-existing",
      dialogProcessId: "dp-existing",
      userMessageAttachments: [{ name: "需求说明.docx", mimeType: richAttachment.mimeType, size: 2048 }],
    },
  });

  assert.equal(prepared.userMessageAttachments.length, 1);
  assert.equal(prepared.userMessageAttachments[0].attachmentId, "att-session-rich");
  assert.equal(prepared.userMessageAttachments[0].path, richAttachment.path);
  assert.equal(prepared.userMessageAttachments[0].parsedResultUrl, "/download/parsed-session-rich");
  assert.equal(prepared.userMessageAttachments[0].parsedResultAttachmentId, "parsed-session-rich");
  assert.deepEqual(prepared.userMessageAttachments[0].parsedResult, richAttachment.parsedResult);
});

test("_prepareAgentTurnExecution does not restore old rich attachments when payload explicitly deletes all", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine._buildContextBuilder = () => ({ kind: "context-builder" });
  engine.session = {
    async findById() {
      return { messages: [{ role: "user", turnScopeId: "turn-delete", attachments: [{ attachmentId: "old", name: "old.txt" }] }] };
    },
  };
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return { agentContext: { runtime: { userMessageAttachments: [] } } };
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
