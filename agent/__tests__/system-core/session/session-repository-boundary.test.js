import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { createSessionServices } from "../../../src/system-core/session/index.js";
import { writeSessionArtifact } from "../../../src/system-core/session/session-artifact-store.js";
import { buildSessionDisplaySummary } from "../../../src/system-core/session/session-summary-builders.js";

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "noobot-session-boundary-"),
  );
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("session display summary should keep canonical attachment fields", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "s-attachments",
    messages: [
      {
        role: "assistant",
        content: "canonical attachment",
        attachments: [{ attachmentId: "att-canonical", name: "canonical.txt", mimeType: "text/plain" }],
      },
      {
        role: "assistant",
        content: "legacy attachment ignored",
        attachments: [{ id: "att-legacy", name: "legacy.txt", type: "text/plain" }],
      },
    ],
  });

  assert.equal(summary.schemaVersion, 5);
  assert.equal(summary.messages[0].attachments[0].attachmentId, "att-canonical");
  assert.equal(summary.messages[0].attachments[0].name, "canonical.txt");
  assert.equal(summary.messages[1].attachments[0].attachmentId, "att-legacy");
  assert.equal(summary.stats.attachmentCount, 2);
});

test("session display summary keeps rich attachment fields for preview and parsed result", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "s-rich-attachments",
    messages: [
      {
        role: "user",
        content: "rich attachment",
        attachments: [
          {
            attachmentId: "att-rich",
            name: "report.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 123,
            sessionId: "s-rich-attachments",
            attachmentSource: "user",
            path: "/workspace/report.docx",
            relativePath: "runtime/attach/s-rich-attachments/user/report.docx",
            sandboxPath: "/sandbox/report.docx",
            previewUrl: "/api/attachments/att-rich/preview",
            downloadUrl: "/api/attachments/att-rich/download",
            parsedResult: {
              attachmentId: "att-parsed",
              name: "report.md",
              mimeType: "text/markdown",
              path: "/workspace/report.md",
              relativePath: "runtime/attach/s-rich-attachments/model/report.md",
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(summary.messages[0].attachments[0], {
    attachmentId: "att-rich",
    name: "report.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 123,
    attachmentSource: "user",
    sessionId: "s-rich-attachments",
    relativePath: "runtime/attach/s-rich-attachments/user/report.docx",
    sandboxPath: "/sandbox/report.docx",
    path: "/workspace/report.docx",
    parsedResult: {
      attachmentId: "att-parsed",
      name: "report.md",
      path: "/workspace/report.md",
      relativePath: "runtime/attach/s-rich-attachments/model/report.md",
      mimeType: "text/markdown",
    },
    url: "/api/attachments/att-rich/download",
    previewUrl: "/api/attachments/att-rich/preview",
  });
});

test("session display summary derives attachments from transfer envelopes", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "s-transfer-attachments",
    messages: [
      {
        role: "assistant",
        content: "transfer only attachment",
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            version: 1,
            direction: "output",
            transport: "file",
            files: [
              {
                role: "primary",
                filePath: "/workspace/result.md",
                attachmentMeta: {
                  attachmentId: "att-transfer-1",
                  sessionId: "s-transfer-attachments",
                  attachmentSource: "model",
                  name: "result.md",
                  mimeType: "text/markdown",
                  size: 44,
                  relativePath: "runtime/result.md",
                  owner: { type: "plugin", id: "harness-plugin" },
                },
                pathView: { sandboxPath: "/sandbox/result.md" },
              },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(summary.stats.attachmentCount, 1);
  assert.deepEqual(summary.messages[0].attachments, [
    {
      attachmentId: "att-transfer-1",
      name: "result.md",
      mimeType: "text/markdown",
      size: 44,
      attachmentSource: "model",
      sessionId: "s-transfer-attachments",
      relativePath: "runtime/result.md",
      sandboxPath: "/sandbox/result.md",
      path: "/workspace/result.md",
      owner: { type: "plugin", id: "harness-plugin" },
      role: "primary",
    },
  ]);
  assert.equal("id" in summary.messages[0].attachments[0], false);
  assert.equal("type" in summary.messages[0].attachments[0], false);
  assert.equal("source" in summary.messages[0].attachments[0], false);
  assert.equal(summary.messages[0].transferEnvelopes[0].files[0].attachmentId, "att-transfer-1");
  assert.equal(summary.messages[0].transferEnvelopes[0].files[0].owner.type, "plugin");
  assert.equal("attachmentMeta" in summary.messages[0].transferEnvelopes[0].files[0], false);
  assert.equal("pathView" in summary.messages[0].transferEnvelopes[0].files[0], false);
});

test("session artifact persistence should normalize attachment fields before writing", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const sessionDir = path.join(workspaceRoot, "u1", "runtime", "session", "s-attachments");
    const result = await writeSessionArtifact({
      sessionDir,
      depth: 1,
      now: () => "2026-05-14T00:00:00.000Z",
      sessionPayload: {
        sessionId: "s-attachments",
        caller: "user",
        messages: [
          {
            role: "user",
            content: "canonical survives",
            attachments: [
              {
                attachmentId: "att-canonical",
                name: "canonical.txt",
                mimeType: "text/plain",
              },
            ],
            attachmentMetas: [{ attachmentId: "att-legacy-meta" }],
            attachment_metas: [{ attachmentId: "att-legacy-snake" }],
          },
          {
            role: "assistant",
            content: "legacy only is ignored",
            attachmentMetas: [{ attachmentId: "att-legacy-only" }],
            attachment_metas: [{ attachmentId: "att-legacy-only-snake" }],
          },
        ],
      },
    });

    const persistedSession = JSON.parse(await readFile(result.files.session, "utf8"));
    const persistedSummary = JSON.parse(await readFile(result.files.sessionSummary, "utf8"));
    const sessionJson = JSON.stringify(persistedSession);
    const summaryJson = JSON.stringify(persistedSummary);

    assert.equal(persistedSession.messages[0].attachments[0].attachmentId, "att-canonical");
    assert.equal("attachments" in persistedSession.messages[1], false);
    assert.equal(sessionJson.includes("attachmentMetas"), false);
    assert.equal(sessionJson.includes("attachment_metas"), false);
    assert.equal(persistedSummary.depth, 1);
    assert.equal(persistedSummary.messages[0].attachments[0].attachmentId, "att-canonical");
    assert.equal("attachments" in persistedSummary.messages[1], false);
    assert.equal(summaryJson.includes("attachmentMetas"), false);
    assert.equal(summaryJson.includes("attachment_metas"), false);
  });
});

test("session/task/execution repositories should keep file ownership boundaries", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "s1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });

    const runtime = createSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    await runtime.sessionCrudService.ensureSession(userId, sessionId);

    const sessionScope = await runtime.repositories.sessionRepository.resolveSessionScope(
      userId,
      sessionId,
    );

    assert.equal(await exists(sessionScope.sessionFile), true);
    assert.equal(await exists(sessionScope.taskFile), false);
    assert.equal(await exists(sessionScope.executionFile), false);

    await runtime.repositories.taskRepository.save(userId, sessionId, {
      taskId: "t1",
      taskName: "task-1",
      taskStatus: "start",
    });
    assert.equal(await exists(sessionScope.taskFile), true);

    await runtime.repositories.executionRepository.appendLog(
      userId,
      sessionId,
      { event: "start", dialogProcessId: "dp-1" },
    );
    assert.equal(await exists(sessionScope.executionFile), true);
    const executionEventsFile = path.join(sessionScope.sessionDir, "execution.jsonl");
    assert.equal(await exists(executionEventsFile), true);

    const taskBundle = JSON.parse(await readFile(sessionScope.taskFile, "utf8"));
    assert.equal(taskBundle.currentTaskId, "t1");
    const executionBundle = JSON.parse(
      await readFile(sessionScope.executionFile, "utf8"),
    );
    assert.equal("logs" in executionBundle, false);
    assert.equal(executionBundle.dialogProcessId, "dp-1");
    const executionEvents = (await readFile(executionEventsFile, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(executionEvents.length, 1);
    assert.equal(executionEvents[0].event, "start");
    assert.equal(executionEvents[0].dialogProcessId, "dp-1");
    const restoredBundle = await runtime.repositories.executionRepository.getBundle(userId, sessionId);
    assert.equal(restoredBundle.dialogProcessId, "dp-1");
    assert.equal(restoredBundle.logs.length, 1);
    assert.equal(restoredBundle.logs[0].event, "start");
    assert.equal(restoredBundle.logs[0].dialogProcessId, "dp-1");
  });
});

test("deleteSessionBranch should remove descendant directories and tree nodes", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });

    const runtime = createSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "A" });
    await runtime.sessionCrudService.ensureSession(userId, "A", "");

    await runtime.sessionTreeService.upsertSessionTree({
      userId,
      sessionId: "B",
      parentSessionId: "A",
    });
    await runtime.sessionCrudService.ensureSession(userId, "B", "A");

    await runtime.sessionTreeService.upsertSessionTree({
      userId,
      sessionId: "C",
      parentSessionId: "B",
    });
    await runtime.sessionCrudService.ensureSession(userId, "C", "B");

    const scopeA = await runtime.repositories.sessionRepository.resolveSessionScope(userId, "A", "");
    const scopeB = await runtime.repositories.sessionRepository.resolveSessionScope(userId, "B", "A");
    const scopeC = await runtime.repositories.sessionRepository.resolveSessionScope(userId, "C", "B");

    const result = await runtime.sessionTreeService.deleteSessionBranch({
      userId,
      sessionId: "B",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.deletedSessionIds.sort(), ["B", "C"]);
    assert.equal(await exists(scopeA.sessionFile), true);
    assert.equal(await exists(scopeB.sessionFile), false);
    assert.equal(await exists(scopeC.sessionFile), false);

    const tree = await runtime.sessionTreeService.getSessionTree({ userId });
    assert.equal(Boolean(tree.nodes.A), true);
    assert.equal(Boolean(tree.nodes.B), false);
    assert.equal(Boolean(tree.nodes.C), false);
    assert.deepEqual(tree.nodes.A.children, []);

    const summary = await runtime.repositories.sessionRepository.readSessionsSummary(userId);
    assert.deepEqual(summary.sessions.map((item) => item.sessionId), ["A"]);
  });
});

