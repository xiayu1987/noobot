/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveModelFinalMessages as protocolResolveModelFinalMessages,
  resolveModelHistoryMessages as protocolResolveModelHistoryMessages,
  resolveModelIncrementalMessages as protocolResolveModelIncrementalMessages,
  resolveModelSystemMessages as protocolResolveModelSystemMessages,
} from "@noobot/context-protocol/policy/window";
import { projectTurnCompletionMessages } from "@noobot/context-protocol/policy/turn-completion";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { createMessageUid } from "@noobot/context-protocol/message/message-identity";

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
const resolveModelFinalMessages = (options = {}) =>
  protocolResolveModelFinalMessages(projectWindowOptions(options));
const resolveModelHistoryMessages = (options = {}) =>
  protocolResolveModelHistoryMessages(projectWindowOptions(options));
const resolveModelIncrementalMessages = (options = {}) =>
  protocolResolveModelIncrementalMessages(projectWindowOptions(options));
const resolveModelSystemMessages = (options = {}) =>
  protocolResolveModelSystemMessages(projectWindowOptions(options));

const boundaryPolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY);

const MAIN_MODEL_HISTORY_ROUND_LIMIT = TURN_THRESHOLDS.session.mainModelHistoryRoundLimit;
const resolveMainModelFinalMessages = (options = {}) =>
  resolveModelFinalMessages({ historyLimit: MAIN_MODEL_HISTORY_ROUND_LIMIT, ...options });
const resolveMainModelHistoryMessages = (options = {}) =>
  resolveModelHistoryMessages({ historyLimit: MAIN_MODEL_HISTORY_ROUND_LIMIT, ...options });
const resolveMainModelIncrementalMessages = (options = {}) =>
  resolveModelIncrementalMessages(options);
const resolveMainModelSystemMessages = (options = {}) => resolveModelSystemMessages(options);

function contents(messages = []) {
  return messages.map((item = {}) =>
    String(item.content || item.tool_call_id || item.tool_calls?.[0]?.id || ""),
  );
}

test("model-context rules 1.1: systemMessages preserves every unsummarized injection and consumes summary marks", () => {
  const input = [
    sessionRecord({ role: "system", content: "main-system-1" }),
    sessionRecord({
      role: "system",
      content: "plugin-system-old",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "policy_patch",
    }),
    sessionRecord({
      role: "system",
      content: "plugin-system-latest",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "policy_patch",
    }),
    sessionRecord({ role: "system", content: "summarized-old-system", summarized: true }),
    sessionRecord({
      role: "system",
      content: "current-system-context-even-if-summarized",
      summarized: true,
      noobotInternalMessageType: "system_context",
    }),
    ...Array.from({ length: 12 }, (_, index) =>
      sessionRecord({
        role: "system",
        content: `main-system-extra-${index + 1}`,
      }),
    ),
  ];

  const result = resolveMainModelSystemMessages({ sourceMessages: input });

  assert.deepEqual(contents(result), [
    "main-system-1",
    "plugin-system-old",
    "plugin-system-latest",
    "current-system-context-even-if-summarized",
    ...Array.from({ length: 12 }, (_, index) => `main-system-extra-${index + 1}`),
  ]);
  assert.equal(result.length, 16);
});

