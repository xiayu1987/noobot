import test from "node:test";
import assert from "node:assert/strict";

import { adaptToolsForBinding } from "../../../../src/system-core/model/tool/binding-adapter.js";

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

test("adaptToolsForBinding returns tools in stable name order", () => {
  const adapted = adaptToolsForBinding([
    { name: "write_file" },
    { name: "read_file" },
    { name: "execute_script" },
  ]);

  assert.deepEqual(
    adapted.tools.map((toolItem) => toolItem.name),
    ["execute_script", "read_file", "write_file"],
  );
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

  assert.deepEqual(adapted.bindOptions, { tool_choice: "auto", strict: true });
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

  assert.deepEqual(adapted.bindOptions, { tool_choice: "auto", strict: true });
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

  assert.deepEqual(adapted.bindOptions, { tool_choice: "auto" });
  assert.deepEqual(adapted.strictDowngradedTools, ["call_service"]);
});

test("adaptToolsForBinding defaults tool_choice to auto when tools exist", () => {
  const adapted = adaptToolsForBinding([{ name: "read_file" }], {
    activeModelName: "gpt-4o-mini",
    activeModelAlias: "default",
    globalConfig: {},
    userConfig: {},
  });

  assert.equal(adapted.bindOptions.tool_choice, "auto");
});

test("adaptToolsForBinding keeps tool_choice as auto even when runtime marks required unsupported", () => {
  const adapted = adaptToolsForBinding([{ name: "read_file" }], {
    activeModelName: "gpt-4o-mini",
    activeModelAlias: "default",
    runtime: {
      systemRuntime: {
        toolChoiceRequiredUnsupported: true,
      },
    },
    globalConfig: {},
    userConfig: {},
  });

  assert.equal(adapted.bindOptions.tool_choice, "auto");
});
