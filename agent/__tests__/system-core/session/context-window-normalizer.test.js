import test from "node:test";
import assert from "node:assert/strict";

import {
  filterSummarizedMessages,
  MAIN_MODEL_HISTORY_ROUND_LIMIT,
  resolveMainModelFinalMessages,
  resolveMainModelHistoryMessages,
  resolveMainModelIncrementalMessages,
} from "../../../src/system-core/session/utils/context-window-normalizer.js";
import { filterForModelContext } from "../../../src/system-core/context/session/message-context-policy.js";
import { markCurrentTurnArraySummarized } from "../../../src/system-core/context/session/summarized-message-policy.js";

test("filterSummarizedMessages removes only summarized messages", () => {
  const input = [
    { role: "user", content: "a", summarized: false },
    { role: "assistant", content: "b", summarized: true },
    { role: "tool", content: "c" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "x" } }] },
  ];
  const result = filterSummarizedMessages(input);
  assert.deepEqual(result.map((item) => item.content), ["a"]);
});

test("filterForModelContext keeps unsummarized injected history messages without latest-only dedupe", () => {
  const result = filterForModelContext([
    { role: "user", content: "下一步", dialogProcessId: "d1" },
    {
      role: "user",
      content: "[来自harness外部模型输出/planning]\nold plan",
      dialogProcessId: "d1",
      summarized: false,
    },
    {
      role: "user",
      content: "[来自harness外部模型输出/planning]\nnewer plan",
      dialogProcessId: "d2",
      summarized: false,
    },
    { role: "assistant", content: "answer", dialogProcessId: "d1" },
  ]);

  assert.deepEqual(result.map((item) => item.content), [
    "下一步",
    "[来自harness外部模型输出/planning]\nold plan",
    "[来自harness外部模型输出/planning]\nnewer plan",
    "answer",
  ]);
});


test("task_summary pair is not marked summarized and remains in model context", () => {
  const messages = [
    { role: "user", content: "u0" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_exec", function: { name: "execute_script", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_exec",
    },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_summary", function: { name: "task_summary", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"task_summary\",\"ok\":true,\"phaseSummary\":\"阶段小结内容\"}",
      tool_call_id: "call_summary",
    },
  ];

  const marked = markCurrentTurnArraySummarized(messages);
  assert.equal(marked[1]?.summarized, true);
  assert.equal(marked[2]?.summarized, true);
  assert.equal(marked[3]?.summarized, undefined);
  assert.equal(marked[4]?.summarized, undefined);

  const result = filterSummarizedMessages(marked);
  assert.deepEqual(
    result.map((item) => String(item?.tool_call_id || item?.tool_calls?.[0]?.id || item?.content || "")),
    ["u0", "call_summary", "call_summary"],
  );
  assert.equal(result[2]?.content.includes("阶段小结内容"), true);
});


test("manually summarized task_summary pair is filtered by unified summarized policy", () => {
  const input = [
    { role: "user", content: "u0" },
    {
      role: "assistant",
      content: "",
      summarized: true,
      tool_calls: [{ id: "call_summary", function: { name: "task_summary", arguments: "{}" } }],
    },
    {
      role: "tool",
      summarized: true,
      content: "{\"toolName\":\"task_summary\",\"ok\":true,\"phaseSummary\":\"历史阶段小结\"}",
      tool_call_id: "call_summary",
    },
    { role: "assistant", content: "old normal", summarized: true },
  ];

  const result = filterSummarizedMessages(input);
  assert.deepEqual(
    result.map((item) => String(item?.tool_call_id || item?.tool_calls?.[0]?.id || item?.content || "")),
    ["u0"],
  );
});


