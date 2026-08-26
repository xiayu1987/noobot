/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildCapabilityModelMessages } from "../../src/capabilities/handlers/shared/model/message-factory.js";

let sourceSequence = 0;
function source(message = {}) {
  sourceSequence += 1;
  return { ...message, messageUid: `factory-source-${sourceSequence}` };
}

test("buildCapabilityModelMessages projects assistant tool calls for the observer", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [
      source({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            function: {
              name: "execute_script",
              arguments: '{"command":"ls -la"}',
            },
          },
        ],
      }),
    ],
  });

  assert.equal(output.length, 1);
  assert.equal(output[0].role, "user");
  assert.match(output[0].content, /execute_script/);
});

test("buildCapabilityModelMessages keeps assistant tool-call semantics in observer content", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [
      source({
        role: "assistant",
        content: "先检查当前配置",
        tool_calls: [
          { id: "call_1", function: { name: "read_file", arguments: '{"filePath":"a.js"}' } },
        ],
      }),
    ],
  });

  assert.equal(output.length, 1);
  assert.equal(output[0].role, "user");
  assert.match(output[0].content, /read_file/);
});

test("buildCapabilityModelMessages preserves a matched tool result", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [
      source({
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_1", function: { name: "read_file", arguments: "{}" } }],
      }),
      source({
        role: "tool",
        content: '{"ok":true}',
        tool_call_id: "call_1",
      }),
    ],
  });

  assert.equal(output.length, 2);
  assert.equal(output[1].role, "assistant");
  assert.equal(output[1].content, '{"ok":true}');
});

test("buildCapabilityModelMessages keeps regular messages unchanged", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [
      source({ role: "system", content: "s1" }),
      source({ role: "user", content: "u1" }),
      source({ role: "assistant", content: "a1" }),
    ],
    constraints: ["c1"],
    task: "t1",
  });

  assert.deepEqual(output, [
    { role: "system", content: "s1" },
    { role: "system", content: "c1" },
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "t1" },
  ]);
});

test("buildCapabilityModelMessages keeps natural-user metadata for unchanged messages", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [
      source({
        role: "user",
        content: "u1",
        messageOrigin: "natural",
        userMetaMaterialized: true,
        additional_kwargs: { messageOrigin: "natural", userMetaMaterialized: true },
      }),
      source({
        role: "assistant",
        content: "a1",
      }),
    ],
  });

  assert.deepEqual(output, [
    { role: "user", content: "u1", messageOrigin: "natural" },
    { role: "assistant", content: "a1" },
  ]);
});

test("buildCapabilityModelMessages keeps one authoritative tool execution pair", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [
      source({
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call_1", function: { name: "execute_script", arguments: '{"command":"pwd"}' } },
        ],
      }),
      source({
        role: "tool",
        content: '{"ok":true}',
        tool_call_id: "call_1",
      }),
    ],
  });
  assert.equal(output[0].role, "user");
  assert.match(output[0].content, /execute_script/);
  assert.equal(output[1].role, "assistant");
  assert.equal(output[1].content, '{"ok":true}');
});

test("buildCapabilityModelMessages preserves provided agent messages without plugin-side filtering", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [
      source({ role: "user", content: "keep" }),
      source({ role: "assistant", content: "drop", summarized: true }),
      source({ role: "assistant", content: "drop-lc", lc_kwargs: { summarized: true } }),
      source({ role: "assistant", content: "keep2" }),
    ],
  });

  assert.deepEqual(output, [
    { role: "user", content: "keep" },
    { role: "assistant", content: "drop" },
    { role: "assistant", content: "drop-lc" },
    { role: "assistant", content: "keep2" },
  ]);
});

test("buildCapabilityModelMessages does not clip capability agent context in plugin message factory", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: Array.from({ length: 22 }, (_, index) =>
      source({
        role: "user",
        content: `m${index + 1}`,
      }),
    ),
    task: "task",
  });

  assert.deepEqual(
    output.filter((item) => String(item.content || "").startsWith("m")).map((item) => item.content),
    [
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
      "m8",
      "m9",
      "m10",
      "m11",
      "m12",
      "m13",
      "m14",
      "m15",
      "m16",
      "m17",
      "m18",
      "m19",
      "m20",
      "m21",
      "m22",
    ],
  );
  assert.equal(output.at(-1).content, "task");
});

test("buildCapabilityModelMessages orders protocol, scenario policy, then responsibility", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [source({ role: "user", content: "actual user request" })],
    task: "protocol prompt",
    taskRole: "system",
    postTaskSystemMessages: ["scenario mode policy"],
    postTaskMessages: ["responsibility constraint"],
    postTaskRole: "user",
  });

  assert.deepEqual(output, [
    { role: "system", content: "protocol prompt" },
    { role: "system", content: "scenario mode policy" },
    { role: "user", content: "actual user request" },
    { role: "user", content: "responsibility constraint" },
  ]);
});
