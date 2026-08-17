/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { filePath as path } from "@noobot/path-resolver";
import {
  ensureUserWorkspaceInitialized,
  syncUserWorkspaceFromTemplate,
} from "../src/workspace-lifecycle/index.js";

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-workspace-lifecycle-"));
  const workspaceRoot = path.join(root, "workspace");
  const workspaceTemplatePath = path.join(root, "template");
  const userPath = path.join(workspaceRoot, "user-1");
  await mkdir(path.join(workspaceTemplatePath, "services"), { recursive: true });
  await mkdir(path.join(workspaceTemplatePath, "memory"), { recursive: true });
  await writeFile(
    path.join(workspaceTemplatePath, "config.json"),
    `${JSON.stringify({ added: true, nested: { fromTemplate: true, preserved: "template" } })}\n`,
  );
  await writeFile(
    path.join(workspaceTemplatePath, "services", "built-in.js"),
    "export default 'current';\n",
  );
  await writeFile(path.join(workspaceTemplatePath, "memory", "long-memory.md"), "template\n");
  return {
    root,
    workspaceRoot,
    workspaceTemplatePath,
    userPath,
    restore: () => rm(root, { recursive: true, force: true }),
  };
}

test("existing workspace receives managed template updates without replacing user state", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(path.join(fixture.userPath, "services"), { recursive: true });
    await mkdir(path.join(fixture.userPath, "memory"), { recursive: true });
    await writeFile(
      path.join(fixture.userPath, "config.json"),
      `${JSON.stringify({ nested: { preserved: "user" }, userOnly: true })}\n`,
    );
    await writeFile(
      path.join(fixture.userPath, "services", "built-in.js"),
      "export default 'stale';\n",
    );
    await writeFile(
      path.join(fixture.userPath, "services", "user-defined.js"),
      "export default 'user';\n",
    );
    await writeFile(path.join(fixture.userPath, "memory", "long-memory.md"), "user memory\n");

    await ensureUserWorkspaceInitialized({
      workspaceRoot: fixture.workspaceRoot,
      workspaceTemplatePath: fixture.workspaceTemplatePath,
      userId: "user-1",
    });

    const config = JSON.parse(await readFile(path.join(fixture.userPath, "config.json"), "utf8"));
    assert.deepEqual(config, {
      added: true,
      nested: { fromTemplate: true, preserved: "user" },
      userOnly: true,
    });
    assert.equal(
      await readFile(path.join(fixture.userPath, "services", "built-in.js"), "utf8"),
      "export default 'current';\n",
    );
    assert.equal(
      await readFile(path.join(fixture.userPath, "services", "user-defined.js"), "utf8"),
      "export default 'user';\n",
    );
    assert.equal(
      await readFile(path.join(fixture.userPath, "memory", "long-memory.md"), "utf8"),
      "user memory\n",
    );
  } finally {
    await fixture.restore();
  }
});

test("explicit workspace sync adds every nested config node through the config protocol", async () => {
  const fixture = await createFixture();
  try {
    await writeFile(
      path.join(fixture.workspaceTemplatePath, "config.json"),
      `${JSON.stringify({
        providers: {
          primary: {
            reasoning_effort: "medium",
            tool_reasoning_effort: "medium",
            capabilities: { web_search: true },
          },
          added: { enabled: true },
        },
        tools: {
          execute_script: { enabled: true, sandbox_mode: true },
          read_file: { enabled: true },
        },
      })}\n`,
    );
    await mkdir(fixture.userPath, { recursive: true });
    await writeFile(
      path.join(fixture.userPath, "config.json"),
      `${JSON.stringify({
        providers: { primary: { reasoning_effort: "high" } },
        tools: { set_skill_task: { enabled: true } },
      })}\n`,
    );

    await syncUserWorkspaceFromTemplate({
      workspaceRoot: fixture.workspaceRoot,
      workspaceTemplatePath: fixture.workspaceTemplatePath,
      userId: "user-1",
    });

    const config = JSON.parse(await readFile(path.join(fixture.userPath, "config.json"), "utf8"));
    assert.deepEqual(config, {
      providers: {
        primary: {
          reasoning_effort: "high",
          tool_reasoning_effort: "medium",
          capabilities: { web_search: true },
        },
        added: { enabled: true },
      },
      tools: {
        execute_script: { enabled: true },
        read_file: { enabled: true },
      },
    });
  } finally {
    await fixture.restore();
  }
});
