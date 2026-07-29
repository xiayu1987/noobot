/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthoritativeMessageEnvelope,
  createCanonicalAssistant,
  createFixture,
  createFakeProcessStore,
} from "../helpers/useReconnectReplayHelper.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("RC-05: missing dialogProcessId does not throw and uses safe cache key", async () => {
    const { api } = createFixture();

    await expect(
      api.applyReconnectEvent(StreamEventEnum.DELTA, {
        sessionId: "s-2",
        seq: 1,
        text: "no-dp",
      }),
    ).resolves.toBeUndefined();

    const cacheKeys = Object.keys(api.__test.replayCache["s-2"] || {});
    expect(cacheKeys.some((key) => key.startsWith("__session__"))).toBe(true);
  });

  it("RC-01: rapid session switching does not apply replay to wrong session", async () => {
    const { api, refs } = createFixture();
    refs.sessions.value.find((session) => session.id === "s-1").messages = [
      { role: RoleEnum.USER, content: "s1-q" },
      createCanonicalAssistant({
        sessionId: "s-1", messageId: "message-s1", dialogProcessId: "dp-s1", turnScopeId: "turn-s1",
      }),
    ];
    refs.sessions.value.find((session) => session.id === "s-2").messages = [
      { role: RoleEnum.USER, content: "s2-q" },
      createCanonicalAssistant({
        sessionId: "s-2", messageId: "message-s2", dialogProcessId: "dp-s2", turnScopeId: "turn-s2",
      }),
    ];

    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-2",
      dialogProcessId: "dp-s2",
      turnScopeId: "turn-s2",
      messageId: "message-s2",
      seq: 1,
      text: "A",
    });

    refs.activeSessionId.value = "s-2";
    refs.activeSession.value = refs.sessions.value.find((s) => s.id === "s-2");

    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-2",
      dialogProcessId: "dp-s2",
      turnScopeId: "turn-s2",
      messageId: "message-s2",
      seq: 2,
      text: "B",
    });

    refs.activeSessionId.value = "s-1";
    refs.activeSession.value = refs.sessions.value.find((s) => s.id === "s-1");

    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-s1",
      turnScopeId: "turn-s1",
      messageId: "message-s1",
      seq: 1,
      text: "C",
    });

    const s1Assistant = refs.sessions.value
      .find((session) => session.id === "s-1")
      .messages.find((message) => message.dialogProcessId === "dp-s1");
    const s2Assistant = refs.sessions.value
      .find((session) => session.id === "s-2")
      .messages.find((message) => message.dialogProcessId === "dp-s2");

    expect(s1Assistant?.content).toBe("C");
    expect(s2Assistant?.content).toBe("AB");
  });

  it("RC-02: applyReconnectData + realtime event mixed replay still deduplicates by sequence", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({
        sessionId: "s-1", messageId: "message-mix", dialogProcessId: "dp-mix", turnScopeId: "turn-mix",
      }),
    ];

    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          hasRunningTask: true,
          currentRun: { sessionId: "s-1", dialogProcessId: "dp-mix", turnScopeId: "turn-mix", state: "sending", seq: 2 },
          dialogProcesses: [
            {
              dialogProcessId: "dp-mix",
              messages: [
                createAuthoritativeMessageEnvelope("llm_delta", {
                  messageId: "message-mix", dialogProcessId: "dp-mix", turnScopeId: "turn-mix", seq: 1, text: "A",
                }),
                createAuthoritativeMessageEnvelope("llm_delta", {
                  messageId: "message-mix", dialogProcessId: "dp-mix", turnScopeId: "turn-mix", seq: 2, text: "B",
                }),
              ],
            },
          ],
        },
      ],
    });

    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-mix",
      turnScopeId: "turn-mix",
      messageId: "message-mix",
      seq: 2,
      text: "B2",
    });
    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-mix",
      turnScopeId: "turn-mix",
      messageId: "message-mix",
      seq: 3,
      text: "C",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-mix",
    );
    expect(assistant?.content).toBe("ABC");
    expect(api.__test.appliedReconnectSeqByDialogProcessId["dp-mix"]).toBe(3);
  });

  it("RC-03: large reconnect batch (>1000 envelopes) can be applied without crash", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({
        sessionId: "s-1", messageId: "message-big", dialogProcessId: "dp-big", turnScopeId: "turn-big",
      }),
    ];
    const bigBatch = Array.from({ length: 1200 }).map((_, index) =>
      createAuthoritativeMessageEnvelope("llm_delta", {
        sessionId: "s-1",
        messageId: "message-big",
        turnScopeId: "turn-big",
        seq: index + 1,
        text: "x",
        dialogProcessId: "dp-big",
      }),
    );

    await expect(
      api.applyReconnectData({
        sessions: [
          {
            sessionId: "s-1",
            hasRunningTask: true,
            currentRun: { sessionId: "s-1", dialogProcessId: "dp-big", turnScopeId: "turn-big", state: "sending", seq: 1200 },
            dialogProcesses: [{ dialogProcessId: "dp-big", messages: bigBatch }],
          },
        ],
      }),
    ).resolves.toBeUndefined();

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-big",
    );
    expect(assistant?.content?.length).toBe(1200);
    expect(api.__test.appliedReconnectSeqByDialogProcessId["dp-big"]).toBe(1200);
  });
});
