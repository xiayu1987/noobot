/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { projectTurnCompletionMessages } from "@noobot/context-protocol/policy/turn-completion";
import {
  resolveModelFinalMessages as protocolResolveModelFinalMessages,
  resolveModelHistoryMessages as protocolResolveModelHistoryMessages,
  resolveModelIncrementalMessages as protocolResolveModelIncrementalMessages,
} from "@noobot/context-protocol/policy/window";
import { filterForModelContext as protocolFilterForModelContext } from "@noobot/context-protocol/policy/message";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { createMessageUid } from "@noobot/session-protocol/message-identity";

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
const filterForModelContext = (messages = []) => protocolFilterForModelContext(toContext(messages));

const boundaryPolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY);

const MAIN_MODEL_HISTORY_ROUND_LIMIT = TURN_THRESHOLDS.session.mainModelHistoryRoundLimit;
const resolveMainModelFinalMessages = (options = {}) =>
  resolveModelFinalMessages({ historyLimit: MAIN_MODEL_HISTORY_ROUND_LIMIT, ...options });
const resolveMainModelHistoryMessages = (options = {}) =>
  resolveModelHistoryMessages({ historyLimit: MAIN_MODEL_HISTORY_ROUND_LIMIT, ...options });
const resolveMainModelIncrementalMessages = (options = {}) =>
  resolveModelIncrementalMessages(options);

test("filterForModelContext removes only summarized messages", () => {
  const input = [
    sessionRecord({ role: "user", content: "a", summarized: false }),
    sessionRecord({ role: "assistant", content: "b", summarized: true }),
    sessionRecord({ role: "tool", content: "c" }),
    sessionRecord({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "c1", function: { name: "x" } }],
    }),
  ];
  const result = filterForModelContext(input);
  assert.deepEqual(
    result.map((item) => item.content),
    ["a"],
  );
});

test("filterForModelContext keeps unsummarized injected history messages without latest-only dedupe", () => {
  const result = filterForModelContext([
    sessionRecord({ role: "user", content: "下一步", dialogProcessId: "d1" }),
    sessionRecord({
      role: "user",
      content: "[来自harness外部模型输出/planning]\nold plan",
      dialogProcessId: "d1",
      summarized: false,
    }),
    sessionRecord({
      role: "user",
      content: "[来自harness外部模型输出/planning]\nnewer plan",
      dialogProcessId: "d2",
      summarized: false,
    }),
    sessionRecord({ role: "assistant", content: "answer", dialogProcessId: "d1" }),
  ]);

  assert.deepEqual(
    result.map((item) => item.content),
    [
      "下一步",
      "[来自harness外部模型输出/planning]\nold plan",
      "[来自harness外部模型输出/planning]\nnewer plan",
      "answer",
    ],
  );
});

test("task_summary pair is not marked summarized and remains in model context", () => {
  const messages = [
    sessionRecord({ role: "user", content: "u0" }),
    sessionRecord({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_exec", function: { name: "execute_script", arguments: "{}" } }],
    }),
    sessionRecord({
      role: "tool",
      content: '{"toolName":"execute_script","ok":true}',
      tool_call_id: "call_exec",
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
    }),
    sessionRecord({
      role: "tool",
      content: '{"toolName":"task_summary","ok":true,"phaseSummary":"阶段小结内容"}',
      tool_call_id: "call_summary",
      contextPolicy: boundaryPolicy,
    }),
  ];

  const marked = projectTurnCompletionMessages(messages);
  assert.equal(marked[1]?.summarized, true);
  assert.equal(marked[2]?.summarized, true);
  assert.equal(marked[3]?.summarized, undefined);
  assert.equal(marked[4]?.summarized, undefined);

  const result = filterForModelContext(marked);
  assert.deepEqual(
    result.map((item) =>
      String(item?.tool_call_id || item?.tool_calls?.[0]?.id || item?.content || ""),
    ),
    ["u0", "call_summary", "call_summary"],
  );
  assert.equal(result[2]?.content.includes("阶段小结内容"), true);
});

