/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TOOL_DEFINITION_TEMPLATE,
  collectToolMessageIds,
  createToolNameBinding,
  createToolResultIdentityResolver,
  isToolResultMessage,
  projectToolMessageNames,
  projectToolResultName,
  projectToolDefinitionNames,
  restoreToolOutputNames,
} from "../src/index.js";

const bindings = { read_file: { bindingName: "nb_read" } };

test("tool result identity uses declared message fields without class methods", () => {
  for (const declaration of [{ role: "tool" }, { type: "tool" }]) {
    const message = { ...declaration, name: "read_file", content: "opaque" };
    assert.equal(isToolResultMessage(message), true);
    assert.deepEqual(collectToolMessageIds([message]), ["read_file"]);
    assert.equal(projectToolMessageNames(message, () => "nb_read").name, "nb_read");
    assert.equal(message.name, "read_file");
  }
  assert.equal(isToolResultMessage({ type: "human", content: "tool" }), false);
});

test("result identity projects without rewriting opaque payloads or requiring a message name", () => {
  const binding = createToolNameBinding({ tools: [{ name: "read_file" }], bindings });
  const result = {
    ok: true,
    toolName: "read_file",
    data: { toolName: "business value", text: "read_file", path: "read_file.txt" },
  };
  assert.deepEqual(projectToolResultName(result, "read_file", binding.toBindingName), {
    ...result,
    toolName: "nb_read",
  });
  assert.equal(result.toolName, "read_file");
  const external = { ok: true, content: [{ type: "text", text: "read_file" }] };
  assert.equal(projectToolResultName(external, "read_file", binding.toBindingName), external);
  assert.throws(
    () => projectToolResultName(result, "search", binding.toBindingName),
    /tool result identity mismatch/,
  );
  assert.throws(
    () => projectToolResultName(result, undefined, binding.toBindingName),
    /tool identity must be a non-empty string/,
  );
});

test("result identity comes from its call across all call representations", () => {
  const call = { id: "read", name: "read_file", args: {} };
  const signed = {
    type: "signed_tool_call",
    toolId: "read_file",
    providerCall: {
      type: "function_call",
      id: "provider-item",
      call_id: "read",
      name: "nb_read",
      signature: "opaque",
    },
  };
  const resolve = createToolResultIdentityResolver([
    {
      tool_calls: [call],
      content: [signed],
      response_metadata: { output: [signed] },
      additional_kwargs: { tool_calls: [{ id: "read", function: { name: "read_file" } }] },
    },
    {
      content: [
        { type: "custom_tool_call", call_id: "custom", name: "search" },
        { type: "web_search_call", id: "server", name: "web_search" },
      ],
    },
  ]);
  assert.equal(resolve({ tool_call_id: "read" }), "read_file");
  assert.equal(resolve({ tool_call_id: "custom", name: "search" }), "search");
  assert.throws(
    () => resolve({ tool_call_id: "read", name: "search" }),
    /message identity mismatch/,
  );
  for (const id of [undefined, "", "missing", "server", "provider-item"])
    assert.throws(() => resolve({ tool_call_id: id }), /requires its matching call/);
  assert.throws(
    () => createToolResultIdentityResolver([{ tool_calls: [call, { ...call, name: "search" }] }]),
    /conflicting tool call identity/,
  );
});

test("unmarked external tool descriptions and schema text remain opaque", () => {
  const binding = createToolNameBinding({ tools: [{ name: "read_file" }], bindings });
  for (const literal of ["{{tool:read_file}}.txt", "{{tool:bad.name}}"]) {
    const source = {
      name: "read_file",
      description: literal,
      parameters: {
        type: "object",
        properties: { path: { title: literal, description: literal } },
      },
    };
    assert.deepEqual(projectToolDefinitionNames(source, binding), { ...source, name: "nb_read" });
  }
});

test("custom client calls project and restore everywhere while server calls remain opaque", () => {
  const binding = createToolNameBinding({ tools: [{ name: "read_file" }], bindings });
  const customCall = {
    type: "custom_tool_call",
    name: "read_file",
    call_id: "custom",
    input: "{{tool:read_file}}",
  };
  const serverCall = { type: "web_search_call", name: "web_search", id: "server" };
  const message = {
    role: "assistant",
    content: [customCall, serverCall],
    response_metadata: { output: [customCall, serverCall] },
  };
  assert.deepEqual(collectToolMessageIds([message]), ["read_file"]);
  const projected = projectToolMessageNames(message, binding.toBindingName);
  assert.equal(projected.content[0].name, "nb_read");
  assert.equal(projected.response_metadata.output[0].name, "nb_read");
  assert.equal(projected.content[0].input, "{{tool:read_file}}");
  assert.equal(projected.content[1], serverCall);
  const restored = restoreToolOutputNames(
    {
      toolCalls: [],
      content: projected.content,
      responseOutput: projected.response_metadata.output,
    },
    binding,
  );
  assert.equal(restored.content[0].name, "read_file");
  assert.equal(restored.responseOutput[0].name, "read_file");
  assert.equal(restored.responseOutput[1], serverCall);
});

test("definition references share the binding snapshot without editing schema data", () => {
  const config = structuredClone(bindings);
  const binding = createToolNameBinding({ tools: [{ name: "read_file" }], bindings: config });
  const literal = "{{tool:read_file}}";
  const source = {
    type: "function",
    function: {
      name: "read_file",
      [TOOL_DEFINITION_TEMPLATE]: true,
      description: `Use ${literal}`,
      parameters: {
        type: "object",
        properties: {
          [literal]: {
            description: literal,
            default: literal,
            enum: [literal],
            examples: [literal],
            anyOf: [{ description: literal, const: literal }],
          },
        },
        $defs: { ref: { description: literal } },
      },
    },
  };
  config.read_file.bindingName = "changed";
  const projected = projectToolDefinitionNames(source, binding);
  assert.equal(projected.function.name, "nb_read");
  assert.equal(projected.function.description, "Use nb_read");
  const field = projected.function.parameters.properties[literal];
  assert.equal(field.description, "nb_read");
  assert.equal(field.default, literal);
  assert.deepEqual(field.enum, [literal]);
  assert.deepEqual(field.examples, [literal]);
  assert.deepEqual(field.anyOf, [{ description: "nb_read", const: literal }]);
  assert.equal(projected.function.parameters.$defs.ref.description, "nb_read");
  assert.equal(source.function.parameters.properties[literal].description, literal);
});
