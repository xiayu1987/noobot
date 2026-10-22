/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTurnCompletionPolicy,
  projectTurnCompletionMessages,
} from "@noobot/context-protocol/policy/turn-completion";
import { shouldMarkCurrentTurnSummarizedMessage as protocolShouldMarkCurrentTurnSummarizedMessage } from "@noobot/context-protocol/policy/summary";
import { createCurrentTurnMessagesStore } from "../../src/runtime/turn/current-turn-ledger.js";
import { resolveModelHistoryMessages as protocolResolveModelHistoryMessages } from "@noobot/context-protocol/policy/window";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/policy/injected-message";
import { filterForModelContext as protocolFilterForModelContext } from "@noobot/context-protocol/policy/message";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { resolveContextMessageKey } from "@noobot/context-protocol/message/codec";

function sessionRecord(record) {
  return { messageUid: createMessageUid(), ...record };
}
function toContext(messages = []) {
  return messages.map((message) => projectSessionRecordToContextMessage(message));
}
const WINDOW_MESSAGE_KEYS = [
  "sourceMessages",
  "systemMessages",
  "historyMessages",
  "incrementalMessages",
];
function projectWindowOptions(options = {}) {
  const projected = { ...options };
  for (const key of WINDOW_MESSAGE_KEYS) {
    if (Array.isArray(options[key])) projected[key] = toContext(options[key]);
  }
  return projected;
}
const resolveModelHistoryMessages = (options = {}) =>
  protocolResolveModelHistoryMessages(projectWindowOptions(options));
const filterForModelContext = (messages = []) => protocolFilterForModelContext(toContext(messages));
const shouldMarkCurrentTurnSummarizedMessage = (record = {}) =>
  protocolShouldMarkCurrentTurnSummarizedMessage(projectSessionRecordToContextMessage(record));

const boundaryPolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY);

test("projectTurnCompletionMessages preserves only latest task_summary call and result", () => {
  const oldAssistantMessage = sessionRecord({
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call_task_summary_old",
        type: "function",
        function: {
          name: "task_summary",
          arguments: "{}",
        },
        contextPolicy: boundaryPolicy,
      },
    ],
  });
  const oldToolMessage = sessionRecord({
    role: "tool",
    content: JSON.stringify({ toolName: "task_summary", ok: true }),
    tool_call_id: "call_task_summary_old",
    toolName: "task_summary",
    contextPolicy: boundaryPolicy,
  });
  const latestAssistantMessage = sessionRecord({
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call_task_summary_latest",
        type: "function",
        function: {
          name: "task_summary",
          arguments: "{}",
        },
        contextPolicy: boundaryPolicy,
      },
    ],
  });
  const latestToolMessage = sessionRecord({
    role: "tool",
    content: JSON.stringify({ toolName: "task_summary", ok: true }),
    tool_call_id: "call_task_summary_latest",
    toolName: "task_summary",
    contextPolicy: boundaryPolicy,
  });

  assert.equal(shouldMarkCurrentTurnSummarizedMessage(oldAssistantMessage), false);
  assert.equal(shouldMarkCurrentTurnSummarizedMessage(oldToolMessage), false);

  const result = projectTurnCompletionMessages([
    oldAssistantMessage,
    oldToolMessage,
    sessionRecord({ role: "user", content: "next task" }),
    latestAssistantMessage,
    latestToolMessage,
  ]);

  assert.equal(result[0].summarized, true);
  assert.equal(result[1].summarized, true);
  assert.equal(result[2].summarized, undefined);
  assert.equal(result[3].summarized, undefined);
  assert.equal(result[4].summarized, undefined);
});

test("non-summary empty assistant tool_call can be summarized with its tool result", () => {
  const assistantMessage = sessionRecord({
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call_execute",
        type: "function",
        function: {
          name: "execute_script",
          arguments: "{}",
        },
      },
    ],
  });
  const toolMessage = sessionRecord({
    role: "tool",
    content: JSON.stringify({ toolName: "execute_script", ok: true }),
    tool_call_id: "call_execute",
    toolName: "execute_script",
  });

  assert.equal(shouldMarkCurrentTurnSummarizedMessage(assistantMessage), true);
  assert.equal(shouldMarkCurrentTurnSummarizedMessage(toolMessage), true);
});

