import { describe, expect, it, vi } from "vitest";
import {
  handleDeltaStreamEvent,
  handleDoneStreamEvent,
  handleThinkingStreamEvent,
} from "../../../../src/composables/chat/chatEngine/streamHandlers";

describe("chatEngine streamHandlers", () => {
  const makeBotMessage = () => ({
    dialogProcessId: "",
    realtimeLogs: [],
    executionLogTotal: 0,
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
    });

    expect(botMessage.dialogProcessId).toBe("dp-1");
    expect(botMessage.executionLogTotal).toBe(1);
    expect(botMessage.realtimeLogs).toEqual([
      expect.objectContaining({ event: "tool_call", text: "开始：执行命令：npm test" }),
    ]);
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
    expect(locateDoneMessage).toHaveBeenCalledTimes(1);
  });

  it("locates the done message through navigator callback instead of direct bottom scroll", () => {
    const botMessage = makeBotMessage();
    const locateDoneMessage = vi.fn();
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
    });

    expect(locateDoneMessage).toHaveBeenCalledTimes(1);
    expect(scrollBottom).not.toHaveBeenCalled();
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
    });

    expect(botMessage.dialogProcessId).toBe("dp-1");
    expect(botMessage.content).toBe("");
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