test("session summaries should be maintained and rebuilt for list API", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });

    const runtime = createSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "A" });
    await runtime.sessionCrudService.ensureSession(userId, "A", "");
    await runtime.sessionTreeService.upsertSessionTree({
      userId,
      sessionId: "B",
      parentSessionId: "A",
    });
    await runtime.sessionCrudService.ensureSession(userId, "B", "A");

    const sessionB = await runtime.repositories.sessionRepository.findById(userId, "B", "A");
    sessionB.messages = [
      { role: "system", content: "ignored" },
      { role: "user", content: "1234567890123456789012345" },
      { role: "assistant", content: "done", attachmentMetas: [{ id: "big" }] },
    ];
    sessionB.currentTaskId = "task-b";
    await runtime.repositories.sessionRepository.save(userId, sessionB, "A");

    let summary = await runtime.repositories.sessionRepository.readSessionsSummary(userId);
    const writtenB = summary.sessions.find((item) => item.sessionId === "B");
    assert.equal(writtenB.title, "12345678901234567890");
    assert.equal(writtenB.messageCount, 3);
    assert.equal(writtenB.depth, 0);
    assert.equal(Array.isArray(writtenB.messages), false);
    assert.equal(writtenB.lastMessage.role, "assistant");
    assert.equal("attachmentMetas" in writtenB.lastMessage, false);

    const list = await runtime.sessionCrudService.getAllSessionSummaries({ userId });
    const listedB = list.find((item) => item.sessionId === "B");
    assert.equal(list.length, 2);
    assert.equal(listedB.depth, 2);
    assert.equal("messages" in listedB, false);

    summary = JSON.parse(
      await readFile(path.join(workspaceRoot, userId, "runtime", "session", "sessions.json"), "utf8"),
    );
    assert.equal(summary.sessions.find((item) => item.sessionId === "B").depth, 2);
  });
});

