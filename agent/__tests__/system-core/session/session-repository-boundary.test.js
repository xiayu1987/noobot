import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { createSessionServices } from "../../../src/system-core/session/index.js";

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

    const longUserContent = `show attachment ${"user-long-content-".repeat(400)}`;
    const longAssistantContent = `final answer ${"assistant-long-content-".repeat(400)}`;
    const longWorkflowContent = `workflow final ${"workflow-long-content-".repeat(400)}`;

    const sessionB = await runtime.repositories.sessionRepository.findById(userId, "B", "A");
    sessionB.messages = [
      {
        id: "u1",
        role: "user",
        content: longUserContent,
        attachmentMetas: [{ id: "att-1", name: "a.txt", type: "text/plain", size: 12, raw: "large" }],
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
        role: "tool",
        type: "tool_result",
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
        content: longWorkflowContent,
        pluginMessage: true,
        pluginMeta: { pluginId: "p1", source: "plugin-test", kind: "flow", nodeName: "Done", internalState: { huge: true } },
        transferEnvelopes: [{ id: "tr-1", status: "done", payload: { huge: true } }],
      },
    ];
    await runtime.repositories.sessionRepository.save(userId, sessionB, "A");

    const scopeB = await runtime.repositories.sessionRepository.resolveSessionScope(userId, "B", "A");
    const summaryFile = path.join(scopeB.sessionDir, "session-summary.json");
    let summary = JSON.parse(await readFile(summaryFile, "utf8"));
    assert.equal(summary.schemaVersion, 1);
    assert.equal(summary.sessionId, "B");
    assert.equal(summary.messages.length, 3);
    assert.equal(summary.stats.messageCount, 6);
    assert.equal(summary.stats.displayMessageCount, 3);
    assert.equal(summary.stats.injectedMessageCount, 1);
    assert.equal(summary.stats.thinkingMessageCount, 1);
    assert.equal(summary.stats.attachmentCount, 1);
    assert.equal(summary.stats.toolLogCount, 3);
    assert.equal(summary.stats.displayToolLogCount, 1);
    assert.equal(summary.stats.hasToolDetails, true);
    assert.equal(summary.toolLogSummaries.length, 1);
    assert.equal(summary.toolLogSummaries[0].type, "tool_result");
    assert.deepEqual(summary.toolLogSummaries[0].writtenFiles, [{
      toolName: "write_file",
      resolvedPath: "/workspace/u1/project/a.txt",
      fileName: "a.txt",
      sourceType: "tool",
      recognized: false,
    }]);
    assert.equal(JSON.stringify(summary.toolLogSummaries).includes("ordinary tool result"), false);

    const userMessage = summary.messages.find((item) => item.id === "u1");
    assert.equal(userMessage.content, longUserContent);
    assert.deepEqual(userMessage.attachmentMetas, [
      { id: "att-1", name: "a.txt", type: "text/plain", size: 12, owner: "", url: "", previewUrl: "" },
    ]);
    const assistantMessage = summary.messages.find((item) => item.id === "a1");
    assert.equal(assistantMessage.content, longAssistantContent);
    assert.equal(assistantMessage.hasThinkingDetails, true);
    assert.equal(assistantMessage.thinkingDetailCount, 2);
    assert.equal("realtimeLogs" in assistantMessage, false);
    assert.equal("completedToolLogs" in assistantMessage, false);
    assert.equal("rawMessages" in assistantMessage, false);
    const workflowMessage = summary.messages.find((item) => item.id === "w1");
    assert.equal(workflowMessage.content, longWorkflowContent);
    assert.equal(workflowMessage.pluginMeta.source, "plugin-test");
    assert.equal(workflowMessage.pluginMeta.nodeName, "Done");
    assert.equal("internalState" in workflowMessage.pluginMeta, false);
    assert.equal("transferEnvelopes" in workflowMessage, true);
    assert.equal(Array.isArray(workflowMessage.transferEnvelopes), true);
    assert.equal(workflowMessage.transferEnvelopes[0].id, "tr-1");
    assert.equal("payload" in workflowMessage.transferEnvelopes[0], false);
    assert.equal(JSON.stringify(summary).includes("injected secret"), false);

    await writeFile(summaryFile, JSON.stringify({ schemaVersion: 0, sessionId: "wrong" }), "utf8");
    const displayData = await runtime.sessionCrudService.getSessionDisplayData({ userId, sessionId: "B" });
    assert.equal(displayData.summary, true);
    assert.equal(displayData.sessions.length, 1);
    assert.equal(displayData.sessions[0].depth, 2);
    assert.equal(displayData.sessions[0].toolLogSummaries.every((item) => item.depth === 2), true);
    summary = JSON.parse(await readFile(summaryFile, "utf8"));
    assert.equal(summary.schemaVersion, 1);
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
