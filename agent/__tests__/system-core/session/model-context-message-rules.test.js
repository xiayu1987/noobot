import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveMainModelFinalMessages,
  resolveMainModelHistoryMessages,
  resolveMainModelIncrementalMessages,
  resolveMainModelSystemMessages,
} from "../../../src/system-core/session/utils/context-window-normalizer.js";
import { markCurrentTurnArraySummarized } from "../../../src/system-core/context/session/summarized-message-policy.js";

function contents(messages = []) {
  return messages.map((item = {}) => String(item.content || item.tool_call_id || item.tool_calls?.[0]?.id || ""));
}

test("model-context rules 1.1: systemMessages keeps latest injected system by type, drops summarized non-current, preserves order without clipping", () => {
  const input = [
    { role: "system", content: "main-system-1" },
    {
      role: "system",
      content: "plugin-system-old",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "policy_patch",
    },
    {
      role: "system",
      content: "plugin-system-latest",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "policy_patch",
    },
    { role: "system", content: "summarized-old-system", summarized: true },
    {
      role: "system",
      content: "current-system-context-even-if-summarized",
      summarized: true,
      additional_kwargs: { noobotInternalMessageType: "system_context" },
    },
    ...Array.from({ length: 12 }, (_, index) => ({
      role: "system",
      content: `main-system-extra-${index + 1}`,
    })),
  ];

  const result = resolveMainModelSystemMessages({ sourceMessages: input });

  assert.deepEqual(contents(result), [
    "main-system-1",
    "plugin-system-latest",
    "current-system-context-even-if-summarized",
    ...Array.from({ length: 12 }, (_, index) => `main-system-extra-${index + 1}`),
  ]);
  assert.equal(result.length, 15);
});

test("model-context rules 1.2: historyMessages keeps non-system unsummarized messages from first actual user to latest assistant for latest 3 rounds", () => {
  const dialogs = Array.from({ length: 6 }, (_, index) => {
    const number = index + 1;
    const dialogFields = number % 2 === 0
      ? { dialogId: `dlg-${number}` }
      : { dialogProcessId: `dlg-${number}` };
    return [
      { role: "user", content: `aux-injected-${number}`, injectedBy: "agent-plugin", ...dialogFields },
      { role: "user", content: `aux-user-meta-${number}`, additional_kwargs: { noobotInternalMessageType: "user_meta" }, ...dialogFields },
      { role: "user", content: `aux-recovered-summary-${number}`, recoveredFromUnpairedTaskSummary: true, ...dialogFields },
      { role: "user", content: `actual-user-${number}-first`, ...dialogFields },
      { role: "system", content: `system-${number}`, ...dialogFields },
      { role: "user", content: `actual-user-${number}-second`, ...dialogFields },
      { role: "assistant", content: `assistant-${number}-old`, ...dialogFields },
      { role: "tool", content: `tool-${number}`, ...dialogFields },
      { role: "assistant", content: `assistant-${number}-summarized`, summarized: true, ...dialogFields },
      { role: "assistant", content: `assistant-${number}-latest`, ...dialogFields },
      { role: "tool", content: `after-latest-tool-${number}`, ...dialogFields },
    ];
  }).flat();

  const result = resolveMainModelHistoryMessages({ sourceMessages: dialogs });

  assert.deepEqual(contents(result), [
    "actual-user-4-first",
    "actual-user-4-second",
    "assistant-4-old",
    "tool-4",
    "assistant-4-latest",
    "actual-user-5-first",
    "actual-user-5-second",
    "assistant-5-old",
    "tool-5",
    "assistant-5-latest",
    "actual-user-6-first",
    "actual-user-6-second",
    "assistant-6-old",
    "tool-6",
    "assistant-6-latest",
  ]);
});

test("model-context rules 1.3: incrementalMessages keeps unsummarized tool/plugin/main-flow increments in actual order without clipping", () => {
  const input = [
    { role: "user", content: "current-user", dialogProcessId: "current" },
    {
      role: "assistant",
      content: "",
      dialogProcessId: "current",
      tool_calls: [{ id: "call-1", function: { name: "execute_script", arguments: "{}" } }],
    },
    { role: "tool", content: "tool-result", tool_call_id: "call-1", dialogProcessId: "current" },
    {
      role: "user",
      content: "plugin-increment",
      injectedMessage: true,
      injectedBy: "agent-plugin",
      injectedMessageType: "guidance",
      dialogProcessId: "current",
    },
    {
      role: "system",
      content: "main-flow-increment",
      injectedMessage: true,
      injectedBy: "main-flow",
      injectedMessageType: "runtime_hint",
      dialogProcessId: "current",
    },
    { role: "assistant", content: "summarized-drop", summarized: true, dialogProcessId: "current" },
    ...Array.from({ length: 12 }, (_, index) => ({
      role: "assistant",
      content: `increment-extra-${index + 1}`,
      dialogProcessId: "current",
    })),
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
      { role: "system", content: "sys-1" },
      { role: "system", content: "sys-drop", summarized: true },
      { role: "system", content: "sys-2" },
    ],
    historyMessages: [
      { role: "user", content: "history-user-1", dialogProcessId: "history-1" },
      { role: "assistant", content: "history-assistant-1", dialogProcessId: "history-1" },
    ],
    incrementalMessages: [
      { role: "user", content: "incremental-user", dialogProcessId: "current" },
      { role: "assistant", content: "incremental-assistant", dialogProcessId: "current" },
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
    systemMessages: [{ role: "system", content: "plain-system" }],
    historyMessages: [
      { role: "user", content: "plain-history-user", dialogProcessId: "plain-history" },
      { role: "assistant", content: "plain-history-assistant", dialogProcessId: "plain-history" },
    ],
    incrementalMessages: [{ role: "user", content: "plain-current", dialogProcessId: "plain-current" }],
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
    { role: "user", content: "current-user" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call-exec", function: { name: "execute_script", arguments: "{}" } }],
    },
    { role: "tool", content: "{\"toolName\":\"execute_script\",\"ok\":true}", tool_call_id: "call-exec" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call-summary", function: { name: "task_summary", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"task_summary\",\"ok\":true,\"phaseSummary\":\"阶段小结\"}",
      tool_call_id: "call-summary",
    },
  ];

  const marked = markCurrentTurnArraySummarized(messages);

  assert.equal(marked[1]?.summarized, true);
  assert.equal(marked[2]?.summarized, true);
  assert.equal(marked[3]?.summarized, undefined);
  assert.equal(marked[4]?.summarized, undefined);
});
