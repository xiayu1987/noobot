/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION, TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { createTestSessionServices, provisionTestSession } from "../helpers/session-services.js";
import { readSessionArtifact } from "../../src/session/session-artifact-store.js";
import { SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION } from "../../src/session/session-summary-builders.js";
import {
  withTempWorkspace,
  canonicalActivity,
  canonicalMessages,
} from "./session-repository-boundary.summaries.fixtures.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { applySessionMessageFacts } from "../helpers/session-message-facts.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

test("session display summary should keep chat view lightweight and rebuild stale files", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);

    const runtime = createTestSessionServices(
      { workspaceRoot },
      { now: () => "2026-05-14T00:00:00.000Z" },
    );

    await provisionTestSession(runtime, {
      userId,
      sessionId: "A",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "B",
      parentSessionId: "A",
      caller: SESSION_CALLER.USER,
    });

    const userContentTail = "__USER_CONTENT_COMPLETE_TAIL__";
    const assistantContentTail = "__ASSISTANT_CONTENT_COMPLETE_TAIL__";
    const workflowContentTail = "__WORKFLOW_CONTENT_COMPLETE_TAIL__";
    const longUserContent = `show attachment ${"user-long-content-".repeat(400)}${userContentTail}`;
    const longAssistantContent = `final answer ${"assistant-long-content-".repeat(400)}${assistantContentTail}`;
    const longWorkflowContent = `workflow final ${"workflow-long-content-".repeat(400)}${workflowContentTail}`;
    const workflowTransferEnvelope = {
      protocol: "noobot.semantic-transfer",
      version: TRANSFER_VERSION,
      transferId: "transfer:sm-workflow-final:plugin:workflow-node:output:workflow:result",
      presentationMessageId: "sm-workflow-final",
      identity: {
        sessionId: "B",
        turnScopeId: "turn-workflow",
        runId: "run-workflow",
        producer: { type: "plugin", id: "workflow-node" },
      },
      direction: "output",
      payload: {
        mode: "attachment",
        attachments: [
          {
            identity: { attachmentId: "att-workflow-1", sessionId: "B", attachmentSource: "model" },
            role: "primary",
            name: "workflow-result.md",
            mimeType: "text/markdown",
            size: 321,
          },
        ],
      },
      intent: {
        source: "plugin",
        reason: TRANSFER_REASON.HARNESS_SUMMARY,
        scenario: "harness",
        strategy: "harness_summary",
      },
      meta: { persisted: true },
    };

    const sessionB = await runtime.repositories.sessionRepository.findById(userId, "B", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "B",
      ),
    });
    sessionB.messages = canonicalMessages(
      [
        {
          userMessageId: "u1",
          messageUid: "sm-u1",
          role: "user",
          turnScopeId: "turn-scope-u1",
          dialogProcessId: "dp-u1",
          content: longUserContent,
          attachments: [
            {
              attachmentId: "att-1",
              sessionId: "B",
              attachmentSource: "user",
              name: "a.txt",
              mimeType: "text/plain",
              size: 12,
            },
          ],
        },
        {
          role: "system",
          injectedMessage: true,
          content: "injected secret should not be in summary",
        },
        {
          modelMessageId: "a1",
          presentationMessageId: "a1",
          role: "assistant",
          turnScopeId: "turn-scope-u1",
          dialogProcessId: "dp-u1",
          content: longAssistantContent,
          activityTimeline: [
            canonicalActivity({
              eventId: "activity-1",
              text: "full thinking",
              sequenceScopeId: "a1",
              sessionId: "A",
              dialogProcessId: "dp-u1",
              turnScopeId: "turn-scope-u1",
              presentationMessageId: "a1",
            }),
          ],
          toolTimeline: [
            {
              key: "call:call-1",
              toolCallId: "call-1",
              status: "completed",
              call: { eventId: "tool-call-1" },
              resultEvent: { eventId: "tool-result-1" },
            },
          ],
          tool_calls: [
            { id: "call-1", function: { name: "write_file", arguments: { path: "/tmp/a" } } },
          ],
          rawMessages: [
            {
              role: "assistant",
              presentationMessageId: "pm_fx1",
              modelMessageId: "mm_session_repository_bound_1",
              content: "raw",
            },
          ],
        },
        {
          modelMessageId: "plugin-attachment-assistant",
          role: "assistant",
          presentationMessageId: "pm_fx2",
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
          presentationMessageId: "pm_fx3",
          type: "tool_result",
          turnScopeId: "turn-scope-u1",
          dialogProcessId: "dp-u1",
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
          presentationMessageId: "pm_fx4",
          type: "tool_result",
          tool_call_id: "call-2",
          content: "ordinary tool result should not be in summary".repeat(20),
        },
        {
          modelMessageId: "w1",
          role: "assistant",
          type: "workflow",
          turnScopeId: "turn-scope-workflow",
          presentationMessageId: "w1",
          chatPresentation: true,
          content: longWorkflowContent,
          activityTimeline: [
            canonicalActivity({
              eventId: "workflow-activity-1",
              activityKind: "workflow_semantic",
              text: "workflow semantic response",
              sequenceScopeId: "w1",
              sessionId: "A",
              turnScopeId: "turn-scope-workflow",
              presentationMessageId: "w1",
            }),
          ],
          pluginMessage: true,
          pluginMeta: {
            pluginId: "p1",
            source: "workflow-plugin",
            kind: "workflow",
            phase: "final",
            nodeName: "Done",
            internalState: { huge: true },
            payload: {
              workflowRunId: "workflow-run-1",
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
                    nodeSessionId: "session-act",
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
                  dialogProcessId: "dialog-act",
                  sessionId: "session-act",
                  status: "succeeded",
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
          userMessageId: "u2",
          role: "user",
          type: "message",
          dialogProcessId: "dp-tool-only",
          content: "run tool only thinking details",
        },
        {
          modelMessageId: "tool-display-assistant",
          presentationMessageId: "tool-display-assistant",
          role: "assistant",
          type: "message",
          dialogProcessId: "dp-tool-only",
          content: "tool only final answer",
          toolTimeline: [
            {
              key: "call:tool-only-1",
              toolCallId: "tool-only-1",
              status: "running",
              call: { eventId: "tool-only-call-1" },
            },
            {
              key: "call:tool-only-2",
              toolCallId: "tool-only-2",
              status: "completed",
              call: { eventId: "tool-only-call-2" },
              resultEvent: { eventId: "tool-only-result-2" },
            },
          ],
        },
        {
          role: "assistant",
          presentationMessageId: "pm_fx5",
          modelMessageId: "mm_session_repository_bound_2",
          type: "tool_call",
          dialogProcessId: "dp-tool-only",
          tool_calls: [
            { id: "call-tool-only", function: { name: "search", arguments: { q: "demo" } } },
          ],
        },
        {
          role: "tool",
          presentationMessageId: "pm_fx6",
          type: "tool_result",
          dialogProcessId: "dp-tool-only",
          tool_call_id: "call-tool-only",
          content: "tool only result detail should not be in summary",
        },
      ],
      "lightweight_b",
    );
    await runtime.repositories.sessionRepository.save(userId, applySessionMessageFacts(sessionB), {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        sessionB.sessionId,
      ),
    });
    await runtime.repositories.sessionRepository.ensureSessionDisplaySummary(userId, "B", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "B",
      ),
    });

    const scopeB = await runtime.repositories.sessionRepository.requireSessionScope(
      userId,
      "B",
      runtime.repositories.sessionRepository.treePersistenceContext(userId, "B"),
    );
    const summaryFile = path.join(scopeB.sessionDir, "session-summary.json");
    const persistedSession = await readSessionArtifact({ sessionDir: scopeB.sessionDir });
    assert.equal(
      persistedSession.messages.every((item) => "turnScopeId" in item),
      true,
    );
    let summary = JSON.parse(await readFile(summaryFile, "utf8"));
    assert.equal(summary.schemaVersion, SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION);
    assert.equal(summary.sessionId, "B");
    assert.equal(summary.messages.length, 6);
    assert.equal(
      summary.messages.every((item) => "turnScopeId" in item),
      true,
    );
    assert.deepEqual(
      (({ userMessageId, messageUid }) => ({ userMessageId, messageUid }))(summary.messages[0]),
      { userMessageId: "u1", messageUid: "sm-u1" },
    );
    assert.equal(summary.stats.messageCount, 11);
    assert.equal(summary.stats.displayMessageCount, 6);
    assert.equal(summary.stats.injectedMessageCount, 1);
    assert.equal(summary.stats.thinkingMessageCount, 3);
    assert.equal(summary.stats.attachmentCount, 3);
    assert.equal(summary.stats.toolLogCount, 5);
    assert.equal(summary.stats.displayToolLogCount, 0);
    assert.equal(summary.stats.hasToolDetails, true);
    assert.equal("toolLogSummaries" in summary, false);
    assert.equal(
      summary.messages.find((item) => item.presentationMessageId === "a1").toolTimeline,
      undefined,
    );
    assert.equal(
      typeof summary.messages.find((item) => item.presentationMessageId === "a1").thinkingDetailRef
        ?.file,
      "string",
    );
    const hydratedSummary = await runtime.repositories.sessionRepository.readSessionDisplaySummary(
      userId,
      "B",
      {
        persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
          userId,
          "B",
        ),
      },
    );
    const assistantMessage = hydratedSummary.messages.find(
      (item) => item.presentationMessageId === "a1",
    );
    assert.equal(assistantMessage.toolTimeline.length, 1);
    assert.equal(assistantMessage.toolTimeline[0].status, "completed");
    assert.equal("log" in assistantMessage.toolTimeline[0].resultEvent, false);
    assert.equal(assistantMessage.toolTimeline[0].resultEvent.turnScopeId, undefined);
    assert.equal("writtenFiles" in assistantMessage.toolTimeline[0].resultEvent, false);
    assert.equal(
      JSON.stringify(assistantMessage.toolTimeline).includes("ordinary tool result"),
      false,
    );

    const userMessage = summary.messages.find((item) => item.userMessageId === "u1");
    assert.equal(userMessage.turnScopeId, "turn-scope-u1");
    assert.equal(userMessage.content, longUserContent);
    assert.equal(userMessage.content.endsWith(userContentTail), true);
    assert.equal(userMessage.content.includes(`${userContentTail}…`), false);
    assert.deepEqual(userMessage.attachments, [
      {
        attachmentId: "att-1",
        sessionId: "B",
        attachmentSource: "user",
        name: "a.txt",
        mimeType: "text/plain",
        size: 12,
      },
    ]);
    assert.equal("id" in userMessage.attachments[0], false);
    assert.equal("type" in userMessage.attachments[0], false);
    assert.equal("source" in userMessage.attachments[0], false);
    assert.equal(assistantMessage.content, longAssistantContent);
    assert.equal(assistantMessage.content.endsWith(assistantContentTail), true);
    assert.equal(assistantMessage.content.includes(`${assistantContentTail}…`), false);
    assert.equal(assistantMessage.hasThinkingDetails, true);
    assert.equal(assistantMessage.thinkingDetailCount, 3);
    assert.equal("realtimeLogs" in assistantMessage, false);
    assert.equal("completedToolLogs" in assistantMessage, false);
    assert.equal("rawMessages" in assistantMessage, false);
    const pluginAttachmentAssistant = summary.messages.find(
      (item) => item.modelMessageId === "plugin-attachment-assistant",
    );
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
    const toolOnlyAssistantMessage = summary.messages.find(
      (item) => item.presentationMessageId === "tool-display-assistant",
    );
    assert.equal(toolOnlyAssistantMessage.content, "tool only final answer");
    assert.equal(toolOnlyAssistantMessage.hasThinkingDetails, true);
    assert.equal(toolOnlyAssistantMessage.thinkingDetailCount, 3);
    assert.equal("realtimeLogs" in toolOnlyAssistantMessage, false);
    assert.equal("completedToolLogs" in toolOnlyAssistantMessage, false);
    assert.equal(JSON.stringify(summary.messages).includes("tool only result detail"), false);
    const workflowMessage = summary.messages.find((item) => item.presentationMessageId === "w1");
    assert.equal(workflowMessage.type, "workflow");
    assert.equal(workflowMessage.pluginMeta.payload.workflowRunId, "workflow-run-1");
    assert.equal(workflowMessage.content, longWorkflowContent);
    assert.equal(workflowMessage.content.endsWith(workflowContentTail), true);
    assert.equal(workflowMessage.content.includes(`${workflowContentTail}…`), false);
    assert.equal(workflowMessage.pluginMeta.source, "workflow-plugin");
    assert.equal(workflowMessage.pluginMeta.nodeName, "Done");
    assert.equal("internalState" in workflowMessage.pluginMeta, false);
    assert.equal(workflowMessage.pluginMeta.payload.execution.completed, true);
    assert.equal(workflowMessage.pluginMeta.payload.execution.status, "success");
    assert.equal(
      workflowMessage.pluginMeta.payload.execution.nodeAgentRuns[0].nodeSessionId,
      "session-act",
    );
    assert.equal(workflowMessage.pluginMeta.payload.execution.nodeAgentRuns[0].step.nodeId, "act");
    assert.equal(workflowMessage.pluginMeta.payload.nodeSessions[0].status, "succeeded");
    assert.equal(workflowMessage.pluginMeta.payload.nodeSessions[0].dialogProcessId, "dialog-act");
    assert.equal(workflowMessage.pluginMeta.payload.nodeSessions[0].nodeId, "act");
    assert.equal(workflowMessage.pluginMeta.payload.semantic.nodes.length, 2);
    assert.equal(
      "nodeResultText" in workflowMessage.pluginMeta.payload.execution.nodeAgentRuns[0],
      false,
    );
    assert.equal("nodeResultText" in workflowMessage.pluginMeta.payload.nodeSessions[0], false);
    assert.equal("diagnostics" in workflowMessage.pluginMeta.payload, false);
    assert.equal("transferEnvelopes" in workflowMessage, true);
    assert.equal(Array.isArray(workflowMessage.transferEnvelopes), true);
    assert.equal(workflowMessage.transferEnvelopes[0].protocol, "noobot.semantic-transfer");
    assert.equal("filePath" in workflowMessage.transferEnvelopes[0], false);
    assert.equal(
      workflowMessage.transferEnvelopes[0].payload.attachments[0].identity.attachmentId,
      "att-workflow-1",
    );
    assert.equal(
      workflowMessage.transferEnvelopes[0].payload.attachments[0].identity.sessionId,
      "B",
    );
    assert.equal("files" in workflowMessage.transferEnvelopes[0], false);
    assert.equal(
      workflowMessage.pluginMeta.payload.execution.nodeAgentRuns[0].nodeResultTransferEnvelopes[0]
        .payload.attachments[0].identity.attachmentId,
      "att-workflow-1",
    );
    assert.equal(
      workflowMessage.pluginMeta.payload.nodeSessions[0].transferEnvelopes[0].payload.attachments[0]
        .identity.attachmentId,
      "att-workflow-1",
    );
    assert.equal(JSON.stringify(summary).includes("injected secret"), false);

    await writeFile(
      summaryFile,
      JSON.stringify({ schemaVersion: 4, sessionId: "B", depth: 2, messages: [] }),
      "utf8",
    );
    const displayBeforeMaintenance = await runtime.sessionCrudService.getSessionDisplayData({
      userId,
      sessionId: "B",
    });
    assert.equal(displayBeforeMaintenance.sessions[0].messages.length, 6);
    await runtime.repositories.sessionRepository.ensureSessionDisplaySummary(userId, "A", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "A",
      ),
    });
    const maintenance = await runtime.sessionCrudService.maintainSessionDisplaySummaries({
      userId,
    });
    assert.deepEqual(maintenance.rebuiltSessionIds, []);
    const displayData = await runtime.sessionCrudService.getSessionDisplayData({
      userId,
      sessionId: "B",
    });
    assert.equal(displayData.summary, true);
    assert.equal(displayData.sessions.length, 1);
    assert.equal(displayData.sessions[0].depth, 2);
    assert.equal("toolLogSummaries" in displayData.sessions[0], false);
    summary = JSON.parse(await readFile(summaryFile, "utf8"));
    assert.equal(summary.schemaVersion, SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION);
    assert.equal(summary.sessionId, "B");
    assert.equal("depth" in summary, false);
  });
});
