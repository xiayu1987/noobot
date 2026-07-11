import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionEngine } from "../../../src/system-core/bot-manage/session/session-execution-engine.js";

test("_prepareStoppedSnapshotResumeTurnExecution requires explicit stopped snapshot identity", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  const contextBuilder = {
    async _buildAgentContext() {
      throw new Error("snapshot identity validation should run before context build");
    },
  };

  await assert.rejects(
    () => engine._prepareStoppedSnapshotResumeTurnExecution({
      payload: {
        userId: "u1",
        sessionId: "s1",
        dialogProcessId: "dialog-current",
        turnScopeId: "turn-current",
        runConfig: {
          resumeFromStoppedSnapshot: true,
          resumeTurnScopeId: "turn-stopped",
          turnScopeId: "turn-current",
        },
      },
      contextBuilder,
    }),
    /stopped snapshot resume requires resumeDialogProcessId and resumeTurnScopeId/,
  );
});

test("_resolveStoppedResumeAttachments ingests raw attachments into the current session", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  const ingestCalls = [];
  const contextBuilder = {
    attachmentService: {
      async ingest(payload) {
        ingestCalls.push(payload);
        return [{
          attachmentId: "att-1",
          sessionId: payload.sessionId,
          name: "resume.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          path: "/workspace/resume.docx",
        }];
      },
    },
    _resolveRuntimeBasePath() {
      return "/workspace/u1";
    },
    _getEffectiveConfig() {
      return { attachments: { maxFileSize: 1024 } };
    },
  };

  const attachments = await engine._resolveStoppedResumeAttachments({
    contextBuilder,
    payload: {
      userId: "u1",
      sessionId: "s1",
      userMessageAttachments: [{ name: "resume.docx", type: "application/octet-stream" }],
    },
  });

  assert.equal(ingestCalls.length, 1);
  assert.equal(ingestCalls[0].sessionId, "s1");
  assert.deepEqual(attachments, [{
    attachmentId: "att-1",
    sessionId: "s1",
    name: "resume.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    path: "/workspace/resume.docx",
  }]);
});
