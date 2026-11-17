/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { nextTick, ref, watch } from "vue";
import { AGENT_COMMAND, AGENT_TRANSPORT_EVENT } from "@noobot/agent-transport-protocol";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { executeSendStream } from "../../../../../../src/modules/chat/runtime/engine/sendStreamExecutor.js";
import { serializeAttachments } from "../../../../../../src/modules/chat/runtime/engine/attachmentSerialization.js";
import { createSessionAggregateVersionManager } from "../../../../../../src/modules/chat/runtime/engine/sessionAggregateVersionManager.js";
import { createCommandResultError } from "../../../../../../src/infrastructure/websocket/chatWebSocketProtocol.js";

function fixture(request = {}) {
  const activeSession = ref({ sessionId: "session-1", parentSessionId: "", aggregateVersion: 2 });
  const preferences = {
    allowUserInteraction: true,
    safeConfirm: true,
    safeConfirmLevel: "low",
    sanitizeOutput: true,
    botScenario: "",
    selectedModel: "",
    memoryModel: "",
    pluginModelConfig: null,
    frontendThresholdsEnabled: false,
    summaryPolicy: null,
    locale: "",
    selectedPlugins: [],
  };
  return {
    activeSession,
    applyTurnLifecycleEnvelope: vi.fn(),
    chatWebSocketClient: { stream: vi.fn().mockResolvedValue(undefined) },
    clearUploads: vi.fn(),
    debugLogger: { streamBefore: vi.fn(), resolved: vi.fn() },
    navigateOnFirstResponseOnce: vi.fn(),
    payloadPreferences: Object.fromEntries(
      Object.entries(preferences).map(([key, value]) => [key, ref(value)]),
    ),
    prepared: { botMessage: {} },
    request: {
      commandType: AGENT_COMMAND.SEND,
      sessionId: "session-1",
      turnScopeId: "turn-1",
      userMessageId: "msg_user-1",
      presentationMessageId: "msg_assistant-1",
      messageText: "hello",
      attachmentFiles: [],
      ...request,
    },
    serializeAttachments: vi.fn(serializeAttachments),
    sessionAggregateVersionManager: createSessionAggregateVersionManager({ activeSession }),
    streamHandlerDependencies: {},
    streamOutput: ref(true),
  };
}

describe("send stream attachment scheduling", () => {
  it("dispatches text before queued presentation updates", async () => {
    const options = fixture();
    const pending = ref(false);
    const order = [];
    const stop = watch(pending, () => order.push("presentation"));
    options.chatWebSocketClient.stream.mockImplementation(async () => {
      order.push("command");
    });
    pending.value = true;
    try {
      const result = executeSendStream(options);
      await nextTick();
      expect(order).toEqual(["command", "presentation"]);
      await expect(result).resolves.toBe(true);
      expect(options.chatWebSocketClient.stream.mock.calls[0][0].input.attachments).toEqual([]);
    } finally {
      stop();
    }
  });

  it("waits for uploaded bytes before dispatching the attachment command", async () => {
    const options = fixture({
      attachmentFiles: [
        {
          clientAttachmentId: "att-1",
          name: "a.txt",
          raw: new Blob(["A"]),
        },
      ],
    });
    const result = executeSendStream(options);
    expect(options.chatWebSocketClient.stream).not.toHaveBeenCalled();
    await result;
    expect(options.chatWebSocketClient.stream.mock.calls[0][0].input.attachments).toEqual([
      {
        clientAttachmentId: "att-1",
        name: "a.txt",
        mimeType: "application/octet-stream",
        contentBase64: "QQ==",
      },
    ]);
    expect(options.clearUploads).toHaveBeenCalledOnce();
  });

  it("propagates attachment failures without dispatching a command", async () => {
    const options = fixture({ attachmentFiles: [{ raw: new Blob(["a"]) }] });
    await expect(executeSendStream(options)).rejects.toThrow("clientAttachmentId");
    expect(options.chatWebSocketClient.stream).not.toHaveBeenCalled();
  });

  it.each([
    { attachments: [] },
    {
      attachments: [{ attachmentId: "att-1", attachmentSource: "user_upload", fileName: "a.txt" }],
    },
  ])(
    "preserves resend attachments without touching uploads: $attachments",
    async ({ attachments }) => {
      const options = fixture({
        commandType: AGENT_COMMAND.RESEND,
        dialogProcessId: "dialog-1",
        attachments,
      });
      await executeSendStream(options);
      expect(options.serializeAttachments).not.toHaveBeenCalled();
      expect(options.clearUploads).not.toHaveBeenCalled();
      expect(options.chatWebSocketClient.stream.mock.calls[0][0].input.attachments).toEqual(
        attachments,
      );
    },
  );

  it("rebuilds the command at the conflict revision without repeating attachment work", async () => {
    const options = fixture();
    options.chatWebSocketClient.stream.mockRejectedValueOnce(
      createCommandResultError(AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT, {
        commandId: "command-1",
        outcome: "failed",
        error: { code: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT, currentVersion: 3 },
      }),
    );
    await executeSendStream(options);
    const payloads = options.chatWebSocketClient.stream.mock.calls.map(([payload]) => payload);
    expect(payloads.map((payload) => payload.concurrency.expectedAggregateVersion)).toEqual([2, 3]);
    expect(payloads[1].input).toEqual(payloads[0].input);
    expect(payloads[1].commandId).toBe(payloads[0].commandId);
  });
});
