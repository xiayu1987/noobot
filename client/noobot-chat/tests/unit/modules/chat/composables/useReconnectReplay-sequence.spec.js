/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCanonicalAssistant,
  createFixture,
  createFakeProcessStore,
} from "../helpers/useReconnectReplayHelper.js";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("SQ-02/SQ-03: out-of-order and duplicate sequence are deduplicated", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({ dialogProcessId: "dp-1" }),
    ];

    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      turnScopeId: "turn-dp-1",
      seq: 3,
      text: "C",
    });
    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      turnScopeId: "turn-dp-1",
      seq: 1,
      text: "A",
    });
    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      turnScopeId: "turn-dp-1",
      seq: 2,
      text: "B",
    });
    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      turnScopeId: "turn-dp-1",
      seq: 2,
      text: "B2",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-1",
    );
    expect(assistant?.content).toBe("C");
  });

  it("SQ-04: sequence gap is allowed and progresses watermark", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({ dialogProcessId: "dp-gap" }),
    ];

    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-gap",
      turnScopeId: "turn-dp-gap",
      seq: 5,
      text: "X",
    });
    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-gap",
      turnScopeId: "turn-dp-gap",
      seq: 6,
      text: "Y",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-gap",
    );
    expect(assistant?.content).toBe("XY");
  });

  it("SQ-01: increasing sequence applies in order and records max sequence", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({ dialogProcessId: "dp-inc" }),
    ];

    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-inc",
      turnScopeId: "turn-dp-inc",
      seq: 1,
      text: "A",
    });
    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-inc",
      turnScopeId: "turn-dp-inc",
      seq: 2,
      text: "B",
    });
    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-inc",
      turnScopeId: "turn-dp-inc",
      seq: 3,
      text: "C",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-inc",
    );
    expect(assistant?.content).toBe("ABC");
  });

  it("SQ-05: distinct protocol events at the same transport sequence are each consumed once", async () => {
    const { api, refs } = createFixture({ processStore: createFakeProcessStore() });
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q", turnScopeId: "turn-boundary" },
      {
        ...createCanonicalAssistant({ dialogProcessId: "dp-boundary", turnScopeId: "turn-boundary" }),
      },
    ];

    await api.applyCanonicalMessageEvent("thinking", {
      sessionId: "s-1",
      dialogProcessId: "dp-boundary",
      turnScopeId: "turn-boundary",
      seq: 9,
      event: "execution_step",
      text: "thinking once",
    });
    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-boundary",
      turnScopeId: "turn-boundary",
      seq: 10,
      text: "answer",
    });
    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-boundary",
      turnScopeId: "turn-boundary",
      seq: 10,
      eventId: "message-dp-boundary-llm_delta-10",
      text: " duplicate",
    });

    const assistant = refs.activeSession.value.messages[1];
    expect(assistant.content).toBe("answer");
  });
});
