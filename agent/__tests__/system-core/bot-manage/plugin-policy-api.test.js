import test from "node:test";
import assert from "node:assert/strict";

import {
  createPluginPolicyApi,
  hasToolPolicyPatchContent,
  mergeToolPolicyPatch,
} from "../../../src/system-core/bot-manage/session/plugin-policy-api.js";

function normalizeStringArray(input = []) {
  return Array.isArray(input)
    ? input.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

test("mergeToolPolicyPatch merges base/patched deny tool names", () => {
  const merged = mergeToolPolicyPatch({
    baseToolPolicy: {
      mode: "append_custom",
      denyToolNames: ["a"],
    },
    toolPolicyPatch: {
      denyToolNames: ["b", "a"],
    },
    normalizeStringArray,
  });

  assert.equal(merged.mode, "append_custom");
  assert.deepEqual(merged.denyToolNames, ["a", "b"]);
});

test("createPluginPolicyApi appends deny tool names without dropping base policy", () => {
  const policyApi = createPluginPolicyApi({
    baseToolPolicy: {
      mode: "append_custom",
      allowToolNames: ["wait"],
    },
    normalizeStringArray,
  });
  policyApi.appendDenyToolNames(["delegate_task_async"]);
  const merged = policyApi.getToolPolicy();

  assert.equal(merged.mode, "append_custom");
  assert.deepEqual(merged.allowToolNames, ["wait"]);
  assert.deepEqual(merged.denyToolNames, ["delegate_task_async"]);
});

test("hasToolPolicyPatchContent handles empty/deny-only patches", () => {
  assert.equal(hasToolPolicyPatchContent({ toolPolicyPatch: {}, normalizeStringArray }), false);
  assert.equal(
    hasToolPolicyPatchContent({
      toolPolicyPatch: { denyToolNames: ["delegate_task_async"] },
      normalizeStringArray,
    }),
    true,
  );
});
