/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { computed, reactive } from "vue";
import { selectTurnPresentations } from "../../../../../../src/modules/chat/runtime/engine/turnPresentation.js";

const SESSION_ID = "session-1";

function envelope(turnScopeId = "turn-1", transferId = "transfer-1") {
  return {
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId,
    messageId: "message-1",
    identity: {
      sessionId: SESSION_ID,
      turnScopeId,
      runId: "run-1",
      producer: { type: "tool", id: "call-1" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: { attachmentId: "att-1", sessionId: SESSION_ID, attachmentSource: "model" },
          role: "primary",
          name: "report.md",
          mimeType: "text/markdown",
          size: 10,
          preview: "report",
        },
      ],
    },
    intent: {
      source: "tool",
      reason: "semantic_transfer_tool_result",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: { originalLength: 10, persisted: true },
  };
}

function assistant(turnScopeId, overrides = {}) {
  return {
    id: `assistant-${turnScopeId}`,
    messageId: `assistant-${turnScopeId}`,
    sessionId: SESSION_ID,
    role: "assistant",
    turnScopeId,
    content: "",
    activityTimeline: [],
    toolTimeline: [],
    ...overrides,
  };
}

function setup({ withEnvelope = false, terminal = "" } = {}) {
  const history = assistant("turn-0", { content: "done" });
  const live = assistant("turn-1", withEnvelope ? { transferEnvelopes: [envelope()] } : {});
  const session = reactive({
    sessionId: SESSION_ID,
    messages: [
      { id: "user-0", role: "user", sessionId: SESSION_ID, turnScopeId: "turn-0", content: "q0" },
      history,
      { id: "user-1", role: "user", sessionId: SESSION_ID, turnScopeId: "turn-1", content: "q1" },
      live,
    ],
  });
  const turnRuntimeRegistry = reactive({
    sessions: terminal
      ? { [SESSION_ID]: { turns: { "turn-0": { turnScopeId: "turn-0", terminal } } } }
      : {},
  });
  let runs = 0;
  const presented = computed(() => {
    runs += 1;
    return selectTurnPresentations({
      activeSession: session,
      workflowRegistry: {},
      turnRuntimeRegistry,
    });
  });
  return { session, presented, runs: () => runs };
}

function streamAnalysisDelta(session, index) {
  const live = session.messages[3];
  live.activityTimeline = [...live.activityTimeline, { eventId: `delta-${index}`, text: "x" }];
}

describe("selectTurnPresentations reactivity", () => {
  for (const scenario of [
    { name: "without envelopes", withEnvelope: false },
    { name: "with transfer envelopes", withEnvelope: true },
    { name: "with terminal history turn", terminal: "stopped" },
  ]) {
    it(`does not recompute on analysis deltas ${scenario.name}`, () => {
      const { session, presented, runs } = setup(scenario);
      const first = presented.value;
      expect(runs()).toBe(1);
      for (let index = 0; index < 5; index += 1) {
        streamAnalysisDelta(session, index);
        expect(presented.value).toBe(first);
      }
      expect(runs()).toBe(1);
    });
  }

  it("keeps the live assistant reference when its own envelopes already cover the turn", () => {
    const { session, presented } = setup({ withEnvelope: true });
    const live = presented.value.find((message) => message.id === "assistant-turn-1");
    expect(live).toBe(session.messages[3]);
  });

  it("still merges envelopes that only exist on sibling messages of the turn", () => {
    const { session, presented } = setup();
    session.messages[2].transferEnvelopes = [envelope("turn-1", "transfer-sibling")];
    const live = presented.value.find((message) => message.id === "assistant-turn-1");
    expect(live).not.toBe(session.messages[3]);
    expect(live.transferEnvelopes.map((item) => item.transferId)).toEqual(["transfer-sibling"]);
  });
});
