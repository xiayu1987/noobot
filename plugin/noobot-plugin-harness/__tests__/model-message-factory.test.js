/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildCapabilityModelMessages } from "../src/capabilities/handlers/shared/model/message-factory.js";

test("buildCapabilityModelMessages rewrites assistant tool_calls into semantic user message", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            function: {
              name: "execute_script",
              arguments: "{\"command\":\"ls -la\"}",
            },
          },
        ],
      },
    ],
  });

  assert.equal(output.length, 1);
  assert.equal(output[0].role, "user");
  assert.equal(output[0].content, "语义执行 execute_script脚本,参数{\"command\":\"ls -la\"}");
});

test("buildCapabilityModelMessages rewrites tool role into assistant role", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [
      {
        role: "tool",
        content: "{\"ok\":true}",
        tool_call_id: "call_1",
      },
    ],
  });

  assert.equal(output.length, 1);
  assert.equal(output[0].role, "assistant");
  assert.equal(output[0].content, "{\"ok\":true}");
});

test("buildCapabilityModelMessages keeps regular messages unchanged", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [
      { role: "system", content: "s1" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ],
    constraints: ["c1"],
    task: "t1",
  });

  assert.deepEqual(output, [
    { role: "system", content: "s1" },
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "system", content: "c1" },
    { role: "user", content: "t1" },
  ]);
});

test("buildCapabilityModelMessages keeps frontendUserMessage for unchanged messages", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [
      {
        role: "user",
        content: "u1",
        frontendUserMessage: true,
        additional_kwargs: { frontendUserMessage: true },
      },
      {
        role: "assistant",
        content: "a1",
        frontendUserMessage: true,
      },
    ],
  });

  assert.deepEqual(output, [
    { role: "user", content: "u1", frontendUserMessage: true },
    { role: "assistant", content: "a1", frontendUserMessage: true },
  ]);
});

test("buildCapabilityModelMessages only keeps role and content for converted message types", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [
      {
        role: "assistant",
        content: "",
        frontendUserMessage: true,
        tool_calls: [{ function: { name: "execute_script", arguments: "{\"command\":\"pwd\"}" } }],
      },
      {
        role: "tool",
        content: "{\"ok\":true}",
        tool_call_id: "call_1",
      },
    ],
  });
  assert.deepEqual(output, [
    { role: "user", content: "语义执行 execute_script脚本,参数{\"command\":\"pwd\"}" },
    { role: "assistant", content: "{\"ok\":true}" },
  ]);
  assert.deepEqual(Object.keys(output[0]).sort(), ["content", "role"]);
  assert.deepEqual(Object.keys(output[1]).sort(), ["content", "role"]);
});


test("buildCapabilityModelMessages filters summarized agent messages", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: [
      { role: "user", content: "keep" },
      { role: "assistant", content: "drop", summarized: true },
      { role: "assistant", content: "drop-lc", lc_kwargs: { summarized: true } },
      { role: "assistant", content: "keep2" },
    ],
  });

  assert.deepEqual(output, [
    { role: "user", content: "keep" },
    { role: "assistant", content: "keep2" },
  ]);
});


test("buildCapabilityModelMessages clips capability agent context to latest 20 messages", () => {
  const output = buildCapabilityModelMessages({
    locale: "zh-CN",
    agentMessages: Array.from({ length: 22 }, (_, index) => ({
      role: "user",
      content: `m${index + 1}`,
    })),
    task: "task",
  });

  assert.deepEqual(
    output.filter((item) => String(item.content || "").startsWith("m")).map((item) => item.content),
    ["m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12", "m13", "m14", "m15", "m16", "m17", "m18", "m19", "m20", "m21", "m22"],
  );
  assert.equal(output.at(-1).content, "task");
});