test("manually summarized task_summary pair is filtered by unified summarized policy", () => {
  const input = [
    sessionRecord({ role: "user", content: "u0" }),
    sessionRecord({
      role: "assistant",
      content: "",
      summarized: true,
      tool_calls: [{ id: "call_summary", function: { name: "task_summary", arguments: "{}" } }],
    }),
    sessionRecord({
      role: "tool",
      summarized: true,
      content: '{"toolName":"task_summary","ok":true,"phaseSummary":"历史阶段小结"}',
      tool_call_id: "call_summary",
    }),
    sessionRecord({ role: "assistant", content: "old normal", summarized: true }),
  ];

  const result = filterForModelContext(input);
  assert.deepEqual(
    result.map((item) =>
      String(item?.tool_call_id || item?.tool_calls?.[0]?.id || item?.content || ""),
    ),
    ["u0"],
  );
});

test("unpaired task_summary assistant tool call is dropped to avoid invalid model messages", () => {
  const input = [
    sessionRecord({ role: "user", content: "u0" }),
    sessionRecord({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_summary", function: { name: "task_summary", arguments: "{}" } }],
    }),
  ];

  const result = filterForModelContext(input);
  assert.deepEqual(
    result.map((item) => String(item?.tool_calls?.[0]?.id || item?.content || "")),
    ["u0"],
  );
});

test("resolveMainModelHistoryMessages keeps non-system unsummarized messages in explicit dialog groups for default latest rounds", () => {
  const totalRounds = MAIN_MODEL_HISTORY_ROUND_LIMIT + 1;
  const input = Array.from({ length: totalRounds }, (_, index) => {
    const dialogProcessId = `d${index + 1}`;
    return [
      sessionRecord({ role: "user", content: `u${index + 1}-first`, dialogProcessId }),
      sessionRecord({ role: "system", content: `sys${index + 1}`, dialogProcessId }),
      sessionRecord({ role: "user", content: `u${index + 1}-second`, dialogProcessId }),
      sessionRecord({ role: "assistant", content: `a${index + 1}-old`, dialogProcessId }),
      sessionRecord({
        role: "assistant",
        content: `a${index + 1}-summarized`,
        summarized: true,
        dialogProcessId,
      }),
      sessionRecord({ role: "assistant", content: `a${index + 1}-latest`, dialogProcessId }),
      sessionRecord({ role: "tool", content: `after-latest${index + 1}`, dialogProcessId }),
    ];
  }).flat();

  const result = resolveMainModelHistoryMessages({ sourceMessages: input });

  assert.deepEqual(
    result.map((item) => item.content),
    Array.from({ length: MAIN_MODEL_HISTORY_ROUND_LIMIT }, (_, index) => {
      const number = totalRounds - MAIN_MODEL_HISTORY_ROUND_LIMIT + index + 1;
      return [
        `u${number}-first`,
        `u${number}-second`,
        `a${number}-old`,
        `a${number}-latest`,
        `after-latest${number}`,
      ];
    }).flat(),
  );
});

test("resolveMainModelHistoryMessages keeps original dialog group order and unsummarized injected messages", () => {
  const result = resolveMainModelHistoryMessages({
    sourceMessages: [
      sessionRecord({
        injectedMessage: true,
        injectedMessageType: "agent_plugin",
        role: "user",
        content: "injected-before-actual",
        injectedBy: "agent-plugin",
        dialogProcessId: "d1",
      }),
      sessionRecord({
        role: "user",
        content: "meta",
        noobotInternalMessageType: "user_meta",
        dialogProcessId: "d1",
      }),
      sessionRecord({ role: "user", content: "actual", dialogProcessId: "d1" }),
      sessionRecord({
        injectedMessage: true,
        injectedMessageType: "agent_plugin",
        role: "user",
        content: "injected-after-actual",
        injectedBy: "agent-plugin",
        dialogProcessId: "d1",
      }),
      sessionRecord({ role: "assistant", content: "old", dialogProcessId: "d1" }),
      sessionRecord({ role: "assistant", content: "latest", dialogProcessId: "d1" }),
    ],
  });

  assert.deepEqual(
    result.map((item) => item.content),
    ["injected-before-actual", "meta", "actual", "injected-after-actual", "old", "latest"],
  );
});