test("renameSession should persist custom title to full, display summary and sessions summary", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });

    const runtime = createSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T01:02:03.000Z" },
    );

    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "A" });
    await runtime.sessionCrudService.ensureSession(userId, "A", "");
    const session = await runtime.repositories.sessionRepository.findById(userId, "A", "");
    session.messages = [{ role: "user", content: "old generated title" }];
    await runtime.repositories.sessionRepository.save(userId, session, "");

    const renamed = await runtime.sessionCrudService.renameSession({
      userId,
      sessionId: "A",
      title: "  新会话名称  ",
    });

    assert.equal(renamed.customTitle, "新会话名称");
    assert.equal(renamed.updatedAt, "2026-05-14T01:02:03.000Z");

    const scope = await runtime.repositories.sessionRepository.resolveSessionScope(userId, "A", "");
    const full = JSON.parse(await readFile(scope.sessionFile, "utf8"));
    const displaySummary = JSON.parse(await readFile(path.join(scope.sessionDir, "session-summary.json"), "utf8"));
    const sessionsSummary = JSON.parse(
      await readFile(path.join(workspaceRoot, userId, "runtime", "session", "sessions.json"), "utf8"),
    );

    assert.equal(full.customTitle, "新会话名称");
    assert.equal(displaySummary.title, "新会话名称");
    assert.equal(sessionsSummary.sessions.find((item) => item.sessionId === "A").title, "新会话名称");
  });
});