test("unpaired task_summary assistant tool call is dropped to avoid invalid model messages", () => {
  const input = [
    { role: "user", content: "u0" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_summary", function: { name: "task_summary", arguments: "{}" } }],
    },
  ];

  const result = filterSummarizedMessages(input);
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
      { role: "user", content: `u${index + 1}-first`, dialogProcessId },
      { role: "system", content: `sys${index + 1}`, dialogProcessId },
      { role: "user", content: `u${index + 1}-second`, dialogProcessId },
      { role: "assistant", content: `a${index + 1}-old`, dialogProcessId },
      { role: "assistant", content: `a${index + 1}-summarized`, summarized: true, dialogProcessId },
      { role: "assistant", content: `a${index + 1}-latest`, dialogProcessId },
      { role: "tool", content: `after-latest${index + 1}`, dialogProcessId },
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
      { role: "user", content: "injected-before-actual", injectedBy: "agent-plugin", dialogProcessId: "d1" },
      { role: "user", content: "meta", additional_kwargs: { noobotInternalMessageType: "user_meta" }, dialogProcessId: "d1" },
      { role: "user", content: "actual", dialogProcessId: "d1" },
      { role: "user", content: "injected-after-actual", injectedBy: "agent-plugin", dialogProcessId: "d1" },
      { role: "assistant", content: "old", dialogProcessId: "d1" },
      { role: "assistant", content: "latest", dialogProcessId: "d1" },
    ],
  });

  assert.deepEqual(result.map((item) => item.content), [
    "injected-before-actual",
    "meta",
    "actual",
    "injected-after-actual",
    "old",
    "latest",
  ]);
});

