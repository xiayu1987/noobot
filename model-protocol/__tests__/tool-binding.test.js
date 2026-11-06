/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertToolExecution,
  collectToolMessageIds,
  createToolNameBinding,
  projectToolChoiceNames,
  projectToolMessageNames,
  renderToolNameReferences,
  requireToolBindingConfig,
  restoreToolOutputNames,
} from "../src/index.js";
import { createNamespacedToolId } from "../src/protocol/tool-identity-node.js";

const bindings = { read_file: { bindingName: "nb_read" } };

test("execution requires an active stable identity matching the supplied tool", () => {
  const binding = createToolNameBinding({
    tools: [{ name: "read_file" }],
    historyToolIds: ["retired_tool"],
    bindings,
  });
  assert.doesNotThrow(() => assertToolExecution(binding, "read_file", { name: "read_file" }));
  for (const name of ["nb_read", "retired_tool", "unknown"]) {
    assert.throws(() => assertToolExecution(binding, name, { name }), /undeclared tool identity/);
  }
  for (const tool of [{ name: "other" }, {}]) {
    assert.throws(
      () => assertToolExecution(binding, "read_file", tool),
      /tool execution identity mismatch/,
    );
  }
});

test("binding snapshots use exact names and keep historical tools non-executable", () => {
  const config = structuredClone(bindings);
  const binding = createToolNameBinding({
    tools: [{ name: "read_file" }],
    historyToolIds: ["retired_tool"],
    bindings: config,
  });
  config.read_file.bindingName = "changed";
  assert.equal(binding.toBindingName("read_file"), "nb_read");
  assert.equal(binding.toToolId("nb_read"), "read_file");
  assert.equal(binding.toBindingName("retired_tool"), "retired_tool");
  for (const name of ["read_file", "NB_READ", "retired_tool", "unknown"]) {
    assert.throws(() => binding.toToolId(name), /undeclared tool bindingName/);
  }
});

test("invalid and conflicting explicit configuration is rejected without a default", () => {
  for (const bindingName of ["", "a b", "a.b", "x".repeat(65), null, 1]) {
    assert.throws(
      () => requireToolBindingConfig({ read_file: { bindingName } }),
      /invalid tool bindingName/,
    );
  }
  for (const invalid of [
    null,
    [],
    { read_file: {} },
    { read_file: { bindingName: "ok", extra: true } },
  ]) {
    assert.throws(() => requireToolBindingConfig(invalid), /bindings/);
  }
  assert.throws(
    () => createToolNameBinding({ tools: [{ name: "read_file" }, { name: "read_file" }] }),
    /duplicate tool identity/,
  );
  assert.throws(
    () => createToolNameBinding({ tools: [{ name: "read_file" }, { name: "nb_read" }], bindings }),
    /duplicate tool bindingName/,
  );
  assert.throws(
    () =>
      createToolNameBinding({
        tools: [{ name: "read_file" }],
        historyToolIds: ["nb_read"],
        bindings,
      }),
    /duplicate tool bindingName/,
  );
  assert.throws(
    () => requireToolBindingConfig({ a: { bindingName: "same" }, b: { bindingName: "same" } }),
    /duplicate tool bindingName/,
  );
  assert.throws(
    () => createToolNameBinding({ tools: [{ name: "source.tool" }] }),
    /invalid tool bindingName/,
  );
  const binding = createToolNameBinding({
    tools: [{ name: "source.tool" }],
    bindings: { "source.tool": { bindingName: "source_tool" } },
  });
  assert.equal(binding.toToolId("source_tool"), "source.tool");
});

test("canonical and raw provider calls project together without editing user text or arguments", () => {
  const binding = createToolNameBinding({ tools: [{ name: "read_file" }], bindings });
  const message = {
    role: "assistant",
    content: [
      { type: "text", text: "read_file" },
      { type: "tool_use", name: "read_file", id: "c1", input: { path: "read_file" } },
    ],
    tool_calls: [{ id: "c1", name: "read_file", args: { path: "read_file" } }],
    additional_kwargs: {
      tool_calls: [{ id: "c1", function: { name: "read_file", arguments: "{}" } }],
    },
    response_metadata: {
      output: [{ type: "function_call", name: "read_file", call_id: "c1", arguments: "{}" }],
    },
  };
  assert.deepEqual(collectToolMessageIds([message]), ["read_file"]);
  const projected = projectToolMessageNames(message, (name) => binding.toBindingName(name));
  assert.equal(projected.tool_calls[0].name, "nb_read");
  assert.equal(projected.content[1].name, "nb_read");
  assert.equal(projected.additional_kwargs.tool_calls[0].function.name, "nb_read");
  assert.equal(projected.response_metadata.output[0].name, "nb_read");
  assert.equal(projected.content[0].text, "read_file");
  assert.equal(projected.tool_calls[0].args.path, "read_file");
  assert.equal(message.tool_calls[0].name, "read_file");
  const output = restoreToolOutputNames(
    {
      toolCalls: projected.tool_calls,
      content: projected.content,
      responseOutput: projected.response_metadata.output,
    },
    binding,
  );
  assert.equal(output.toolCalls[0].name, "read_file");
  assert.equal(output.content[1].name, "read_file");
  assert.equal(output.responseOutput[0].name, "read_file");
});

test("tool choices and explicit documentation references follow the same protocol", () => {
  const binding = createToolNameBinding({ tools: [{ name: "read_file" }], bindings });
  for (const choice of ["auto", "none", "required", "any"])
    assert.equal(projectToolChoiceNames(choice, binding), choice);
  assert.equal(projectToolChoiceNames("read_file", binding), "nb_read");
  assert.deepEqual(
    projectToolChoiceNames({ type: "function", function: { name: "read_file" } }, binding),
    { type: "function", function: { name: "nb_read" } },
  );
  assert.deepEqual(
    renderToolNameReferences(
      { read_file: ["Use {{tool:read_file}}; literal read_file"] },
      bindings,
    ),
    { read_file: ["Use nb_read; literal read_file"] },
  );
});

test("signed calls fail explicitly when renaming would change signed data", () => {
  const message = { content: [{ type: "tool_use", name: "read_file", signature: "opaque" }] };
  assert.throws(() => projectToolMessageNames(message, () => "nb_read"), /signed tool call/);
});

test("MCP identities are stable across order, punctuation, long names and server boundaries", () => {
  const names = ["weather.search", "weather/search", "x".repeat(200)];
  const ids = names.map((name) => createNamespacedToolId("mcp", "one", name));
  assert.equal(new Set(ids).size, names.length);
  assert.deepEqual(
    [...names].reverse().map((name) => createNamespacedToolId("mcp", "one", name)),
    [...ids].reverse(),
  );
  assert.ok(ids.every((id) => /^[a-zA-Z0-9_-]{1,64}$/.test(id)));
  assert.notEqual(ids[0], createNamespacedToolId("mcp", "two", names[0]));
  assert.throws(() => createNamespacedToolId("mcp", "", "tool"), /tool identity requires/);
});