test("renameSession should validate title and return null for missing session", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });

    await assert.rejects(
      () => runtime.sessionCrudService.renameSession({ userId, sessionId: "missing", title: "   " }),
      /Session title is required/,
    );

    const result = await runtime.sessionCrudService.renameSession({
      userId,
      sessionId: "missing",
      title: "new title",
    });
    assert.equal(result, null);
  });
});

test("session display summary should keep chat view lightweight and rebuild stale files", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });

    const runtime = createSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId: "A" });
    await runtime.sessionCrudService.ensureSession(userId, "A", "");
    await runtime.sessionTreeService.upsertSessionTree({
      userId,
      sessionId: "B",
      parentSessionId: "A",
    });
    await runtime.sessionCrudService.ensureSession(userId, "B", "A");

    const userContentTail = "__USER_CONTENT_COMPLETE_TAIL__";
    const assistantContentTail = "__ASSISTANT_CONTENT_COMPLETE_TAIL__";
    const workflowContentTail = "__WORKFLOW_CONTENT_COMPLETE_TAIL__";
    const longUserContent = `show attachment ${"user-long-content-".repeat(400)}${userContentTail}`;
    const longAssistantContent = `final answer ${"assistant-long-content-".repeat(400)}${assistantContentTail}`;
    const longWorkflowContent = `workflow final ${"workflow-long-content-".repeat(400)}${workflowContentTail}`;
    const workflowTransferEnvelope = {
      protocol: "noobot.semantic-transfer",
      version: 1,
      direction: "output",
      transport: "file",
      payload: { huge: true },
      files: [
        {
          role: "primary",
          filePath: "/workspace/u1/runtime/workflow-result.md",
          attachmentMeta: {
            attachmentId: "att-workflow-1",
            sessionId: "B",
            attachmentSource: "model",
            name: "workflow-result.md",
            mimeType: "text/markdown",
            size: 321,
            path: "/host/workflow-result.md",
            relativePath: "runtime/workflow-result.md",
          },
          pathView: {
            displayPath: "/workspace/u1/runtime/workflow-result.md",
            sandboxPath: "/sandbox/u1/runtime/workflow-result.md",
            relativePath: "runtime/workflow-result.md",
            hostPath: "/host/workflow-result.md",
          },
        },
      ],
    };

    const sessionB = await runtime.repositories.sessionRepository.findById(userId, "B", "A");
    sessionB.messages = [
      {
        id: "u1",
        role: "user",
        turnScopeId: "turn-scope-u1",
        content: longUserContent,
        attachments: [{ id: "att-1", name: "a.txt", type: "text/plain", size: 12, raw: "large" }],
      },
      {
        id: "i1",
        role: "system",
        injectedMessage: true,
        content: "injected secret should not be in summary",
      },
      {
        id: "a1",
        role: "assistant",
        content: longAssistantContent,
        realtimeLogs: [{ event: "thinking", text: "full thinking" }],
        completedToolLogs: [{ event: "tool", text: "full tool detail" }],
        tool_calls: [{ id: "call-1", function: { name: "read_file", arguments: { path: "/tmp/a" } } }],
        rawMessages: [{ role: "assistant", content: "raw" }],
      },
      {
        id: "plugin-attachment-assistant",
        role: "assistant",
        turnScopeId: "turn-scope-plugin",
        content: "plugin attachment result",
        attachments: [
          {
            attachmentId: "att-plugin-1",
            sessionId: "B",
            attachmentSource: "model",
            name: "harness-plan-text.txt",
            mimeType: "text/plain",
            size: 123,
            owner: { type: "plugin", id: "harness-plugin" },
            generationSource: "harness_plan",
          },
        ],
      },
      {
        role: "tool",
        type: "tool_result",
        turnScopeId: "turn-scope-u1",
        tool_call_id: "call-1",
        content: JSON.stringify({
          toolName: "write_file",
          state: "OK",
          resolvedPath: "/workspace/u1/project/a.txt",
          fileName: "a.txt",
        }),
      },
      {
        role: "tool",
        type: "tool_result",
        tool_call_id: "call-2",
        content: "ordinary tool result should not be in summary".repeat(20),
      },
      {
        id: "w1",
        role: "assistant",
        type: "workflow",
        content: longWorkflowContent,
        pluginMessage: true,
        pluginMeta: {
          pluginId: "p1",
          source: "workflow-plugin",
          kind: "workflow",
          phase: "final",
          nodeName: "Done",
          internalState: { huge: true },
          payload: {
            semantic: {
              nodes: [
                { id: "start", type: "state", stateType: "start", name: "Start" },
                { id: "act", type: "action", name: "Action", task: "Do work" },
              ],
              flowtos: [{ from: "start", to: "act", extra: { keep: true } }],
            },
            execution: {
              completed: true,
              status: "success",
              nodeAgentRuns: [
                {
                  stepId: "step-act",
                  nodeDialogId: "dialog-act",
                  nodeSessionId: "session-act",
                  stepStatus: "success",
                  step: { nodeId: "act", nodeName: "Action", type: "action" },
                  nodeResultTransferEnvelopes: [workflowTransferEnvelope],
                  nodeResultText: "large node result should be dropped".repeat(80),
                },
              ],
            },
            nodeSessions: [
              {
                nodeId: "act",
                nodeName: "Action",
                dialogId: "dialog-act",
                sessionId: "session-act",
                stepStatus: "success",
                transferEnvelopes: [workflowTransferEnvelope],
                nodeResultText: "large node session result should be dropped".repeat(80),
              },
            ],
            diagnostics: { huge: "debug detail should be dropped" },
          },
        },
        transferEnvelopes: [workflowTransferEnvelope],
      },
      {
        id: "u2",
        role: "user",
        type: "message",
        dialogProcessId: "dp-tool-only",
        content: "run tool only thinking details",
      },
      {
        id: "tool-display-assistant",
        role: "assistant",
        type: "message",
        dialogProcessId: "dp-tool-only",
        content: "tool only final answer",
      },
      {
        role: "assistant",
        type: "tool_call",
        dialogProcessId: "dp-tool-only",
        tool_calls: [
          { id: "call-tool-only", function: { name: "search", arguments: { q: "demo" } } },
        ],
      },
      {
        role: "tool",
        type: "tool_result",
        dialogProcessId: "dp-tool-only",
        tool_call_id: "call-tool-only",
        content: "tool only result detail should not be in summary",
      },
    ];
    await runtime.repositories.sessionRepository.save(userId, sessionB, "A");

    const scopeB = await runtime.repositories.sessionRepository.resolveSessionScope(userId, "B", "A");
    const summaryFile = path.join(scopeB.sessionDir, "session-summary.json");
    const persistedSession = JSON.parse(await readFile(scopeB.sessionFile, "utf8"));
    assert.equal(persistedSession.messages.every((item) => "turnScopeId" in item), true);
    let summary = JSON.parse(await readFile(summaryFile, "utf8"));
    assert.equal(summary.schemaVersion, 5);
    assert.equal(summary.sessionId, "B");
    assert.equal(summary.messages.length, 6);
    assert.equal(summary.messages.every((item) => "turnScopeId" in item), true);
    assert.equal(summary.stats.messageCount, 11);
    assert.equal(summary.stats.displayMessageCount, 6);
    assert.equal(summary.stats.injectedMessageCount, 1);
    assert.equal(summary.stats.thinkingMessageCount, 2);
    assert.equal(summary.stats.attachmentCount, 3);
    assert.equal(summary.stats.toolLogCount, 5);
    assert.equal(summary.stats.displayToolLogCount, 1);
    assert.equal(summary.stats.hasToolDetails, true);
    assert.equal(summary.toolLogSummaries.length, 1);
    assert.equal(summary.toolLogSummaries[0].type, "tool_result");
    assert.equal(summary.toolLogSummaries[0].turnScopeId, "turn-scope-u1");
    assert.deepEqual(summary.toolLogSummaries[0].writtenFiles, [{
      toolName: "write_file",
      resolvedPath: "/workspace/u1/project/a.txt",
      fileName: "a.txt",
      sourceType: "tool",
      recognized: false,
    }]);
    assert.equal(JSON.stringify(summary.toolLogSummaries).includes("ordinary tool result"), false);

    const userMessage = summary.messages.find((item) => item.id === "u1");
    assert.equal(userMessage.turnScopeId, "turn-scope-u1");
    assert.equal(userMessage.content, longUserContent);
    assert.equal(userMessage.content.endsWith(userContentTail), true);
    assert.equal(userMessage.content.includes(`${userContentTail}…`), false);
    assert.deepEqual(userMessage.attachments, [
      {
        attachmentId: "att-1",
        name: "a.txt",
        mimeType: "text/plain",
        size: 12,
      },
    ]);
    assert.equal("id" in userMessage.attachments[0], false);
    assert.equal("type" in userMessage.attachments[0], false);
    assert.equal("source" in userMessage.attachments[0], false);
    const assistantMessage = summary.messages.find((item) => item.id === "a1");
    assert.equal(assistantMessage.content, longAssistantContent);
    assert.equal(assistantMessage.content.endsWith(assistantContentTail), true);
    assert.equal(assistantMessage.content.includes(`${assistantContentTail}…`), false);
    assert.equal(assistantMessage.hasThinkingDetails, true);
    assert.equal(assistantMessage.thinkingDetailCount, 2);
    assert.equal("realtimeLogs" in assistantMessage, false);
    assert.equal("completedToolLogs" in assistantMessage, false);
    assert.equal("rawMessages" in assistantMessage, false);
    const pluginAttachmentAssistant = summary.messages.find((item) => item.id === "plugin-attachment-assistant");
    assert.deepEqual(pluginAttachmentAssistant.attachments, [
      {
        attachmentId: "att-plugin-1",
        name: "harness-plan-text.txt",
        mimeType: "text/plain",
        size: 123,
        attachmentSource: "model",
        sessionId: "B",
        owner: { type: "plugin", id: "harness-plugin" },
        generationSource: "harness_plan",
      },
    ]);
    assert.equal("id" in pluginAttachmentAssistant.attachments[0], false);
    assert.equal("type" in pluginAttachmentAssistant.attachments[0], false);
    assert.equal("source" in pluginAttachmentAssistant.attachments[0], false);
    const toolOnlyAssistantMessage = summary.messages.find((item) => item.id === "tool-display-assistant");
    assert.equal(toolOnlyAssistantMessage.content, "tool only final answer");
    assert.equal(toolOnlyAssistantMessage.hasThinkingDetails, true);
    assert.equal(toolOnlyAssistantMessage.thinkingDetailCount, 2);
    assert.equal("realtimeLogs" in toolOnlyAssistantMessage, false);
    assert.equal("completedToolLogs" in toolOnlyAssistantMessage, false);
    assert.equal(JSON.stringify(summary.messages).includes("tool only result detail"), false);
    const workflowMessage = summary.messages.find((item) => item.id === "w1");
    assert.equal(workflowMessage.content, longWorkflowContent);
    assert.equal(workflowMessage.content.endsWith(workflowContentTail), true);
    assert.equal(workflowMessage.content.includes(`${workflowContentTail}…`), false);
    assert.equal(workflowMessage.pluginMeta.source, "workflow-plugin");
    assert.equal(workflowMessage.pluginMeta.nodeName, "Done");
    assert.equal("internalState" in workflowMessage.pluginMeta, false);
    assert.equal(workflowMessage.pluginMeta.payload.execution.completed, true);
    assert.equal(workflowMessage.pluginMeta.payload.execution.status, "success");
    assert.equal(workflowMessage.pluginMeta.payload.execution.nodeAgentRuns[0].stepStatus, "success");
    assert.equal(workflowMessage.pluginMeta.payload.execution.nodeAgentRuns[0].step.nodeId, "act");
    assert.equal(workflowMessage.pluginMeta.payload.nodeSessions[0].stepStatus, "success");
    assert.equal(workflowMessage.pluginMeta.payload.nodeSessions[0].nodeId, "act");
    assert.equal(workflowMessage.pluginMeta.payload.semantic.nodes.length, 2);
    assert.equal("nodeResultText" in workflowMessage.pluginMeta.payload.execution.nodeAgentRuns[0], false);
    assert.equal("nodeResultText" in workflowMessage.pluginMeta.payload.nodeSessions[0], false);
    assert.equal("diagnostics" in workflowMessage.pluginMeta.payload, false);
    assert.equal("transferEnvelopes" in workflowMessage, true);
    assert.equal(Array.isArray(workflowMessage.transferEnvelopes), true);
    assert.equal(workflowMessage.transferEnvelopes[0].protocol, "noobot.semantic-transfer");
    assert.equal("filePath" in workflowMessage.transferEnvelopes[0], false);
    assert.equal(workflowMessage.transferEnvelopes[0].files[0].attachmentId, "att-workflow-1");
    assert.equal(workflowMessage.transferEnvelopes[0].files[0].sandboxPath, "/sandbox/u1/runtime/workflow-result.md");
    assert.equal(workflowMessage.attachments[0].attachmentId, "att-workflow-1");
    assert.equal(workflowMessage.attachments[0].relativePath, "runtime/workflow-result.md");
    assert.equal("payload" in workflowMessage.transferEnvelopes[0], false);
    assert.equal("attachmentMeta" in workflowMessage.transferEnvelopes[0].files[0], false);
    assert.equal("pathView" in workflowMessage.transferEnvelopes[0].files[0], false);
    assert.equal(
      workflowMessage.pluginMeta.payload.execution.nodeAgentRuns[0].nodeResultTransferEnvelopes[0].files[0].attachmentId,
      "att-workflow-1",
    );
    assert.equal(
      workflowMessage.pluginMeta.payload.nodeSessions[0].transferEnvelopes[0].files[0].attachmentId,
      "att-workflow-1",
    );
    assert.equal(JSON.stringify(summary).includes("injected secret"), false);

    await writeFile(summaryFile, JSON.stringify({ schemaVersion: 4, sessionId: "B", depth: 2, messages: [] }), "utf8");
    const displayData = await runtime.sessionCrudService.getSessionDisplayData({ userId, sessionId: "B" });
    assert.equal(displayData.summary, true);
    assert.equal(displayData.sessions.length, 1);
    assert.equal(displayData.sessions[0].depth, 2);
    assert.equal(displayData.sessions[0].toolLogSummaries.every((item) => item.depth === 2), true);
    summary = JSON.parse(await readFile(summaryFile, "utf8"));
    assert.equal(summary.schemaVersion, 5);
    assert.equal(summary.sessionId, "B");
    assert.equal(summary.depth, 2);
  });
});

test("appendTurn should not recreate session after deletion marker is set", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "race-session";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });

    const runtime = createSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    await runtime.sessionCrudService.ensureSession(userId, sessionId);
    const scope = await runtime.repositories.sessionRepository.resolveSessionScope(userId, sessionId);
    assert.equal(await exists(scope.sessionFile), true);

    await runtime.sessionTreeService.deleteSessionBranch({ userId, sessionId });
    assert.equal(await exists(scope.sessionFile), false);

    await runtime.sessionMessageService.appendTurn({
      userId,
      sessionId,
      role: "assistant",
      content: "late async write",
    });

    assert.equal(await exists(scope.sessionFile), false);
  });
});