test("model-context rules 1.2: historyMessages keeps non-system unsummarized messages in natural dialog groups for default latest rounds", () => {
  const totalRounds = MAIN_MODEL_HISTORY_ROUND_LIMIT + 1;
  const dialogs = Array.from({ length: totalRounds }, (_, index) => {
    const number = index + 1;
    const dialogFields = { dialogProcessId: `dlg-${number}` };
    return [
      sessionRecord({
        injectedMessage: true,
        injectedMessageType: "agent_plugin",
        role: "user",
        content: `aux-injected-${number}`,
        injectedBy: "agent-plugin",
        ...dialogFields,
      }),
      sessionRecord({
        role: "user",
        content: `aux-user-meta-${number}`,
        noobotInternalMessageType: "user_meta",
        ...dialogFields,
      }),
      sessionRecord({
        role: "user",
        content: `aux-recovered-summary-${number}`,

        ...dialogFields,
      }),
      sessionRecord({ role: "user", content: `actual-user-${number}-first`, ...dialogFields }),
      sessionRecord({ role: "system", content: `system-${number}`, ...dialogFields }),
      sessionRecord({ role: "user", content: `actual-user-${number}-second`, ...dialogFields }),
      sessionRecord({ role: "assistant", content: `assistant-${number}-old`, ...dialogFields }),
      sessionRecord({ role: "tool", content: `tool-${number}`, ...dialogFields }),
      sessionRecord({
        role: "assistant",
        content: `assistant-${number}-summarized`,
        summarized: true,
        ...dialogFields,
      }),
      sessionRecord({ role: "assistant", content: `assistant-${number}-latest`, ...dialogFields }),
      sessionRecord({ role: "tool", content: `after-latest-tool-${number}`, ...dialogFields }),
    ];
  }).flat();

  const result = resolveMainModelHistoryMessages({ sourceMessages: dialogs });

  assert.deepEqual(
    contents(result),
    Array.from({ length: MAIN_MODEL_HISTORY_ROUND_LIMIT }, (_, index) => {
      const number = totalRounds - MAIN_MODEL_HISTORY_ROUND_LIMIT + index + 1;
      return [
        `aux-injected-${number}`,
        `aux-user-meta-${number}`,
        `aux-recovered-summary-${number}`,
        `actual-user-${number}-first`,
        `actual-user-${number}-second`,
        `assistant-${number}-old`,
        `tool-${number}`,
        `assistant-${number}-latest`,
        `after-latest-tool-${number}`,
      ];
    }).flat(),
  );
});

test("model-context rules 1.2: historyMessages rejects messages without dialog identity", () => {
  assert.throws(
    () =>
      resolveMainModelHistoryMessages({
        sourceMessages: [
          sessionRecord({ role: "user", content: "legacy-u1" }),
          sessionRecord({ role: "assistant", content: "legacy-a1" }),
          sessionRecord({ role: "user", content: "legacy-u2" }),
          sessionRecord({ role: "assistant", content: "legacy-a2" }),
        ],
      }),
    /history context message requires additional_kwargs\.dialogProcessId/,
  );
});

test("model-context rules 1.3: incrementalMessages keeps unsummarized tool/plugin/main-flow increments in actual order without clipping", () => {
  const input = [
    sessionRecord({ role: "user", content: "current-user", dialogProcessId: "current" }),
    sessionRecord({
      role: "assistant",
      content: "",
      dialogProcessId: "current",
      tool_calls: [{ id: "call-1", function: { name: "execute_script", arguments: "{}" } }],
    }),
    sessionRecord({
      role: "tool",
      content: "tool-result",
      tool_call_id: "call-1",
      dialogProcessId: "current",
    }),
    sessionRecord({
      role: "user",
      content: "plugin-increment",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "guidance",
      dialogProcessId: "current",
    }),
    sessionRecord({
      role: "system",
      content: "main-flow-increment",
      injectedMessage: true,
      injectedBy: "main-flow",
      injectedMessageType: "runtime_hint",
      dialogProcessId: "current",
    }),
    sessionRecord({
      role: "assistant",
      content: "summarized-drop",
      summarized: true,
      dialogProcessId: "current",
    }),
    ...Array.from({ length: 12 }, (_, index) =>
      sessionRecord({
        role: "assistant",
        content: `increment-extra-${index + 1}`,
        dialogProcessId: "current",
      }),
    ),
  ];

  const result = resolveMainModelIncrementalMessages({
    sourceMessages: input,
    currentDialogProcessId: "current",
  });

  assert.deepEqual(contents(result), [
    "current-user",
    "call-1",
    "tool-result",
    "plugin-increment",
    "main-flow-increment",
    ...Array.from({ length: 12 }, (_, index) => `increment-extra-${index + 1}`),
  ]);
  assert.equal(result.length, 17);
});

