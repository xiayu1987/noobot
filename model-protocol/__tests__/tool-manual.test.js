/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createToolNameBinding, TOOL_MANUAL_PROVIDER } from "../src/index.js";

test("manual providers are captured with the active request and preserve external data", () => {
  const tool = {
    name: "constructor",
    [TOOL_MANUAL_PROVIDER]: () => ({ summary: "literal {{tool:bad.name}}" }),
  };
  const binding = createToolNameBinding({
    historyToolIds: ["retired"],
    tools: [tool, { name: "__proto__" }],
  });
  tool[TOOL_MANUAL_PROVIDER] = () => ({ summary: "changed" });
  assert.deepEqual(binding.getToolManual("constructor"), {
    status: "available",
    manual: { summary: "literal {{tool:bad.name}}" },
  });
  assert.deepEqual(binding.getToolManual("__proto__"), { status: "unsupported" });
  assert.throws(() => binding.getToolManual("retired"), /undeclared/);
});

test("invalid declared manual support fails explicitly", () => {
  assert.throws(
    () =>
      createToolNameBinding({
        tools: [{ name: "bad", [TOOL_MANUAL_PROVIDER]: true }],
      }),
    /must be a function/,
  );
  for (const manual of [{}, null, "text", Promise.resolve({ summary: "async" })]) {
    const binding = createToolNameBinding({
      tools: [{ function: { name: "bad", [TOOL_MANUAL_PROVIDER]: () => manual } }],
    });
    assert.throws(() => binding.getToolManual("bad"), /non-empty object/);
  }
});

test("active identities and manuals come from the same unique declarations", () => {
  const first = { name: "read_file", [TOOL_MANUAL_PROVIDER]: () => ({ summary: "first" }) };
  const second = {
    function: { name: "read_file", [TOOL_MANUAL_PROVIDER]: () => ({ summary: "second" }) },
  };
  assert.throws(() => createToolNameBinding({ tools: [first, second] }), /duplicate tool identity/);
  assert.throws(
    () => createToolNameBinding({ toolIds: ["read_file"], tools: [{ name: "help" }] }),
    /unknown tool binding options: toolIds/,
  );
  for (const tools of [null, {}, [null], [{}], [{ function: {} }]]) {
    assert.throws(() => createToolNameBinding({ tools }), TypeError);
  }
  const binding = createToolNameBinding({ tools: [first, { function: { name: "help" } }] });
  assert.deepEqual(binding.toolIds, ["read_file", "help"]);
  assert.deepEqual(binding.getToolManual("read_file"), {
    status: "available",
    manual: { summary: "first" },
  });
  assert.deepEqual(binding.getToolManual("help"), { status: "unsupported" });
  assert.throws(() => binding.getToolManual("search"), /undeclared/);
});