test("resolveMainModelHistoryMessages keeps original dialog group order instead of starting at relay user", () => {
  const result = resolveMainModelHistoryMessages({
    sourceMessages: [
      sessionRecord({ role: "user", content: "全仓回归测试", dialogProcessId: "c826" }),
      sessionRecord({
        role: "user",
        content: "[来自harness外部模型输出/planning]\nplan",
        dialogProcessId: "c826",
        injectedMessage: true,
        injectedBy: "harness-plugin",
        injectedMessageType: "separate_model_relay:planning",
      }),
      sessionRecord({ role: "assistant", content: "done", dialogProcessId: "c826" }),
    ],
  });

  assert.deepEqual(
    result.map((item) => item.content),
    ["全仓回归测试", "[来自harness外部模型输出/planning]\nplan", "done"],
  );
});

test("resolveMainModelHistoryMessages orders dialog groups by first natural occurrence", () => {
  const result = resolveMainModelHistoryMessages({
    sourceMessages: [
      sessionRecord({ role: "user", content: "d1-user", dialogProcessId: "d1" }),
      sessionRecord({ role: "assistant", content: "d1-assistant", dialogProcessId: "d1" }),
      sessionRecord({ role: "user", content: "d2-user", dialogProcessId: "d2" }),
      sessionRecord({ role: "assistant", content: "d2-assistant", dialogProcessId: "d2" }),
      sessionRecord({ role: "user", content: "d3-user", dialogProcessId: "d3" }),
      sessionRecord({ role: "assistant", content: "d3-assistant", dialogProcessId: "d3" }),
      sessionRecord({ role: "assistant", content: "d1-late-assistant", dialogProcessId: "d1" }),
    ],
    historyLimit: 3,
  });

  assert.deepEqual(
    result.map((item) => item.content),
    [
      "d1-user",
      "d1-assistant",
      "d1-late-assistant",
      "d2-user",
      "d2-assistant",
      "d3-user",
      "d3-assistant",
    ],
  );
});

test("resolveMainModelHistoryMessages selects recent user dialogs when artifact writes are interleaved", () => {
  const sourceMessages = [
    sessionRecord({
      role: "user",
      content: "u1",
      dialogProcessId: "d1",
      messageOrigin: "natural",
      userMetaMaterialized: true,
      ts: "2026-07-27T01:00:00Z",
    }),
    sessionRecord({
      role: "user",
      content: "u2",
      dialogProcessId: "d2",
      messageOrigin: "natural",
      userMetaMaterialized: true,
      ts: "2026-07-27T02:00:00Z",
    }),
    sessionRecord({
      role: "assistant",
      content: "a1 late",
      dialogProcessId: "d1",
      ts: "2026-07-27T03:00:00Z",
    }),
    sessionRecord({
      role: "user",
      content: "u3",
      dialogProcessId: "d3",
      messageOrigin: "natural",
      userMetaMaterialized: true,
      ts: "2026-07-27T03:00:00Z",
    }),
    sessionRecord({
      role: "user",
      content: "u4",
      dialogProcessId: "d4",
      messageOrigin: "natural",
      userMetaMaterialized: true,
      ts: "2026-07-27T04:00:00Z",
    }),
    sessionRecord({
      role: "user",
      content: "u5",
      dialogProcessId: "d5",
      messageOrigin: "natural",
      userMetaMaterialized: true,
      ts: "2026-07-27T05:00:00Z",
    }),
    sessionRecord({
      role: "user",
      content: "u6",
      dialogProcessId: "d6",
      messageOrigin: "natural",
      userMetaMaterialized: true,
      ts: "2026-07-27T06:00:00Z",
    }),
    sessionRecord({
      role: "assistant",
      content: "a2 very late",
      dialogProcessId: "d2",
      ts: "2026-07-27T07:00:00Z",
    }),
  ];

  const result = resolveMainModelHistoryMessages({ sourceMessages, historyLimit: 5 });

  assert.deepEqual(
    result.map((item) => item.content),
    ["u2", "a2 very late", "u3", "u4", "u5", "u6"],
  );
});