test("model-context rules 1: finalMessages equals systemMessages + historyMessages + incrementalMessages", () => {
  const result = resolveMainModelFinalMessages({
    systemMessages: [
      sessionRecord({ role: "system", content: "sys-1" }),
      sessionRecord({ role: "system", content: "sys-drop", summarized: true }),
      sessionRecord({ role: "system", content: "sys-2" }),
    ],
    historyMessages: [
      sessionRecord({ role: "user", content: "history-user-1", dialogProcessId: "history-1" }),
      sessionRecord({
        role: "assistant",
        content: "history-assistant-1",
        dialogProcessId: "history-1",
      }),
    ],
    incrementalMessages: [
      sessionRecord({ role: "user", content: "incremental-user", dialogProcessId: "current" }),
      sessionRecord({
        role: "assistant",
        content: "incremental-assistant",
        dialogProcessId: "current",
      }),
    ],
    currentDialogProcessId: "current",
  });

  assert.deepEqual(contents(result.system), ["sys-1", "sys-2"]);
  assert.deepEqual(contents(result.history), ["history-user-1", "history-assistant-1"]);
  assert.deepEqual(contents(result.incremental), ["incremental-user", "incremental-assistant"]);
  assert.deepEqual(contents(result.messages), [
    "sys-1",
    "sys-2",
    "history-user-1",
    "history-assistant-1",
    "incremental-user",
    "incremental-assistant",
  ]);
});

test("model-context rules 3: main-flow final message resolution works without harness plugin state", () => {
  const source = {
    systemMessages: [sessionRecord({ role: "system", content: "plain-system" })],
    historyMessages: [
      sessionRecord({
        role: "user",
        content: "plain-history-user",
        dialogProcessId: "plain-history",
      }),
      sessionRecord({
        role: "assistant",
        content: "plain-history-assistant",
        dialogProcessId: "plain-history",
      }),
    ],
    incrementalMessages: [
      sessionRecord({ role: "user", content: "plain-current", dialogProcessId: "plain-current" }),
    ],
    currentDialogProcessId: "plain-current",
  };
  const before = JSON.stringify(source);

  const result = resolveMainModelFinalMessages(source);

  assert.deepEqual(contents(result.messages), [
    "plain-system",
    "plain-history-user",
    "plain-history-assistant",
    "plain-current",
  ]);
  assert.equal(JSON.stringify(source), before);
});

test("model-context rules 2 note: agent-side summary marking policy remains unchanged for task_summary pairs", () => {
  const messages = [
    sessionRecord({ role: "user", content: "current-user" }),
    sessionRecord({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call-exec", function: { name: "execute_script", arguments: "{}" } }],
    }),
    sessionRecord({
      role: "tool",
      content: '{"toolName":"execute_script","ok":true}',
      tool_call_id: "call-exec",
    }),
    sessionRecord({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call-summary",
          function: { name: "task_summary", arguments: "{}" },
          contextPolicy: boundaryPolicy,
        },
      ],
    }),
    sessionRecord({
      role: "tool",
      content: '{"toolName":"task_summary","ok":true,"phaseSummary":"阶段小结"}',
      tool_call_id: "call-summary",
      contextPolicy: boundaryPolicy,
    }),
  ];

  const marked = projectTurnCompletionMessages(messages);

  assert.equal(marked[1]?.summarized, true);
  assert.equal(marked[2]?.summarized, true);
  assert.equal(marked[3]?.summarized, undefined);
  assert.equal(marked[4]?.summarized, undefined);
});

test("model-context rules: cross-block duplicate current user stays only in incremental", () => {
  const result = resolveMainModelFinalMessages({
    systemMessages: [sessionRecord({ role: "system", content: "sys" })],
    historyMessages: [
      sessionRecord({
        role: "user",
        content: "same",
        messageUid: "current-user",
        dialogProcessId: "d-current",
        turnScopeId: "t-current",
      }),
      sessionRecord({ role: "assistant", content: "old answer", dialogProcessId: "d-old" }),
    ],
    incrementalMessages: [
      sessionRecord({
        role: "user",
        content: "same",
        messageUid: "current-user",
        dialogProcessId: "d-current",
        turnScopeId: "t-current",
      }),
      sessionRecord({
        role: "user",
        content: "[用户元信息]\n{}",
        dialogProcessId: "d-current",
        turnScopeId: "t-current",
      }),
    ],
  });

  assert.deepEqual(
    result.messages.map((item) => item.content),
    ["sys", "old answer", "same", "[用户元信息]\n{}"],
  );
});
