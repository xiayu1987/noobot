/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildCapabilityModelMessages } from "../src/capabilities/handlers/shared/model-message-factory.js";

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
