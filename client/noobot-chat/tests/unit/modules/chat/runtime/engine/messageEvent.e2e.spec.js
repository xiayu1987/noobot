/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import {
  bindAssistantMessageEventStream,
  beginAssistantMessageEventStream,
  emitMessageEvent,
} from "../../../../../../../../agent/src/events/message-event-stream.js";
import { initializeCurrentTurnMessageEventProjection } from "../../../../../../../../agent/src/events/current-turn-message-event-projection.js";
import { createRuntimeContext } from "../../../../../../../../agent/src/runtime/runtime-context-factory.js";
import { createTestAttachmentService } from "../../../../../../../../agent/__tests__/helpers/test-runtime-context.js";
import { createRunEventListener } from "../../../../../../../../service/ws/chat-websocket/run-event-listener.js";
import { isWorkflowNodeMessageEvent } from "@noobot/event-protocol/message-event";
import { toolResultText } from "../../../../helpers/toolTimelineFixture.js";
import { useChatStore } from "../../../../../../src/modules/chat/stores/useChatStore.js";
import { collectSessionLinkSnapshots } from "../../../../../../src/modules/chat/composables/message/useMessageFiles.js";
import { useMarkdownRenderer } from "../../../../../../src/modules/chat/composables/message/useMarkdownRenderer.js";
import { buildAttachmentRefIndex } from "../../../../../../src/modules/chat/composables/message/attachmentInlineRefPlugin.js";
import { translateMessageKey } from "../../../../../../src/shared/i18n/messageCatalog.js";
import { buildViewMessage } from "../../../../../../src/modules/chat/model/messageModel.js";
import { buildSessionDetailProjection } from "../../../../../../src/modules/session/model/list/sessionDetailProjection.js";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";
import { canonicalWorkflowSessionSnapshot } from "../../helpers/workflowRuntimeEventFixture.js";

function applySessionSnapshot(store, sessionDoc) {
  return store.applyWorkflowRuntimeEvent(
    canonicalWorkflowSessionSnapshot({
      executionId: "agent-execution-child-session",
      aggregateVersion: 1,
      authoritySessionId: "parent-session",
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-execution-1",
      ...sessionDoc,
    }),
    { source: "test_snapshot" },
  );
}

function deliverPacketToStore(store, envelope) {
  const wireEnvelope = JSON.parse(JSON.stringify(envelope));
  expect(isWorkflowNodeMessageEvent(wireEnvelope)).toBe(true);
  return store.reduceSubSessionMessageEvent(wireEnvelope, { source: "test" });
}

const presentationMessageId = "child-turn-presentation";
const SNAPSHOT_SHA = "d".repeat(64);
const READ_FILE_RESULT = toolResultText({
  ok: true,
  path: { view: "workspace", path: "notes.md" },
  fileName: "notes.md",
});
const WRITE_FILE_RESULT = toolResultText({
  ok: true,
  path: { view: "workspace", path: "report.md" },
  fileName: "report.md",
});

function reportMutationRef(overrides) {
  return {
    mutationId: "m-report",
    revision: 1,
    operation: "update",
    locator: { view: "host", path: "D:/工作/报告.xlsx" },
    fileName: "报告.xlsx",
    beforeSha256: SNAPSHOT_SHA,
    afterSha256: SNAPSHOT_SHA,
    size: 10,
    additions: null,
    deletions: null,
    snapshot: "available",
    ...overrides,
  };
}

function linkRenderer(messages, messageIndex) {
  const { renderMarkdown } = useMarkdownRenderer();
  const linkSnapshots = collectSessionLinkSnapshots(messages);
  return (content) =>
    renderMarkdown(content, {
      attachmentRefIndex: buildAttachmentRefIndex([]),
      linkSnapshots,
      messageIndex,
      workspaceRootDirectory: null,
      translate: (key, params) => translateMessageKey("en-US", key, params),
    });
}

