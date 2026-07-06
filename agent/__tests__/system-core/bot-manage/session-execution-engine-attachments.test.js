import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionExecutionEngine } from "../../../src/system-core/bot-manage/session/session-execution-engine.js";

test("_prepareAgentTurnExecution falls back to payload inputAttachments when prepared runtime has none", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine._buildContextBuilder = () => ({ kind: "context-builder" });
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return {
        agentContext: {
          runtime: {
            inputAttachments: [],
          },
        },
      };
    },
  };

  const prepared = await engine._prepareAgentTurnExecution({
    buildContextPayload: {
      userId: "admin",
      inputAttachments: [
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

test("_prepareAgentTurnExecution preserves explicit empty payload inputAttachments", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  engine._buildContextBuilder = () => ({ kind: "context-builder" });
  engine.agentRuntimeFacade = {
    async prepareTurnExecution() {
      return {
        agentContext: {
          runtime: {
            inputAttachments: [],
          },
        },
      };
    },
  };

  const prepared = await engine._prepareAgentTurnExecution({
    buildContextPayload: {
      userId: "admin",
      inputAttachments: [],
    },
  });

  assert.deepEqual(prepared.userMessageAttachments, []);
});

test("_prepareAgentTurnExecution enriches raw inputAttachments from scoped attachment index", async () => {
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
      return { agentContext: { runtime: { inputAttachments: [] } } };
    },
  };

  const prepared = await engine._prepareAgentTurnExecution({
    buildContextPayload: {
      userId: "admin",
      sessionId,
      inputAttachments: [
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