test("summarization includes every restored incremental tool call and result without duplication", () => {
  const restoredIncremental = [
    sessionRecord({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_search", name: "search", args: {}, type: "tool_call" }],
    }),
    sessionRecord({
      role: "tool",
      content: "search-result",
      tool_call_id: "call_search",
      toolName: "search",
    }),
    sessionRecord({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_read", name: "read_file", args: {}, type: "tool_call" }],
    }),
    sessionRecord({
      role: "tool",
      content: "read-result",
      tool_call_id: "call_read",
      toolName: "read_file",
    }),
  ];
  const latestSummaryCall = sessionRecord({
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call_summary",
        name: "task_summary",
        args: {},
        type: "tool_call",
        contextPolicy: boundaryPolicy,
      },
    ],
  });
  const messages = [
    sessionRecord({ role: "user", content: "restored task" }),
    ...restoredIncremental,
    latestSummaryCall,
  ];

  const marked = projectTurnCompletionMessages(messages);

  assert.equal(marked.length, 6);
  assert.deepEqual(
    marked.slice(1, 5).map((message) => message.tool_call_id || message.tool_calls?.[0]?.id),
    ["call_search", "call_search", "call_read", "call_read"],
  );
  assert.ok(marked.slice(1, 5).every((message) => message.summarized === true));
  assert.equal(marked[5].summarized, undefined);
});

test("filterForModelContext excludes only summarized in one policy", () => {
  const input = [
    sessionRecord({ role: "user", content: "keep me" }),
    sessionRecord({ role: "assistant", content: "old", summarized: true }),
    sessionRecord({
      role: "assistant",
      content: "call",
      tool_calls: [{ id: "c1", function: { name: "x" } }],
    }),
    sessionRecord({ role: "tool", content: '{"ok":true}', tool_call_id: "c1" }),
    sessionRecord({ role: "assistant", content: "keep too" }),
  ];
  const result = filterForModelContext(input);
  assert.deepEqual(
    result.map((item) => item.content),
    ["keep me", "call", '{"ok":true}', "keep too"],
  );
});

test("filterForModelContext keeps summarized current system context marker", () => {
  const input = [
    sessionRecord({ role: "system", content: "old system", summarized: true }),
    sessionRecord({
      role: "system",
      content: "current system context",
      summarized: true,
      noobotInternalMessageType: "system_context",
    }),
    sessionRecord({ role: "user", content: "task" }),
  ];
  const result = filterForModelContext(input);
  assert.deepEqual(
    result.map((item) => item.content),
    ["current system context", "task"],
  );
});

test("system is summarized while user and assistant-without-tool-calls are not", () => {
  assert.equal(
    shouldMarkCurrentTurnSummarizedMessage(sessionRecord({ role: "system", content: "note" })),
    true,
  );
  assert.equal(
    shouldMarkCurrentTurnSummarizedMessage(sessionRecord({ role: "user", content: "ask" })),
    false,
  );
  assert.equal(
    shouldMarkCurrentTurnSummarizedMessage(
      sessionRecord({ role: "assistant", content: "plain text" }),
    ),
    false,
  );
});

test("projectTurnCompletionMessages preserves every user interjection and latest ordinary injection", () => {
  const result = projectTurnCompletionMessages([
    sessionRecord({
      role: "user",
      content: "old summary prompt",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "guidance_summary_prompt",
    }),
    sessionRecord({
      role: "user",
      content: "old planning prompt",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "planning_task",
    }),
    sessionRecord({
      role: "user",
      content: "new summary prompt",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "guidance_summary_prompt",
    }),
    sessionRecord({
      role: "user",
      content: "old user interjection",
      injectedMessage: true,
      injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
    }),
    sessionRecord({
      role: "user",
      content: "new user interjection",
      injectedMessage: true,
      injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
    }),
  ]);

  assert.equal(result[0].summarized, true);
  assert.equal(result[1].summarized, undefined);
  assert.equal(result[2].summarized, undefined);
  assert.equal(result[3].summarized, undefined);
  assert.equal(result[4].summarized, undefined);
});