function projectHistory(sessionId, messages) {
  return buildSessionDetailProjection({
    sessionDetail: { sessionId, messages },
    sessionDocs: [{ sessionId }],
    makeViewMessage: (messageItem, { sessionId: viewSessionId }) =>
      reactive(buildViewMessage(messageItem, { sessionId: viewSessionId, userId: "user-1" })),
  }).messages;
}

function historyAssistant(turn, toolCallId, mutationRefs) {
  return {
    presentationMessageId: `assistant-${turn}`,
    role: "assistant",
    type: "message",
    chatPresentation: true,
    content: `answer ${turn}`,
    turnScopeId: `turn-${turn}`,
    dialogProcessId: `dialog-${turn}`,
    toolTimeline: [
      {
        key: `call:${toolCallId}`,
        toolCallId,
        tool: "write_file",
        status: "completed",
        success: true,
        resultEvent: {
          eventId: `event-${toolCallId}`,
          mutationRefs,
          log: {
            event: "tool_result",
            type: "tool_result",
            toolCallId,
            turnScopeId: `turn-${turn}`,
          },
        },
      },
    ],
  };
}
const NODE_SCOPE = Object.freeze({
  sessionId: "child-session",
  parentSessionId: "parent-session",
  dialogProcessId: "child-dialog",
  turnScopeId: "child-turn",
  workflowRunId: "workflow-run-1",
  nodeExecutionId: "node-execution-1",
});

function createNodeStream() {
  const frames = [];
  const produced = [];
  const runtime = createRuntimeContext({
    basePath: "",
    workspaceRootDirectory: "/noobot-test/workspace/u-test",
    globalConfig: {},
    userConfig: {},
    eventListener: null,
    attachmentService: createTestAttachmentService(),
    botManager: null,
    userInteractionBridge: null,
    abortSignal: new AbortController().signal,
    runtimeModel: "",
    allEnabledProviders: {},
    userMessageAttachments: [],
    sharedTools: {},
    systemRuntime: {
      userId: "user-1",
      sessionId: "child-session",
      parentSessionId: "parent-session",
      dialogProcessId: "child-dialog",
      turnScopeId: "child-turn",
      caller: "bot",
      persistenceScope: null,
    },
    runConfig: {
      hookManager: null,
      executionId: "child-execution",
      commandId: "child-command",
    },
    sessionManager: {
      commitMessageEvent: async ({ payload, sessionId, turnScopeId }) => ({
        committed: true,
        envelope: canonicalMessageEvent({
          ...payload,
          eventId: `${payload.presentationMessageId}:${payload.eventType}:${produced.length + 1}`,
          sessionId,
          turnScopeId,
          sequence: produced.length + 1,
        }),
      }),
    },
  });
  initializeCurrentTurnMessageEventProjection(runtime);
  const listener = createRunEventListener({
    sessionId: "parent-session",
    onAuthorityEventCommitted(envelope) {
      frames.push(envelope);
      return true;
    },
  });
  bindAssistantMessageEventStream(runtime, {
    presentationMessageId,
    parentSessionId: "parent-session",
    workflowNodeOwnership: {
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-execution-1",
    },
  });
  const modelMessageId = beginAssistantMessageEventStream(runtime, { turn: 1 });
  const emit = async (eventType, payload) => {
    produced.push(await emitMessageEvent(listener, runtime, eventType, payload));
  };
  return { frames, produced, emit, modelMessageId };
}

function emitPresentation(stream) {
  return stream.emit("turn_presentation_committed", {
    presentation: {
      userMessage: {
        messageUid: "child-turn-user",
        userMessageId: "child-turn-user",
        role: "user",
        sessionId: "child-session",
        turnScopeId: "child-turn",
        content: "run the workflow node",
        attachments: [],
        ts: "2026-01-01T00:00:00.000Z",
      },
      assistantMessage: {
        presentationMessageId,
        role: "assistant",
        sessionId: "child-session",
        turnScopeId: "child-turn",
        content: "",
        attachments: [],
        pending: true,
      },
    },
  });
}

