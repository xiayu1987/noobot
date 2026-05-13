import test from "node:test";
import assert from "node:assert/strict";

import { RunConfigResolver } from "../../../system-core/bot-manage/config/run-config-resolver.js";

test("applyRunConfigToolPolicy should always keep final_answer tool", () => {
  const resolver = new RunConfigResolver();
  const agentContext = {
    payload: {
      tools: {
        registry: [{ name: "final_answer" }, { name: "wait" }],
      },
    },
  };
  const runConfig = {
    toolPolicy: {
      allowToolNames: ["wait"],
    },
  };

  const nextContext = resolver.applyRunConfigToolPolicy(agentContext, runConfig);
  const toolNames = (nextContext?.payload?.tools?.registry || []).map((tool) => tool.name);

  assert.deepEqual(toolNames.sort(), ["final_answer", "wait"]);
});
