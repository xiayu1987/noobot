/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSkillTool } from "../../src/tools/execution/skill-tool.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

function createRuntime(basePath) {
  return {
    basePath,
    userId: "admin",
    globalConfig: { security: { executionIsolation: { mode: "host" } } },
    userConfig: {},
    systemRuntime: {
      userId: "admin",
      sessionId: "skill-session",
      rootSessionId: "skill-session",
      config: { safeConfirm: false },
    },
  };
}

test("list_skills uses the shared path authorization and resource protocol", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-skill-tool-"));
  await fs.mkdir(path.join(basePath, "skills", "analysis"), { recursive: true });
  await fs.writeFile(path.join(basePath, "skills", "analysis", "SKILL.md"), "# Analysis", "utf8");
  const [tool] = createSkillTool({ agentContext: createTestAgentExecutionScope(createRuntime(basePath)) });

  const result = JSON.parse(await tool.invoke({}));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.items.length, 2);
  assert.equal(result.resources.length, 2);
  assert.deepEqual(result.items[0].path, { view: "workspace", path: "skills/analysis" });
  assert.equal(result.resources.every((item) => item.resourceId.startsWith("res_")), true);
  assert.equal(result.items.every((item) => item.resourceId), true);
});

test("list_skills rejects a parentSkill outside the authorized skills root", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-skill-scope-"));
  await fs.mkdir(path.join(basePath, "skills"), { recursive: true });
  await fs.mkdir(path.join(basePath, "outside"), { recursive: true });
  const [tool] = createSkillTool({ agentContext: createTestAgentExecutionScope(createRuntime(basePath)) });

  await assert.rejects(
    () => tool.invoke({ parentSkill: "../outside" }),
    (error) => {
      assert.equal(error?.code, "RECOVERABLE_PATH_OUT_OF_SCOPE");
      assert.equal(error?.details?.reason, "path_outside_required_root");
      return true;
    },
  );
});