test("resolveMainModelHistoryMessages keeps original dialog group order instead of starting at relay user", () => {
  const result = resolveMainModelHistoryMessages({
    sourceMessages: [
      { role: "user", content: "全仓回归测试", dialogProcessId: "c826" },
      {
        role: "user",
        content: "[来自harness外部模型输出/planning]\nplan",
        dialogProcessId: "c826",
        injectedMessage: true,
        injectedBy: "harness-plugin",
        injectedMessageType: "separate_model_relay:planning",
      },
      { role: "assistant", content: "done", dialogProcessId: "c826" },
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
      { role: "user", content: "d1-user", dialogProcessId: "d1" },
      { role: "assistant", content: "d1-assistant", dialogProcessId: "d1" },
      { role: "user", content: "d2-user", dialogProcessId: "d2" },
      { role: "assistant", content: "d2-assistant", dialogProcessId: "d2" },
      { role: "user", content: "d3-user", dialogProcessId: "d3" },
      { role: "assistant", content: "d3-assistant", dialogProcessId: "d3" },
      { role: "assistant", content: "d1-late-assistant", dialogProcessId: "d1" },
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

test("resolveMainModelHistoryMessages ignores messages without dialogProcessId", () => {
  const result = resolveMainModelHistoryMessages({
    sourceMessages: [
      { role: "user", content: "u1-first" },
      { role: "system", content: "sys1" },
      { role: "user", content: "u1-second" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ],
  });

  assert.deepEqual(
    result.map((item) => item.content),
    [],
  );
});

test("resolveMainModelHistoryMessages keeps unsummarized injected messages in ordinary history", () => {
  const result = resolveMainModelHistoryMessages({
    sourceMessages: [
      { role: "user", content: "u1", dialogProcessId: "d1" },
      {
        role: "user",
        content: "latest injected",
        injectedBy: "agent-plugin",
        injectedMessageType: "summary",
        dialogProcessId: "d1",
      },
      { role: "assistant", content: "a1", dialogProcessId: "d1" },
    ],
  });

  assert.deepEqual(result.map((item) => item.content), ["u1", "latest injected", "a1"]);
});

test("resolveMainModelHistoryMessages does not dedupe injected messages beyond summarized flag", () => {
  const result = resolveMainModelHistoryMessages({
    sourceMessages: [
      { role: "user", content: "u1", dialogProcessId: "d1" },
      {
        role: "user",
        content: "old injected but unsummarized",
        injectedBy: "agent-plugin",
        injectedMessageType: "summary",
        dialogProcessId: "d1",
      },
      {
        role: "user",
        content: "new injected",
        injectedBy: "agent-plugin",
        injectedMessageType: "summary",
        dialogProcessId: "d1",
      },
      { role: "assistant", content: "a1", dialogProcessId: "d1" },
    ],
  });

  assert.deepEqual(
    result.map((item) => item.content),
    ["u1", "old injected but unsummarized", "new injected", "a1"],
  );
});

test("resolveMainModelIncrementalMessages filters summarized messages without clipping", () => {
  const result = resolveMainModelIncrementalMessages({
    sourceMessages: Array.from({ length: 22 }, (_, index) => ({
      role: "user",
      content: `m${index + 1}`,
      summarized: index === 5,
    })),
  });

  assert.equal(result.length, 21);
  assert.equal(result[0].content, "m1");
  assert.equal(result.at(-1).content, "m22");
  assert.equal(result.some((item) => item.content === "m6"), false);
});

test("resolveMainModelIncrementalMessages filters summarized messages from additional kwargs", () => {
  const result = resolveMainModelIncrementalMessages({
    sourceMessages: [
      { role: "user", content: "keep" },
      { role: "assistant", content: "drop-additional", additional_kwargs: { summarized: true } },
      {
        role: "assistant",
        content: "drop-lc-additional",
        lc_kwargs: { additional_kwargs: { summarized: true } },
      },
      { role: "assistant", content: "keep-assistant" },
    ],
  });

  assert.deepEqual(
    result.map((item) => item.content),
    ["keep", "keep-assistant"],
  );
});

test("resolveMainModelFinalMessages composes system history incremental in order", () => {
  const result = resolveMainModelFinalMessages({
    systemMessages: [{ role: "system", content: "sys" }],
    historyMessages: [
      { role: "user", content: "u", dialogProcessId: "d1" },
      { role: "assistant", content: "a", dialogProcessId: "d1" },
    ],
    incrementalMessages: [{ role: "user", content: "inc" }],
  });

  assert.deepEqual(result.messages.map((item) => item.content), ["sys", "u", "a", "inc"]);
});

test("main-flow context resolution does not mutate source message order or count when unsummarized", () => {
  const systemMessages = [{ role: "system", content: "sys-1" }];
  const historyMessages = [
    { role: "user", content: "u1", dialogProcessId: "d1" },
    { role: "assistant", content: "a1", dialogProcessId: "d1" },
    { role: "user", content: "u2", dialogProcessId: "d2" },
    { role: "assistant", content: "a2", dialogProcessId: "d2" },
  ];
  const incrementalMessages = [
    { role: "user", content: "current", dialogProcessId: "d3" },
    { role: "assistant", content: "current-a", dialogProcessId: "d3" },
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
  assert.deepEqual(historyMessages.map((item) => item.content), ["u1", "a1", "u2", "a2"]);
  assert.equal(historyMessages.length, 4);
  assert.deepEqual(incrementalMessages.map((item) => item.content), ["current", "current-a"]);
  assert.equal(incrementalMessages.length, 2);
});

test("resolveMainModelIncrementalMessages preserves actual order for tool, plugin, and main-flow increments", () => {
  const incrementalMessages = [
    { role: "user", content: "main-user", dialogProcessId: "d1" },
    {
      role: "assistant",
      content: "",
      dialogProcessId: "d1",
      tool_calls: [{ id: "call-1", function: { name: "read_file", arguments: "{}" } }],
    },
    { role: "tool", content: "tool-result", tool_call_id: "call-1", dialogProcessId: "d1" },
    {
      role: "user",
      content: "plugin-guidance",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "guidance",
      dialogProcessId: "d1",
    },
    {
      role: "system",
      content: "main-injected-system",
      injectedMessage: true,
      injectedBy: "main-flow",
      injectedMessageType: "runtime_hint",
      dialogProcessId: "d1",
    },
    { role: "assistant", content: "main-assistant", dialogProcessId: "d1" },
  ];

  const result = resolveMainModelIncrementalMessages({
    sourceMessages: incrementalMessages,
    currentDialogProcessId: "d1",
  });

  assert.deepEqual(
    result.map((item = {}) => item.content || item.tool_call_id || item.tool_calls?.[0]?.id),
    ["main-user", "call-1", "tool-result", "plugin-guidance", "main-injected-system", "main-assistant"],
  );
  assert.deepEqual(
    incrementalMessages.map((item = {}) => item.content || item.tool_call_id || item.tool_calls?.[0]?.id),
    ["main-user", "call-1", "tool-result", "plugin-guidance", "main-injected-system", "main-assistant"],
  );
});
