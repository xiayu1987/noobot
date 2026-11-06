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
  projectToolMessageNames,
  projectToolResultName,
  projectToolDefinitionNames,
  restoreToolOutputNames,
} from "../src/index.js";

const bindings = { read_file: { bindingName: "nb_read" } };

test("result identity projects without rewriting opaque payloads or requiring a message name", () => {
  const binding = createToolNameBinding({ tools: [{ name: "read_file" }], bindings });
  const result = {
    ok: true,
    toolName: "read_file",
    data: { toolName: "business value", text: "read_file", path: "read_file.txt" },
  };
  for (const toolId of [undefined, "read_file"]) {
    assert.deepEqual(projectToolResultName(result, toolId, binding.toBindingName), {
      ...result,
      toolName: "nb_read",
    });
  }
  assert.equal(result.toolName, "read_file");
  const external = { ok: true, content: [{ type: "text", text: "read_file" }] };
  assert.equal(projectToolResultName(external, undefined, binding.toBindingName), external);
  assert.throws(
    () => projectToolResultName(result, "search", binding.toBindingName),
    /tool result identity mismatch/,
  );
  assert.throws(
    () =>
      projectToolResultName({ ok: true, toolName: "unknown" }, undefined, binding.toBindingName),
    /unbound tool identity/,
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