test("user interjections remain fully retained through completion and history", () => {
  const latestGuidance = sessionRecord({
    messageUid: "guidance-latest",
    role: "user",
    type: "message",
    content: "latest guidance",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    injectedMessage: true,
    injectedBy: "harness-plugin",
    injectedMessageType: "separate_model_relay:guidance",
    summarized: false,
  });
  const userInterjection = sessionRecord({
    messageUid: "interjection-uid-command:test",
    role: "user",
    type: "message",
    content: "不要动呼吸效果",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    injectedMessage: true,
    injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
    noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
    summarized: false,
  });
  const earlierUserInterjection = {
    ...userInterjection,
    messageUid: "interjection-uid-command:earlier",
    content: "先记住这条",
  };
  const oldGuidance = sessionRecord({
    messageUid: "guidance-old",
    role: "user",
    type: "message",
    content: "old guidance",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    injectedMessage: true,
    injectedBy: "harness-plugin",
    injectedMessageType: "separate_model_relay:guidance",
    summarized: false,
  });
  const store = createCurrentTurnMessagesStore([
    oldGuidance,
    latestGuidance,
    earlierUserInterjection,
    userInterjection,
  ]);

  applyTurnCompletionPolicy({ modelMessages: [], turnMessageStore: store });

  const retained = store.toArray();
  assert.equal(retained.find((message) => message.messageUid === "guidance-old").summarized, true);
  assert.equal(
    retained.find((message) => message.messageUid === "guidance-latest").summarized,
    false,
  );
  assert.equal(
    retained.find((message) => message.messageUid === earlierUserInterjection.messageUid)
      .summarized,
    false,
  );
  assert.equal(
    retained.find((message) => message.messageUid === userInterjection.messageUid).summarized,
    false,
  );
  assert.deepEqual(
    resolveModelHistoryMessages({ sourceMessages: retained }).map(resolveContextMessageKey),
    [latestGuidance.messageUid, earlierUserInterjection.messageUid, userInterjection.messageUid],
  );
});

test("projectTurnCompletionMessages includes restored old injections and preserves latest per type", () => {
  const injected = (content, injectedMessageType) =>
    sessionRecord({
      role: "user",
      content,
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType,
    });
  const messages = [
    injected("old guidance", "guidance"),
    injected("planning", "planning"),
    injected("new guidance", "guidance"),
    sessionRecord({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_summary",
          name: "task_summary",
          args: {},
          type: "tool_call",
          contextPolicy: boundaryPolicy,
        },
      ],
    }),
  ];

  const marked = projectTurnCompletionMessages(messages);

  assert.equal(marked[0].summarized, true);
  assert.equal(marked[1].summarized, undefined);
  assert.equal(marked[2].summarized, undefined);
  assert.equal(marked[3].summarized, undefined);
});

test("model and store projections apply one summarization scope policy", () => {
  const source = [
    sessionRecord({
      role: "user",
      content: "old guidance",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "guidance",
      lc_kwargs: {},
    }),
    sessionRecord({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_search", function: { name: "search", arguments: "{}" } }],
      lc_kwargs: {},
    }),
    sessionRecord({
      role: "tool",
      content: "search-result",
      tool_call_id: "call_search",
      toolName: "search",
      lc_kwargs: {},
    }),
    sessionRecord({
      role: "user",
      content: "new guidance",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "guidance",
      lc_kwargs: {},
    }),
    sessionRecord({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_summary",
          function: { name: "task_summary", arguments: "{}" },
          contextPolicy: boundaryPolicy,
        },
      ],
      lc_kwargs: {},
    }),
    sessionRecord({
      role: "tool",
      content: JSON.stringify({ toolName: "task_summary", ok: true }),
      tool_call_id: "call_summary",
      toolName: "task_summary",
      contextPolicy: boundaryPolicy,
      lc_kwargs: {},
    }),
  ];
  const modelMessages = projectTurnCompletionMessages(structuredClone(source));
  const store = createCurrentTurnMessagesStore(structuredClone(source));

  applyTurnCompletionPolicy({ modelMessages: [], turnMessageStore: store });

  assert.deepEqual(
    modelMessages.map((message) => message.summarized === true),
    store.toArray().map((message) => message.summarized === true),
  );
  assert.deepEqual(
    modelMessages.map((message) => message.summarized === true),
    [true, true, true, false, false, false],
  );
});

test("filterForModelContext preserves every unsummarized injected message", () => {
  const result = filterForModelContext([
    sessionRecord({
      role: "user",
      content: "old relay",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "separate_model_relay:planning",
    }),
    sessionRecord({
      role: "user",
      content: "planning prompt",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "planning_task",
    }),
    sessionRecord({
      role: "user",
      content: "new relay",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "separate_model_relay:planning",
    }),
    sessionRecord({ role: "assistant", content: "normal" }),
  ]);

  assert.deepEqual(
    result.map((item) => item.content),
    ["old relay", "planning prompt", "new relay", "normal"],
  );
});