describe("authoritative message event end-to-end fidelity", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("preserves Mermaid thinking through tool results and snapshot takeover", async () => {
    const store = useChatStore();
    const stream = createNodeStream();
    const { frames, produced } = stream;
    expect(stream.modelMessageId).not.toBe(presentationMessageId);
    await emitPresentation(stream);
    await stream.emit("model_analysis_delta", {
      activityId: "activity-l136",
      activityKind: "main_model_analysis",
      ...NODE_SCOPE,
      text: "```mermaid\ngraph TD; A-->B\n```",
      thinking: "```mermaid\ngraph TD; A-->B\n```",
    });
    await stream.emit("tool_call_end", {
      ...NODE_SCOPE,
      tool: "read_file",
      toolCallId: "call-1",
      result: READ_FILE_RESULT,
      success: true,
      durationMs: 5,
    });

    expect(frames).toHaveLength(3);
    frames.forEach((frame, index) => {
      expect(frame).toEqual(produced[index]);
      expect(frame.identity.eventType).toBe("message_event");
      expect(frame.ordering.scopeId).toBe(presentationMessageId);
      expect(deliverPacketToStore(store, frame).applied).toBe(true);
    });

    let session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(2);
    let assistantMessage = session.messages.find((message) => message.role === "assistant");
    expect(assistantMessage).toMatchObject({
      presentationMessageId,
      role: "assistant",
    });
    expect(assistantMessage.activityTimeline).toEqual([
      expect.objectContaining({
        eventType: "model_analysis_delta",
        text: "```mermaid\ngraph TD; A-->B\n```",
      }),
    ]);
    expect(assistantMessage.toolTimeline).toEqual([
      expect.objectContaining({
        key: "call:call-1",
        status: "completed",
        result: READ_FILE_RESULT,
      }),
    ]);
    expect(assistantMessage.messageEventState.consumedEventIds).toEqual(
      produced.map((event) => event.identity.eventId),
    );

    applySessionSnapshot(store, {
      nodeSessionId: "child-session",
      messages: [
        {
          messageUid: presentationMessageId,
          presentationMessageId,
          role: "assistant",
          content: "final answer",
        },
      ],
    });
    session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(2);
    assistantMessage = session.messages.find((message) => message.role === "assistant");
    expect(assistantMessage).toMatchObject({
      presentationMessageId,
      content: "final answer",
    });
    expect(assistantMessage.activityTimeline).toHaveLength(1);
    expect(assistantMessage.toolTimeline).toHaveLength(1);
    expect(assistantMessage.messageEventState.consumedEventIds).toEqual(
      produced.map((event) => event.identity.eventId),
    );
    expect(assistantMessage).not.toHaveProperty("thinking");
    expect(assistantMessage).not.toHaveProperty("toolResult");
    expect(assistantMessage).not.toHaveProperty("rawEvents");
  });

  it("renders file links from live tool_call_end mutationRefs", async () => {
    const store = useChatStore();
    const stream = createNodeStream();
    await emitPresentation(stream);
    const toolEnd = (toolCallId, mutationRefs) =>
      stream.emit("tool_call_end", {
        ...NODE_SCOPE,
        tool: "write_file",
        toolCallId,
        result: WRITE_FILE_RESULT,
        success: true,
        durationMs: 1,
        mutationRefs,
      });

    await toolEnd("call-w1", [reportMutationRef()]);
    await toolEnd("call-w2", [reportMutationRef({ revision: 2 })]);
    await toolEnd("call-del", [
      reportMutationRef({
        mutationId: "m-old",
        operation: "delete",
        locator: { view: "workspace", path: "out/old.txt" },
        fileName: "old.txt",
        afterSha256: null,
        size: 0,
        snapshot: "deleted",
      }),
    ]);
    stream.frames.forEach((frame) => {
      expect(deliverPacketToStore(store, frame).applied).toBe(true);
    });

    const { messages } = store.selectSubSessionMessages("child-session");
    const messageIndex = messages.findIndex((message) => message.role === "assistant");
    expect(
      collectSessionLinkSnapshots(messages).map(({ ref }) => `${ref.mutationId}@${ref.revision}`),
    ).toEqual(["m-report@1", "m-report@2", "m-old@1"]);
    const render = linkRenderer(messages, messageIndex);

    for (const href of [
      "<d:/工作/报告.xlsx>",
      "<D:\\工作\\报告.xlsx>",
      "<file:///D:/工作/报告.xlsx>",
    ]) {
      const html = render(`[报告](${href})`);
      expect(html).toContain('data-noobot-mutation-ref="m-report@2"');
      expect(html).not.toContain("noobot-attachment-chip--missing");
    }
    const deleted = render("[old](out/old.txt)");
    expect(deleted).toContain('data-attachment-missing-reason="resource_deleted"');
    expect(deleted).not.toContain("data-noobot-mutation-ref");

    const unknown = render("[x](<file:///D:/工作/unknown.txt>) and file:///D:/工作/bare.txt");
    expect(unknown).toContain('data-attachment-missing-reason="resource_not_registered"');
    expect(unknown).not.toContain('href="file:');
  });

  it("binds history-projected links to the snapshot of their own message", () => {
    const messages = projectHistory("session-history", [
      { role: "user", content: "q1", turnScopeId: "turn-1", dialogProcessId: "dialog-1" },
      historyAssistant(1, "call-h1", [reportMutationRef()]),
      { role: "user", content: "q2", turnScopeId: "turn-2", dialogProcessId: "dialog-2" },
      historyAssistant(2, "call-h2", [reportMutationRef({ mutationId: "m-report-turn-2" })]),
    ]);
    const assistantIndexes = messages.flatMap((message, index) =>
      message.role === "assistant" ? [index] : [],
    );
    expect(assistantIndexes).toHaveLength(2);
    expect(
      collectSessionLinkSnapshots(messages).map(
        ({ ref, messageIndex }) => `${ref.mutationId}@${ref.revision}#${messageIndex}`,
      ),
    ).toEqual([`m-report@1#${assistantIndexes[0]}`, `m-report-turn-2@1#${assistantIndexes[1]}`]);

    const earlier = linkRenderer(messages, assistantIndexes[0])("[报告](<D:/工作/报告.xlsx>)");
    expect(earlier).toContain('data-noobot-mutation-ref="m-report@1"');
    expect(earlier).toContain('data-noobot-link-superseded="true"');
    expect(earlier).toMatch(
      /noobot-attachment-chip--latest"[^>]*data-noobot-mutation-ref="m-report-turn-2@1"/,
    );

    const latest = linkRenderer(messages, assistantIndexes[1])("[报告](<D:/工作/报告.xlsx>)");
    expect(latest).toContain('data-noobot-mutation-ref="m-report-turn-2@1"');
    expect(latest).not.toContain("data-noobot-link-superseded");
    expect(latest).not.toContain("noobot-attachment-chip--latest");
  });

  it("projects history tool timelines to the same link binding as the live stream", async () => {
    const store = useChatStore();
    const stream = createNodeStream();
    await emitPresentation(stream);
    await stream.emit("tool_call_end", {
      ...NODE_SCOPE,
      tool: "write_file",
      toolCallId: "call-live",
      result: WRITE_FILE_RESULT,
      success: true,
      durationMs: 1,
      mutationRefs: [reportMutationRef({ revision: 3 })],
    });
    stream.frames.forEach((frame) => {
      expect(deliverPacketToStore(store, frame).applied).toBe(true);
    });
    const live = store.selectSubSessionMessages("child-session").messages;
    const liveIndex = live.findIndex((message) => message.role === "assistant");

    const history = projectHistory("session-history", [
      historyAssistant(1, "call-live", [reportMutationRef({ revision: 3 })]),
    ]);
    const historyIndex = history.findIndex((message) => message.role === "assistant");

    const refsOf = (messages) => collectSessionLinkSnapshots(messages).map(({ ref }) => ref);
    expect(refsOf(history)).toEqual(refsOf(live));
    const link = "[报告](<D:/工作/报告.xlsx>)";
    expect(linkRenderer(history, historyIndex)(link)).toBe(linkRenderer(live, liveIndex)(link));
  });
});
