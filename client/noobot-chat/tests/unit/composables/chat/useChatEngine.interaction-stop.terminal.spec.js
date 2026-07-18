/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createHarness, assistantMessage, emitChannelState } from "./helpers/useChatEngineHarness";
import { StreamEventEnum, RoleEnum } from "../../../../src/shared/constants/chatConstants";
import { FrontendRunState } from "../../../../src/composables/chat/sessionRunStateMachine";
import { selectSessionTurnRuntime } from "../../../../src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry";

describe("useChatEngine.interaction-stop: terminal", () => {
  it("channel_state stopping/reconnecting drives runtime state without persisting message terminal state", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-flight", "dp-flight", "stopping");
      emitChannelState(onEvent, "local-flight", "dp-flight", "reconnecting");
      emitChannelState(onEvent, "local-flight", "dp-flight", "user_stopped");
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
        data: { sessionId: "local-flight", dialogProcessId: "dp-flight" },
      });
    });
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "local-flight",
      stream,
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.statusLabel).toBe("chat.stopped");
    expect(assistant?.pending).toBe(false);
    expect(selectSessionTurnRuntime(turnRuntimeRegistry.value, "local-flight").sending).toBe(false);
  });

  it("channel_state stopping remains a message-level fact and does not replace the global action lock", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-stopping", "dp-stopping", "stopping");
    });
    const { engine, turnRuntimeRegistry } = createHarness({
      sessionId: "local-stopping",
      stream,
    });

    await engine.send();

    expect(selectSessionTurnRuntime(turnRuntimeRegistry.value, "local-stopping")).toMatchObject({
      sending: true,
      canStop: false,
    });
  });

  it("channel_state completed/error/no_conversation terminal behaviors are covered", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "completed");
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "error");
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "no_conversation");
    });
    const { engine, activeSession, sending, canStop, interactionSubmitting, deps } = createHarness({
      sessionId: "local-terminal",
      stream,
      pendingInteraction: {
        requestId: "req-terminal",
        sessionId: "local-terminal",
        dialogProcessId: "dp-terminal",
      },
      interactionSubmittingValue: true,
      deps: {
        clearPendingInteractionIfObsolete: vi.fn(() => true),
      },
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    expect(interactionSubmitting.value).toBe(false);
    expect(deps.clearPendingInteraction).toHaveBeenCalled();
  });

  it("terminal channel_state with backend sessionId still finalizes current local turn", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "backend-x", "dp-x", "completed", { seq: 2 });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "backend-x",
          dialogProcessId: "dp-x",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-x", content: "ok" },
          ],
        },
      });
    });
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-x",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => {
          throw new Error("ignore");
        }),
      },
    });

    await engine.send();

    expect(sending.value).toBe(false);
    const assistant = assistantMessage(activeSession);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.channelState?.state).toBe(FrontendRunState.COMPLETION_ERROR);
    expect(assistant?.statusLabelKey || assistant?.statusLabel).toBe("chat.failed");
  });

  it("terminal channel_state without DONE converges through authoritative session detail", async () => {
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-state-only",
      sessions: [
        {
          sessionId: "local-state-only",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-state-only",
              content: "detail answer",
            },
          ],
        },
      ],
    }));
    const applySessionDetail = vi.fn(async () => {
      const assistant = assistantMessage(activeSession);
      assistant.content = "detail answer";
    });
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-state-only", "dp-state-only", "completed", {
        seq: 2,
      });
    });
    const { engine, activeSession, sending, deps } = createHarness({
      sessionId: "local-state-only",
      stream,
      deps: {
        fetchSessionDetail,
        applySessionDetail,
      },
    });

    await expect(engine.send()).resolves.toBe(true);

    const assistant = assistantMessage(activeSession);
    expect(sending.value).toBe(false);
    expect(assistant?.content).toBe("detail answer");
    // This mock only replaces content; clearing the message projection belongs
    // to the real authoritative detail applier.
    expect(assistant?.pending).toBe(true);
    expect(fetchSessionDetail).toHaveBeenCalledWith("local-state-only");
    expect(applySessionDetail).toHaveBeenCalledTimes(1);
  });

  it("consumes stream ERROR event and refreshes session detail before cleanup", async () => {
    const errorData = {
      error: "invalid tool input",
      sessionId: "s-error",
      dialogProcessId: "dp-error",
    };
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({ event: StreamEventEnum.ERROR, data: errorData });
      const error = new Error(errorData.error);
      error.data = errorData;
      throw error;
    });
    const fetchSessionDetail = vi.fn(async (sessionId) => ({ sessionId, messages: [] }));
    const applySessionDetail = vi.fn();
    const { engine, activeSession, sending, deps } = createHarness({
      sessionId: "s-error",
      stream,
      deps: { fetchSessionDetail, applySessionDetail },
    });

    await expect(engine.send()).resolves.toBe(false);

    const botMessage = assistantMessage(activeSession);
    expect(botMessage.dialogProcessId).toBe("dp-error");
    expect(botMessage.pending).toBe(false);
    expect(botMessage.error).toBe("invalid tool input");
    expect(fetchSessionDetail).toHaveBeenCalledWith("s-error");
    expect(applySessionDetail).toHaveBeenCalledWith({ sessionId: "s-error", messages: [] }, {
      preserveCurrentMessages: true,
      scrollToBottom: false,
    });
    expect(deps.clearPendingInteraction).toHaveBeenCalled();
    expect(sending.value).toBe(false);
  });
});
