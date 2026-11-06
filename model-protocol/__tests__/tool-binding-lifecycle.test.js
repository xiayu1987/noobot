/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  getToolNameBinding,
  runWithToolNameBinding,
} from "../src/protocol/tool-binding-scope-node.js";
import {
  collectToolMessageIds,
  compileToolNamePrompt,
  createToolNameBinding,
  projectToolChoiceNames,
  projectToolMessageNames,
  projectToolNamePrompt,
  restoreToolOutputNames,
  TOOL_CALL_NAME_BINDING,
} from "../src/index.js";

const binding = createToolNameBinding({
  tools: [{ name: "read_file" }],
  historyToolIds: ["retired"],
  bindings: { read_file: { bindingName: "nb_read" } },
});

test("concurrent execution scopes retain independent bindings across async work", async () => {
  const other = createToolNameBinding({
    tools: [{ name: "read_file" }],
    bindings: { read_file: { bindingName: "other_read" } },
  });
  let releaseFirst;
  let releaseSecond;
  const firstReady = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const secondReady = new Promise((resolve) => {
    releaseSecond = resolve;
  });
  await Promise.all([
    runWithToolNameBinding(binding, async () => {
      releaseFirst();
      await secondReady;
      assert.equal(getToolNameBinding(), binding);
      await runWithToolNameBinding(other, async () => {
        await Promise.resolve();
        assert.equal(getToolNameBinding(), other);
      });
      assert.equal(getToolNameBinding(), binding);
    }),
    runWithToolNameBinding(other, async () => {
      await firstReady;
      releaseSecond();
      await Promise.resolve();
      assert.equal(getToolNameBinding(), other);
    }),
  ]);
  assert.equal(getToolNameBinding(), undefined);
});

test("choices require active identities in every supported shape", () => {
  assert.equal(binding.toBindingName("retired"), "retired");
  for (const choice of ["retired", { name: "retired" }, { function: { name: "retired" } }])
    assert.throws(() => projectToolChoiceNames(choice, binding), /undeclared tool identity/);
  assert.deepEqual(binding.toolIds, ["read_file"]);
  assert.ok(Object.isFrozen(binding.toolIds));
});

test("only explicit prompt references render; surrounding and inserted text stays opaque", () => {
  const literal = "file {{tool:bad.name}} and {{tool:read_file}}.txt";
  assert.equal(projectToolNamePrompt(literal, binding), literal);
  const content = [
    ...compileToolNamePrompt("Use {{tool:read_file}}: "),
    { type: "text", text: literal },
  ];
  const before = structuredClone(content);
  assert.deepEqual(projectToolNamePrompt(content, binding), [
    { type: "text", text: `Use nb_read: ${literal}` },
  ]);
  assert.deepEqual(content, before);
});

for (const type of ["tool_use", "tool_call", "function_call", "custom_tool_call"]) {
  for (const nested of [false, true]) {
    test(`signed ${type} preserves raw payload and replays against the request binding (nested=${nested})`, () => {
      const providerCall = nested
        ? { type, function: { name: "nb_read", signature: "opaque", arguments: "{}" } }
        : { type, name: "nb_read", signature: "opaque", arguments: "{}" };
      const before = structuredClone(providerCall);
      const restored = restoreToolOutputNames(
        {
          toolCalls: [{ id: "call", name: "nb_read", args: {} }],
          content: [providerCall],
          responseOutput: [providerCall],
        },
        binding,
      );
      assert.equal(restored.toolCalls[0].name, "read_file");
      assert.equal(restored.toolCalls[0][TOOL_CALL_NAME_BINDING], binding);
      assert.deepEqual(JSON.parse(JSON.stringify(restored.toolCalls)), [
        { id: "call", name: "read_file", args: {} },
      ]);
      const message = {
        role: "assistant",
        content: restored.content,
        response_metadata: { output: restored.responseOutput },
      };
      assert.deepEqual(collectToolMessageIds([message]), ["read_file"]);
      const replay = projectToolMessageNames(
        JSON.parse(JSON.stringify(message)),
        binding.toBindingName,
      );
      assert.deepEqual(replay.content, [providerCall]);
      assert.deepEqual(replay.response_metadata.output, [providerCall]);
      assert.deepEqual(providerCall, before);
      assert.throws(() => projectToolMessageNames(message, () => "new_read"), /signed tool call/);
    });
  }
}

test("raw nested signed history cannot bypass rename checks in any call group", () => {
  const call = {
    type: "function_call",
    signature: "opaque",
    function: { name: "read_file", arguments: "{}" },
  };
  for (const message of [
    { content: [call] },
    { tool_calls: [call] },
    { additional_kwargs: { tool_calls: [call] } },
    { response_metadata: { output: [call] } },
  ])
    assert.throws(
      () => projectToolMessageNames(message, binding.toBindingName),
      /signed tool call/,
    );
});
