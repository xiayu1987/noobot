/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  THINKING_DETAIL_CONTENT_KIND,
  isThinkingDetailContentFact,
  isThinkingDetailInjectedMessage,
  projectThinkingDetailContentTimeline,
  selectThinkingDetailContentTimeline,
} from "../src/thinking-detail-content.js";

function message(overrides = {}) {
  return {
    messageUid: "message-uid-1",
    messageId: "message-1",
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    presentationMessageId: "presentation-1",
    ts: "2026-09-05T03:39:01.897Z",
    content: "content",
    ...overrides,
  };
}

test("projects non-control injected messages and intermediate assistant content in message order", () => {
  const timeline = projectThinkingDetailContentTimeline([
    message({
      messageUid: "assistant-source",
      role: "assistant",
      type: "tool_call",
      content: "先确认当前真实状态。",
    }),
    message({
      messageUid: "guidance-source",
      role: "user",
      type: "message",
      injectedMessage: true,
      injectedBy: "harness",
      content: "继续检查缓存事实。",
    }),
  ]);

  assert.deepEqual(
    timeline.map(({ contentId, contentKind, sourceMessageUid, text, sequence }) => ({
      contentId,
      contentKind,
      sourceMessageUid,
      text,
      sequence,
    })),
    [
      {
        contentId: "message:assistant-source",
        contentKind: THINKING_DETAIL_CONTENT_KIND.MAIN_MODEL_CONTENT,
        sourceMessageUid: "assistant-source",
        text: "先确认当前真实状态。",
        sequence: 1,
      },
      {
        contentId: "message:guidance-source",
        contentKind: THINKING_DETAIL_CONTENT_KIND.INJECTED_MESSAGE,
        sourceMessageUid: "guidance-source",
        text: "继续检查缓存事实。",
        sequence: 2,
      },
    ],
  );
  assert.equal(timeline.every(isThinkingDetailContentFact), true);
});

test("excludes explicitly marked context-control and internal injected messages", () => {
  const contextControl = message({
    injectedMessage: true,
    type: "context_control",
  });
  const internalControl = message({
    injectedMessage: true,
    noobotInternalMessageType: "noobot.task_check_prompt",
  });

  assert.equal(isThinkingDetailInjectedMessage(contextControl), false);
  assert.equal(isThinkingDetailInjectedMessage(internalControl), false);
  assert.deepEqual(projectThinkingDetailContentTimeline([contextControl, internalControl]), []);
});

test("requires persisted message identity and ignores malformed persisted detail facts", () => {
  const timeline = projectThinkingDetailContentTimeline([
    message({ messageUid: "", role: "assistant", type: "tool_call" }),
    message({ messageUid: "final", role: "assistant", type: "message" }),
  ]);

  assert.deepEqual(timeline, []);
  assert.deepEqual(
    selectThinkingDetailContentTimeline({
      thinkingContentTimeline: [
        { contentId: "event:legacy", contentKind: "thinking", text: "legacy" },
      ],
    }),
    [],
  );
});

function relayActivity(overrides = {}) {
  return {
    eventId: "activity-1",
    eventType: "thinking",
    text: "继续检查缓存事实。",
    sequence: 1,
    sequenceScopeId: "message-1",
    sequenceDomain: "message-event",
    authority: "authoritative",
    timestamp: "2026-09-05T03:39:01.897Z",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    messageId: "message-1",
    presentationMessageId: "presentation-1",
    ...overrides,
  };
}

test("injected relay message supersedes the thinking activity it was minted from", () => {
  const timeline = projectThinkingDetailContentTimeline(
    [
      message({
        messageUid: "guidance-source",
        role: "user",
        type: "message",
        injectedMessage: true,
        injectedBy: "harness",
        relayCorrelationId: "rc_1",
        content: "[来自harness外部模型输出/guidance]\n继续检查缓存事实。",
      }),
    ],
    [
      relayActivity({ eventId: "activity-relayed", relayCorrelationId: "rc_1" }),
      relayActivity({
        eventId: "activity-unrelayed",
        relayCorrelationId: "rc_2",
        text: "另一段未被中继的思考。",
        sequence: 2,
      }),
    ],
  );

  assert.deepEqual(
    timeline.map(({ contentId, contentKind }) => ({ contentId, contentKind })),
    [
      {
        contentId: "message:guidance-source",
        contentKind: THINKING_DETAIL_CONTENT_KIND.INJECTED_MESSAGE,
      },
      {
        contentId: "event:activity-unrelayed",
        contentKind: THINKING_DETAIL_CONTENT_KIND.THINKING,
      },
    ],
  );
  assert.equal(timeline.every(isThinkingDetailContentFact), true);
});

test("activities without relay correlation stay projected for legacy rounds", () => {
  const timeline = projectThinkingDetailContentTimeline(
    [
      message({
        messageUid: "legacy-guidance",
        role: "user",
        type: "message",
        injectedMessage: true,
        injectedBy: "harness",
        content: "[来自harness外部模型输出/guidance]\n历史注入。",
      }),
    ],
    [relayActivity({ eventId: "activity-legacy", text: "历史注入。" })],
  );

  assert.deepEqual(
    timeline.map((fact) => fact.contentId),
    ["message:legacy-guidance", "event:activity-legacy"],
  );
});
