import test from "node:test";
import assert from "node:assert/strict";

import { adaptToolsForBinding } from "../../../../system-core/model/tool/binding-adapter.js";

test("adaptToolsForBinding drops invalid names and deduplicates", () => {
  const adapted = adaptToolsForBinding([
    { name: "valid_tool" },
    { name: "invalid tool" },
    { name: "valid_tool" },
    { name: "" },
  ]);

  assert.deepEqual(
    adapted.tools.map((toolItem) => toolItem.name),
    ["valid_tool"],
  );
  assert.deepEqual(adapted.droppedToolNames, ["invalid tool", "(empty)"]);
});

test("adaptToolsForBinding enables strict by default for codex-like model", () => {
  const adapted = adaptToolsForBinding(
    [{ name: "task_summary" }],
    {
      activeModelName: "gpt-5.3-codex",
      activeModelAlias: "codex",
      globalConfig: {},
      userConfig: {},
    },
  );

  assert.deepEqual(adapted.bindOptions, { strict: true });
});

test("adaptToolsForBinding respects explicit strict tool schema config", () => {
  const adapted = adaptToolsForBinding(
    [{ name: "task_summary" }],
    {
      activeModelName: "gpt-4o-mini",
      activeModelAlias: "default",
      globalConfig: { tools: { strict_tool_schema: true } },
      userConfig: {},
    },
  );

  assert.deepEqual(adapted.bindOptions, { strict: true });
});

test("adaptToolsForBinding downgrades strict when call_service is present", () => {
  const adapted = adaptToolsForBinding(
    [{ name: "call_service" }],
    {
      activeModelName: "gpt-5.3-codex",
      activeModelAlias: "codex",
      globalConfig: {},
      userConfig: {},
    },
  );

  assert.deepEqual(adapted.bindOptions, {});
  assert.deepEqual(adapted.strictDowngradedTools, ["call_service"]);
});
