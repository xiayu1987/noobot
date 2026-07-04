import { describe, expect, it } from "vitest";
import {
  mergeAssistantContents,
  normalizeExecutionLogForRealtime,
  patchAssistantFromWorkflowMessage,
  sanitizeExecutionLogForDisplay,
  stripInternalEventPlaceholderLines,
} from "../../../../src/composables/chat/chatEngine/utils";

describe("chatEngine utils", () => {
  it("strips internal event placeholder lines from assistant content", () => {
    const content = stripInternalEventPlaceholderLines([
      "[tool_call]",
      "[session_turn_full]",
      "[system]",
      "[assistant_message_saved]",
      "[tool_result]",
    ].join("\n"));

    expect(content).toBe("");
  });

  it("keeps normal assistant text while removing internal event placeholders", () => {
    const content = mergeAssistantContents([
      {
        content: [
          "准备执行。",
          "[tool_call]",
          "执行完成。",
          "[tool_result]",
          "[not_internal_event]",
        ].join("\n"),
      },
    ]);

    expect(content).toContain("准备执行。");
    expect(content).toContain("执行完成。");
    expect(content).toContain("[not_internal_event]");
    expect(content).not.toContain("[tool_call]");
    expect(content).not.toContain("[tool_result]");
  });

  it("strips workflow assistant content copied into the active bot message", () => {
    const targetMessage = {
      pending: true,
      statusLabel: "执行中",
      realtimeLogs: [],
      executionLogTotal: 0,
      content: "",
    };

    patchAssistantFromWorkflowMessage(targetMessage, {
      role: "assistant",
      content: "[session_turn_full]\n真正回复",
    });

    expect(targetMessage.content).toBe("真正回复");
    expect(targetMessage.content).not.toContain("[session_turn_full]");
  });

  it("patches workflow assistant through the shared folded message shape", () => {
    const targetMessage = {
      pending: false,
      statusLabel: "",
      realtimeLogs: [],
      executionLogTotal: 0,
      content: "",
    };
    const workflowMessageItem = {
      role: "assistant",
      type: "tool_call",
      content: "工作流节点回复",
      tool_calls: [{ id: "call-1", name: "read_file" }],
      tool_call_id: "call-1",
    };

    patchAssistantFromWorkflowMessage(targetMessage, workflowMessageItem);

    expect(targetMessage.content).toBe("工作流节点回复");
    expect(targetMessage.tool_calls).toEqual([{ id: "call-1", name: "read_file" }]);
    expect(targetMessage.tool_call_id).toBe("call-1");
    expect(targetMessage.type).toBe("tool_call");
    expect(targetMessage.workflowMessage).toBeUndefined();
    expect(targetMessage.workflowMeta).toBeUndefined();
    expect(workflowMessageItem.tool_calls).toEqual([{ id: "call-1", name: "read_file" }]);
    expect(workflowMessageItem.tool_call_id).toBe("call-1");
    expect(workflowMessageItem.type).toBe("tool_call");
  });


  it("sanitizes internal placeholders from execution logs", () => {
    const samples = [
      "[tool_call]",
      "[session_turn_full]",
      "[system]",
      "[assistant_message_saved]",
      "[tool_result]",
    ];

    for (const sample of samples) {
      const logItem = normalizeExecutionLogForRealtime({ text: sample, event: "tool_call" });

      expect(logItem.text).toBe("");
      expect(sanitizeExecutionLogForDisplay(logItem)).toBeNull();
    }
  });

  it("keeps readable execution log text and normal tool events", () => {
    const logItem = normalizeExecutionLogForRealtime({
      event: "tool_call",
      type: "tool_call",
      category: "tool",
      text: "执行命令：npm test",
    });

    expect(sanitizeExecutionLogForDisplay(logItem)).toEqual(
      expect.objectContaining({
        event: "tool_call",
        type: "tool_call",
        text: "开始：执行命令：npm test",
      }),
    );
  });


  it("shows concrete command during tool_call from command fields", () => {
    const logItem = normalizeExecutionLogForRealtime({
      event: "tool_call",
      type: "tool_call",
      category: "tool",
      text: "read_file started",
      command: "read_file /project/client/noobot-chat/package.json",
    });

    expect(sanitizeExecutionLogForDisplay(logItem)).toEqual(
      expect.objectContaining({
        text: "开始：执行命令：read_file /project/client/noobot-chat/package.json",
      }),
    );
  });

  it("builds concrete command from tool name and raw args when text is only status", () => {
    const logItem = normalizeExecutionLogForRealtime({
      event: "tool_call",
      type: "tool_call",
      category: "tool",
      text: "read_file started",
      name: "read_file",
      rawInput: { filePath: "/project/client/noobot-chat/package.json" },
    });

    expect(sanitizeExecutionLogForDisplay(logItem)?.text).toBe(
      '开始：执行命令：read_file {"filePath":"/project/client/noobot-chat/package.json"}',
    );
  });

  it("does not duplicate existing start or done command prefixes", () => {
    expect(
      sanitizeExecutionLogForDisplay({
        event: "tool_call",
        type: "tool_call",
        text: "开始：执行命令：开始：执行命令：npm test",
      })?.text,
    ).toBe("开始：执行命令：npm test");

    expect(
      sanitizeExecutionLogForDisplay({
        event: "tool_result",
        type: "tool_result",
        text: "完成：执行命令：完成：执行命令：npm test",
      })?.text,
    ).toBe("完成：执行命令：npm test");
  });

  it("falls back to status text without blank or undefined when command fields are missing", () => {
    expect(
      sanitizeExecutionLogForDisplay({
        event: "tool_call",
        type: "tool_call",
        text: "read_file started",
      })?.text,
    ).toBe("开始：执行命令：read_file started");
  });

  it("hides internal container events even when they include text", () => {
    expect(
      sanitizeExecutionLogForDisplay({
        event: "session_turn_full",
        type: "system",
        text: "[session_turn_full]",
      }),
    ).toBeNull();
  });
});