test("resolveMainModelHistoryMessages ignores external dialog order and uses first occurrence", () => {
  const sourceMessages = [
    sessionRecord({
      role: "user",
      content: "second",
      dialogProcessId: "d2",
      ts: "2026-07-27T01:00:00Z",
    }),
    sessionRecord({
      role: "user",
      content: "first",
      dialogProcessId: "d1",
      ts: "2026-07-27T02:00:00Z",
    }),
  ];
  const result = resolveMainModelHistoryMessages({
    sourceMessages,
    historyLimit: 1,
    dialogOrder: [
      { dialogProcessId: "d1", dialogOrdinal: 1 },
      { dialogProcessId: "d2", dialogOrdinal: 2 },
    ],
  });
  assert.deepEqual(
    result.map((item) => item.content),
    ["first"],
  );
});

test("resolveMainModelHistoryMessages rejects history without dialog identity", () => {
  assert.throws(
    () =>
      resolveMainModelHistoryMessages({
        sourceMessages: [
          sessionRecord({ role: "user", content: "u1-first" }),
          sessionRecord({ role: "system", content: "sys1" }),
          sessionRecord({ role: "user", content: "u1-second" }),
          sessionRecord({ role: "assistant", content: "a1" }),
          sessionRecord({ role: "user", content: "u2" }),
          sessionRecord({ role: "assistant", content: "a2" }),
        ],
      }),
    /history context message requires additional_kwargs\.dialogProcessId/,
  );
});

test("resolveMainModelHistoryMessages keeps unsummarized injected messages in ordinary history", () => {
  const result = resolveMainModelHistoryMessages({
    sourceMessages: [
      sessionRecord({ role: "user", content: "u1", dialogProcessId: "d1" }),
      sessionRecord({
        injectedMessage: true,
        role: "user",
        content: "latest injected",
        injectedBy: "agent-plugin",
        injectedMessageType: "summary",
        dialogProcessId: "d1",
      }),
      sessionRecord({ role: "assistant", content: "a1", dialogProcessId: "d1" }),
    ],
  });

  assert.deepEqual(
    result.map((item) => item.content),
    ["u1", "latest injected", "a1"],
  );
});

test("resolveMainModelHistoryMessages does not dedupe injected messages beyond summarized flag", () => {
  const result = resolveMainModelHistoryMessages({
    sourceMessages: [
      sessionRecord({ role: "user", content: "u1", dialogProcessId: "d1" }),
      sessionRecord({
        injectedMessage: true,
        role: "user",
        content: "old injected but unsummarized",
        injectedBy: "agent-plugin",
        injectedMessageType: "summary",
        dialogProcessId: "d1",
      }),
      sessionRecord({
        injectedMessage: true,
        role: "user",
        content: "new injected",
        injectedBy: "agent-plugin",
        injectedMessageType: "summary",
        dialogProcessId: "d1",
      }),
      sessionRecord({ role: "assistant", content: "a1", dialogProcessId: "d1" }),
    ],
  });

  assert.deepEqual(
    result.map((item) => item.content),
    ["u1", "old injected but unsummarized", "new injected", "a1"],
  );
});

test("resolveMainModelIncrementalMessages filters summarized messages without clipping", () => {
  const result = resolveMainModelIncrementalMessages({
    sourceMessages: Array.from({ length: 22 }, (_, index) =>
      sessionRecord({
        role: "user",
        content: `m${index + 1}`,
        summarized: index === 5,
      }),
    ),
  });

  assert.equal(result.length, 21);
  assert.equal(result[0].content, "m1");
  assert.equal(result.at(-1).content, "m22");
  assert.equal(
    result.some((item) => item.content === "m6"),
    false,
  );
});

