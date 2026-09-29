/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it } from "vitest";
import { effectScope, nextTick, reactive } from "vue";
import { useThinkingTimeline } from "../../../../../src/modules/chat/composables/thinkingPanelTimeline.js";

function toolMessage(index) {
  return {
    role: "assistant",
    type: "tool_call",
    messageUid: `uid-${index}`,
    messageId: `message-${index}`,
    sessionId: "session-a",
    turnScopeId: "turn-a",
    dialogProcessId: "process-a",
    content: "",
    toolTimeline: [
      {
        key: `call:call-${index}`,
        toolCallId: `call-${index}`,
        tool: "read_file",
        args: { path: `/file-${index}` },
        result: "ok",
        call: { eventId: `call-event-${index}`, sequence: index * 2 + 1 },
        resultEvent: { eventId: `result-event-${index}`, sequence: index * 2 + 2 },
      },
    ],
    activityTimeline: [],
  };
}

describe("thinking panel round timeline reactivity", () => {
  let scope = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountRound() {
    const live = {
      role: "assistant",
      messageUid: "uid-live",
      messageId: "message-live",
      sessionId: "session-a",
      turnScopeId: "turn-a",
      dialogProcessId: "process-a",
      content: "",
      pending: true,
      toolTimeline: [],
      activityTimeline: [],
    };
    const allMessages = reactive([toolMessage(0), toolMessage(1), live]);
    const props = reactive({ messageItem: allMessages[2], allMessages, variant: "panel" });
    scope = effectScope();
    const timeline = scope.run(() =>
      useThinkingTimeline(
        props,
        (key) => key,
        () => ({ running: true }),
      ),
    );
    return { allMessages, live: allMessages[2], timeline };
  }

  it("keeps the round projection stable while only answer content streams", async () => {
    const { live, timeline } = mountRound();
    const before = timeline.currentExecutionLogs.value;
    expect(before.map((log) => log.toolCallId)).toEqual(["call-0", "call-0", "call-1", "call-1"]);

    live.content += "streamed answer";
    await nextTick();

    expect(timeline.currentExecutionLogs.value).toBe(before);
  });

  it("reprojects the round when a sibling tool timeline changes", async () => {
    const { allMessages, timeline } = mountRound();
    const before = timeline.currentExecutionLogs.value;

    allMessages[1].toolTimeline[0].result = "updated";
    await nextTick();

    const after = timeline.currentExecutionLogs.value;
    expect(after).not.toBe(before);
    expect(after.at(-1).detailValue).not.toEqual(before.at(-1).detailValue);
  });
});
