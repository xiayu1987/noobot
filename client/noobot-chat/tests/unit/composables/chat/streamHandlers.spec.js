import { describe, expect, it, vi } from "vitest";
import {
  handleAttachmentParsedStreamEvent,
  handleDeltaStreamEvent,
  handleDoneStreamEvent,
  handleThinkingStreamEvent,
} from "../../../../src/composables/chat/chatEngine/streamHandlers";
import { buildViewMessage } from "../../../../src/composables/infra/messageModel";

describe("chatEngine streamHandlers", () => {
  const makeBotMessage = () => ({
    dialogProcessId: "",
    realtimeLogs: [],
    executionLogTotal: 0,
  });

  it("merges parsed results into the original user attachment", () => {
    const userMessage = {
      role: "user",
      attachments: [{
        attachmentId: "source-att",
        name: "source.docx",
        previewUrl: "/source-preview",
      }],
    };
    const assistantMessage = { role: "assistant", attachments: [] };
    const activeSession = { value: { messages: [userMessage, assistantMessage] } };

    handleAttachmentParsedStreamEvent({
      data: {
        attachments: [{
          attachmentId: "source-att",
          name: "source.docx",
          parsedResult: { attachmentId: "parsed-att", name: "source.md" },
          parsedResultUrl: "/parsed-preview",
          parsedResultName: "source.md",
        }],
      },
      activeSession,
      makeViewMessage: (message) => message,
    });

    expect(userMessage.attachments).toHaveLength(1);
    expect(userMessage.attachments[0]).toEqual(expect.objectContaining({
      attachmentId: "source-att",
      previewUrl: "/source-preview",
      parsedResultUrl: "/parsed-preview",
      parsedResultName: "source.md",
      parsedResult: expect.objectContaining({ attachmentId: "parsed-att" }),
    }));
    expect(assistantMessage.attachments).toEqual([]);
  });

  it("matches parsed results by content hash without replacing canonical identity", () => {
    const userMessage = {
      role: "user",
      attachments: [{
        attachmentId: "current-att",
        contentSha256: "same-content",
        path: "/current.docx",
      }],
    };
    handleAttachmentParsedStreamEvent({
      data: {
        attachments: [{
          attachmentId: "stale-att",
          contentSha256: "same-content",
          path: "/stale.docx",
          parsedResult: { attachmentId: "parsed-att", path: "/parsed.md" },
        }],
      },
      activeSession: { value: { messages: [userMessage] } },
      makeViewMessage: (message) => message,
    });

    expect(userMessage.attachments[0]).toEqual(expect.objectContaining({
      attachmentId: "current-att",
      path: "/current.docx",
      parsedResult: expect.objectContaining({ attachmentId: "parsed-att" }),
    }));
  });

  it("matches a newly uploaded live attachment by client attachment identity", () => {
    const currentUserMessage = {
      role: "user",
      attachments: [{
        clientAttachmentId: "draft-current",
        name: "current.docx",
      }],
    };
    handleAttachmentParsedStreamEvent({
      data: {
        attachments: [{
          attachmentId: "canonical-current",
          clientAttachmentId: "draft-current",
          contentSha256: "current-content",
          parsedResult: { attachmentId: "parsed-current", path: "/parsed-current.md" },
        }],
      },
      activeSession: { value: { messages: [currentUserMessage] } },
      makeViewMessage: (message) => message,
    });

    expect(currentUserMessage.attachments[0]).toEqual(expect.objectContaining({
      clientAttachmentId: "draft-current",
      parsedResult: expect.objectContaining({ attachmentId: "parsed-current" }),
    }));
  });

  it("builds realtime parsed-result preview url from nested parsedResult metadata", () => {
    const currentUserMessage = buildViewMessage(
      {
        role: "user",
        attachments: [{
          attachmentId: "source-att",
          sessionId: "session-1",
          attachmentSource: "user",
          name: "source.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }],
      },
      { userId: "admin" },
    );

    handleAttachmentParsedStreamEvent({
      data: {
        attachments: [{
          attachmentId: "source-att",
          sessionId: "session-1",
          attachmentSource: "user",
          name: "source.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          parsedResult: {
            attachmentId: "parsed-att",
            relativePath: "runtime/attach/session-1/model/parsed.md",
            tool: "doc_to_data",
          },
        }],
      },
      activeSession: { value: { messages: [currentUserMessage] } },
      makeViewMessage: (message) => buildViewMessage(message, { userId: "admin" }),
    });

    expect(currentUserMessage.attachments[0]).toEqual(expect.objectContaining({
      attachmentId: "source-att",
      parsedResult: expect.objectContaining({ attachmentId: "parsed-att" }),
      parsedResultAttachmentId: "parsed-att",
      parsedResultName: "parsed.md",
      parsedResultUrl: "/api/internal/attachment/admin/parsed-att?sessionId=session-1&attachmentSource=model",
    }));
  });

  it("ignores thinking logs when classifier returns null", () => {
    const botMessage = makeBotMessage();
    const scrollOnFirstResponseOnce = vi.fn();

    handleThinkingStreamEvent({
      data: { event: "session_turn_full", dialogProcessId: "dp-1" },
      botMessage,
      classifyRealtimeLog: () => null,
      scrollOnFirstResponseOnce,
    });

    expect(botMessage.dialogProcessId).toBe("");
    expect(botMessage.executionLogTotal).toBe(0);
    expect(botMessage.realtimeLogs).toEqual([]);
    expect(scrollOnFirstResponseOnce).not.toHaveBeenCalled();
  });

  it("does not append empty internal thinking logs", () => {
    const botMessage = makeBotMessage();
    const scrollOnFirstResponseOnce = vi.fn();

    handleThinkingStreamEvent({
      data: { event: "assistant_message_saved", dialogProcessId: "dp-1" },
      botMessage,
      classifyRealtimeLog: () => ({
        event: "assistant_message_saved",
        type: "system",
        category: "system",
        text: "",
        dialogProcessId: "dp-1",
      }),
      scrollOnFirstResponseOnce,
    });

    expect(botMessage.dialogProcessId).toBe("");
    expect(botMessage.executionLogTotal).toBe(0);
    expect(botMessage.realtimeLogs).toEqual([]);
    expect(scrollOnFirstResponseOnce).not.toHaveBeenCalled();
  });

  it("keeps visible thinking logs with readable text", () => {
    const botMessage = makeBotMessage();
    const scrollOnFirstResponseOnce = vi.fn();
    const locateSendingStartedMessageOnce = vi.fn();

    handleThinkingStreamEvent({
      data: { event: "tool_call", dialogProcessId: "dp-1" },
      botMessage,
      classifyRealtimeLog: () => ({
        event: "tool_call",
        type: "tool_call",
        category: "tool",
        text: "执行命令：npm test",
        dialogProcessId: "dp-1",
      }),
      scrollOnFirstResponseOnce,
      locateSendingStartedMessageOnce,
    });

    expect(botMessage.dialogProcessId).toBe("dp-1");
    expect(botMessage.executionLogTotal).toBe(1);
    expect(botMessage.realtimeLogs).toEqual([
      expect.objectContaining({ event: "tool_call", text: "开始：执行命令：npm test" }),
    ]);
    expect(locateSendingStartedMessageOnce).toHaveBeenCalledTimes(1);
    expect(scrollOnFirstResponseOnce).toHaveBeenCalledTimes(1);
  });


  it("shows concrete command immediately when tool_call arrives with command fields", () => {
    const botMessage = makeBotMessage();
    const scrollOnFirstResponseOnce = vi.fn();

    handleThinkingStreamEvent({
      data: {
        event: "tool_call",
        type: "tool_call",
        category: "tool",
        text: "execute_script started",
        command: "cd /project/agent && npm test",
        dialogProcessId: "dp-1",
      },
      botMessage,
      classifyRealtimeLog: (data) => ({ ...data }),
      scrollOnFirstResponseOnce,
    });

    expect(botMessage.realtimeLogs).toEqual([
      expect.objectContaining({
        event: "tool_call",
        text: "开始：执行命令：cd /project/agent && npm test",
      }),
    ]);
    expect(botMessage.executionLogTotal).toBe(1);
  });

  it("shows done execution log with same concrete command priority", () => {
    const botMessage = makeBotMessage();
    const scrollOnFirstResponseOnce = vi.fn();
    const locateDoneMessage = vi.fn();

    handleDoneStreamEvent({
      data: {
        dialogProcessId: "dp-1",
        executionLogs: [
          {
            event: "tool_result",
            type: "tool_result",
            text: "execute_script completed",
            displayText: "cd /project/agent && npm test",
          },
        ],
      },
      requestedTextStreaming: false,
      botMessage,
      activeSession: { value: {} },
      activeSessionId: { value: "local-1" },
      clearPendingInteraction: vi.fn(),
      classifyRealtimeLog: (data) => data,
      scrollOnFirstResponseOnce,
      makeViewMessage: (messageItem) => messageItem,
      foldMessagesForView: (messages) => messages,
      mergeAssistantAttachmentMetas: vi.fn(),
      locateDoneMessage,
    });

    expect(botMessage.realtimeLogs).toEqual([
      expect.objectContaining({ text: "完成：执行命令：cd /project/agent && npm test" }),
    ]);
    expect(locateDoneMessage).not.toHaveBeenCalled();
  });

  it("locates the done message through navigator callback instead of direct bottom scroll", () => {
    const botMessage = makeBotMessage();
    const locateDoneMessage = vi.fn();
    const locateSendingStartedMessageOnce = vi.fn();
    const scrollBottom = vi.fn();

    handleDoneStreamEvent({
      data: { dialogProcessId: "dp-1" },
      requestedTextStreaming: true,
      botMessage,
      activeSession: { value: {} },
      activeSessionId: { value: "local-1" },
      clearPendingInteraction: vi.fn(),
      classifyRealtimeLog: (data) => data,
      scrollOnFirstResponseOnce: vi.fn(),
      makeViewMessage: (messageItem) => messageItem,
      foldMessagesForView: (messages) => messages,
      mergeAssistantAttachmentMetas: vi.fn(),
      scrollBottom,
      locateDoneMessage,
      locateSendingStartedMessageOnce,
    });

    expect(locateSendingStartedMessageOnce).toHaveBeenCalledTimes(1);
    expect(locateDoneMessage).not.toHaveBeenCalled();
    expect(scrollBottom).not.toHaveBeenCalled();
  });

  it("locates sending-started before done when non-streaming done logs provide dialogProcessId", () => {
    const botMessage = makeBotMessage();
    const callOrder = [];
    const locateSendingStartedMessageOnce = vi.fn(() => callOrder.push("started"));
    const locateDoneMessage = vi.fn(() => callOrder.push("done"));

    handleDoneStreamEvent({
      data: {
        executionLogs: [
          {
            event: "tool_result",
            type: "tool_result",
            displayText: "npm test",
            dialogProcessId: "dp-from-log",
          },
        ],
      },
      requestedTextStreaming: false,
      botMessage,
      activeSession: { value: {} },
      activeSessionId: { value: "local-1" },
      clearPendingInteraction: vi.fn(),
      classifyRealtimeLog: (data) => data,
      scrollOnFirstResponseOnce: vi.fn(),
      makeViewMessage: (messageItem) => messageItem,
      foldMessagesForView: (messages) => messages,
      mergeAssistantAttachmentMetas: vi.fn(),
      locateSendingStartedMessageOnce,
      locateDoneMessage,
    });

    expect(botMessage.dialogProcessId).toBe("dp-from-log");
    expect(callOrder).toEqual(["started"]);
  });


  it("keeps only the latest ten thinking execution logs while message is sending", () => {
    const botMessage = makeBotMessage();
    const scrollOnFirstResponseOnce = vi.fn();

    for (let index = 1; index <= 12; index += 1) {
      handleThinkingStreamEvent({
        data: { event: "tool_call", command: `cmd-${index}`, dialogProcessId: "dp-1" },
        botMessage,
        classifyRealtimeLog: (data) => ({ ...data, type: "tool_call", category: "tool" }),
        scrollOnFirstResponseOnce,
      });
    }

    expect(botMessage.realtimeLogs).toHaveLength(10);
    expect(botMessage.executionLogTotal).toBe(12);
    expect(botMessage.realtimeLogs[0].text).toBe("开始：执行命令：cmd-3");
    expect(botMessage.realtimeLogs[9].text).toBe("开始：执行命令：cmd-12");
    expect(scrollOnFirstResponseOnce).toHaveBeenCalledTimes(12);
  });

  it("continues execution count after refresh hydrated process fields", () => {
    const botMessage = {
      ...makeBotMessage(),
      dialogProcessId: "dp-1",
      processExecutionLogTotal: 12,
    };
    const scrollOnFirstResponseOnce = vi.fn();
    const appliedEvents = [];
    const processStore = {
      applyEventBatch: vi.fn((events) => appliedEvents.push(...events)),
      getCompatView: vi.fn(() => ({
        lastSequence: 13,
        realtimeLogs: botMessage.realtimeLogs,
        completedToolLogs: botMessage.realtimeLogs,
        executionLogTotal: appliedEvents.length,
      })),
    };

    handleThinkingStreamEvent({
      data: { event: "tool_call", command: "cmd-13", dialogProcessId: "dp-1" },
      botMessage,
      classifyRealtimeLog: (data) => ({ ...data, type: "tool_call", category: "tool" }),
      scrollOnFirstResponseOnce,
      processStore,
    });

    expect(botMessage.executionLogTotal).toBe(13);
    expect(botMessage.processExecutionLogTotal).toBe(13);
    expect(appliedEvents[0]).toMatchObject({ sequence: 13, processId: "dp-1" });
    expect(appliedEvents[0].payload.node.id).toBe("dp-1:seq:13");
    expect(scrollOnFirstResponseOnce).toHaveBeenCalledTimes(1);
  });

  it("keeps only the latest ten done execution logs", () => {
    const botMessage = makeBotMessage();
    const scrollOnFirstResponseOnce = vi.fn();
    const executionLogs = Array.from({ length: 12 }, (_, index) => ({
      event: "tool_result",
      type: "tool_result",
      displayText: `cmd-${index + 1}`,
    }));

    handleDoneStreamEvent({
      data: { dialogProcessId: "dp-1", executionLogs },
      requestedTextStreaming: false,
      botMessage,
      activeSession: { value: {} },
      activeSessionId: { value: "local-1" },
      clearPendingInteraction: vi.fn(),
      classifyRealtimeLog: (data) => data,
      scrollOnFirstResponseOnce,
      makeViewMessage: (messageItem) => messageItem,
      foldMessagesForView: (messages) => messages,
      mergeAssistantAttachmentMetas: vi.fn(),
      scrollBottom: vi.fn(),
    });

    expect(botMessage.realtimeLogs).toHaveLength(10);
    expect(botMessage.executionLogTotal).toBe(12);
    expect(botMessage.realtimeLogs[0].text).toBe("完成：执行命令：cmd-3");
    expect(botMessage.realtimeLogs[9].text).toBe("完成：执行命令：cmd-12");
    expect(scrollOnFirstResponseOnce).toHaveBeenCalledTimes(1);
  });


  it("does not append pure internal event placeholders from delta chunks", () => {
    const botMessage = { content: "", dialogProcessId: "" };
    const scrollOnFirstResponseOnce = vi.fn();
    const locateSendingStartedMessageOnce = vi.fn();

    handleDeltaStreamEvent({
      data: {
        text: [
          "[tool_call]",
          "[session_turn_full]",
          "[system]",
          "[assistant_message_saved]",
          "[tool_result]",
        ].join("\n"),
        dialogProcessId: "dp-1",
      },
      botMessage,
      scrollOnFirstResponseOnce,
      locateSendingStartedMessageOnce,
    });

    expect(botMessage.dialogProcessId).toBe("dp-1");
    expect(botMessage.content).toBe("");
    expect(locateSendingStartedMessageOnce).toHaveBeenCalledTimes(1);
    expect(scrollOnFirstResponseOnce).not.toHaveBeenCalled();
  });

  it("keeps readable delta text while removing internal event placeholders", () => {
    const botMessage = { content: "", dialogProcessId: "" };
    const scrollOnFirstResponseOnce = vi.fn();

    handleDeltaStreamEvent({
      data: { text: "第一行\n[tool_call]\n第二行\n[tool_result]" },
      botMessage,
      scrollOnFirstResponseOnce,
    });

    expect(botMessage.content).toBe("第一行\n第二行");
    expect(scrollOnFirstResponseOnce).toHaveBeenCalledTimes(1);
  });

  it("does not append internal placeholder thinking logs after classification", () => {
    const botMessage = makeBotMessage();
    const scrollOnFirstResponseOnce = vi.fn();

    handleThinkingStreamEvent({
      data: { event: "tool_call", text: "[tool_call]", dialogProcessId: "dp-1" },
      botMessage,
      classifyRealtimeLog: (data) => ({
        event: data.event,
        type: "tool_call",
        category: "tool",
        text: data.text,
        dialogProcessId: data.dialogProcessId,
      }),
      scrollOnFirstResponseOnce,
    });

    expect(botMessage.realtimeLogs).toEqual([]);
    expect(botMessage.executionLogTotal).toBe(0);
    expect(scrollOnFirstResponseOnce).not.toHaveBeenCalled();
  });

  it("does not append internal placeholders from done execution logs", () => {
    const botMessage = makeBotMessage();
    const scrollOnFirstResponseOnce = vi.fn();

    handleDoneStreamEvent({
      data: {
        dialogProcessId: "dp-1",
        executionLogs: [
          { event: "tool_call", type: "tool_call", text: "[tool_call]" },
          { event: "tool_result", type: "tool_result", text: "工具执行完成" },
        ],
      },
      requestedTextStreaming: false,
      botMessage,
      activeSession: { value: {} },
      activeSessionId: { value: "local-1" },
      clearPendingInteraction: vi.fn(),
      classifyRealtimeLog: (data) => data,
      scrollOnFirstResponseOnce,
      makeViewMessage: (messageItem) => messageItem,
      foldMessagesForView: (messages) => messages,
      mergeAssistantAttachmentMetas: vi.fn(),
      scrollBottom: vi.fn(),
    });

    expect(botMessage.realtimeLogs).toEqual([
      expect.objectContaining({ event: "tool_result", text: "完成：执行命令：工具执行完成" }),
    ]);
    expect(botMessage.realtimeLogs[0].text).not.toContain("[tool_result]");
    expect(scrollOnFirstResponseOnce).toHaveBeenCalledTimes(1);
  });
});