test("resolveMainModelFinalMessages composes system history incremental in order", () => {
  const result = resolveMainModelFinalMessages({
    systemMessages: [sessionRecord({ role: "system", content: "sys" })],
    historyMessages: [
      sessionRecord({ role: "user", content: "u", dialogProcessId: "d1" }),
      sessionRecord({ role: "assistant", content: "a", dialogProcessId: "d1" }),
    ],
    incrementalMessages: [sessionRecord({ role: "user", content: "inc" })],
  });

  assert.deepEqual(
    result.messages.map((item) => item.content),
    ["sys", "u", "a", "inc"],
  );
});

test("main-flow context resolution does not mutate source message order or count when unsummarized", () => {
  const systemMessages = [sessionRecord({ role: "system", content: "sys-1" })];
  const historyMessages = [
    sessionRecord({ role: "user", content: "u1", dialogProcessId: "d1" }),
    sessionRecord({ role: "assistant", content: "a1", dialogProcessId: "d1" }),
    sessionRecord({ role: "user", content: "u2", dialogProcessId: "d2" }),
    sessionRecord({ role: "assistant", content: "a2", dialogProcessId: "d2" }),
  ];
  const incrementalMessages = [
    sessionRecord({ role: "user", content: "current", dialogProcessId: "d3" }),
    sessionRecord({ role: "assistant", content: "current-a", dialogProcessId: "d3" }),
  ];
  const before = JSON.stringify({ systemMessages, historyMessages, incrementalMessages });

  const resolved = resolveMainModelFinalMessages({
    systemMessages,
    historyMessages,
    incrementalMessages,
    currentDialogProcessId: "d3",
  });

  assert.deepEqual(
    resolved.messages.map((item) => item.content),
    ["sys-1", "u1", "a1", "u2", "a2", "current", "current-a"],
  );
  assert.equal(JSON.stringify({ systemMessages, historyMessages, incrementalMessages }), before);
  assert.deepEqual(
    historyMessages.map((item) => item.content),
    ["u1", "a1", "u2", "a2"],
  );
  assert.equal(historyMessages.length, 4);
  assert.deepEqual(
    incrementalMessages.map((item) => item.content),
    ["current", "current-a"],
  );
  assert.equal(incrementalMessages.length, 2);
});

test("resolveMainModelIncrementalMessages preserves actual order for tool, plugin, and main-flow increments", () => {
  const incrementalMessages = [
    sessionRecord({ role: "user", content: "main-user", dialogProcessId: "d1" }),
    sessionRecord({
      role: "assistant",
      content: "",
      dialogProcessId: "d1",
      tool_calls: [{ id: "call-1", function: { name: "read_file", arguments: "{}" } }],
    }),
    sessionRecord({
      role: "tool",
      content: "tool-result",
      tool_call_id: "call-1",
      dialogProcessId: "d1",
    }),
    sessionRecord({
      role: "user",
      content: "plugin-guidance",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "guidance",
      dialogProcessId: "d1",
    }),
    sessionRecord({
      role: "system",
      content: "main-injected-system",
      injectedMessage: true,
      injectedBy: "main-flow",
      injectedMessageType: "runtime_hint",
      dialogProcessId: "d1",
    }),
    sessionRecord({ role: "assistant", content: "main-assistant", dialogProcessId: "d1" }),
  ];

  const result = resolveMainModelIncrementalMessages({
    sourceMessages: incrementalMessages,
    currentDialogProcessId: "d1",
  });

  assert.deepEqual(
    result.map((item = {}) => item.content || item.tool_call_id || item.tool_calls?.[0]?.id),
    [
      "main-user",
      "call-1",
      "tool-result",
      "plugin-guidance",
      "main-injected-system",
      "main-assistant",
    ],
  );
  assert.deepEqual(
    incrementalMessages.map(
      (item = {}) => item.content || item.tool_call_id || item.tool_calls?.[0]?.id,
    ),
    [
      "main-user",
      "call-1",
      "tool-result",
      "plugin-guidance",
      "main-injected-system",
      "main-assistant",
    ],
  );
});
