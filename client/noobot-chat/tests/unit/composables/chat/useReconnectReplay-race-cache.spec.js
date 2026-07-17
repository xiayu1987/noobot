/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixture, createFakeProcessStore } from "./helpers/useReconnectReplayHelper";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

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
    ];
    refs.sessions.value.find((session) => session.id === "s-2").messages = [
      { role: RoleEnum.USER, content: "s2-q" },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-2",
      dialogProcessId: "dp-s2",
      seq: 1,
      text: "A",
    });

    refs.activeSessionId.value = "s-2";
    refs.activeSession.value = refs.sessions.value.find((s) => s.id === "s-2");

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-2",
      dialogProcessId: "dp-s2",
      seq: 2,
      text: "B",
    });

    refs.activeSessionId.value = "s-1";
    refs.activeSession.value = refs.sessions.value.find((s) => s.id === "s-1");

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-s1",
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
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];

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
                { event: StreamEventEnum.DELTA, data: { seq: 1, text: "A", dialogProcessId: "dp-mix" } },
                { event: StreamEventEnum.DELTA, data: { seq: 2, text: "B", dialogProcessId: "dp-mix" } },
              ],
            },
          ],
        },
      ],
    });

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-mix",
      seq: 2,
      text: "B2",
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-mix",
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
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];
    const bigBatch = Array.from({ length: 1200 }).map((_, index) => ({
      event: StreamEventEnum.DELTA,
      data: {
        seq: index + 1,
        text: "x",
        dialogProcessId: "dp-big",
      },
    }));

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
