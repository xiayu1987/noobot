/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { filePath as path } from "@noobot/path-resolver";
import {
  ensureUserWorkspaceInitialized,
  syncUserWorkspaceFromTemplate,
} from "../src/workspace-lifecycle/index.js";

const TEMPLATE_MEMORY_DIR = fileURLToPath(
  new URL("../../user-template/default-user/memory/", import.meta.url),
);
const EMPTY_LONG_MEMORY_DOCUMENT = "NOOBOT_LONG_MEMORY/1\n";
const USER_LONG_MEMORY_DOCUMENT = "NOOBOT_LONG_MEMORY/1\n\npersonal_info.occupation：工程师\n";

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-workspace-lifecycle-"));
  const workspaceRoot = path.join(root, "workspace");
  const workspaceTemplatePath = path.join(root, "template");
  const userPath = path.join(workspaceRoot, "user-1");
  await mkdir(path.join(workspaceTemplatePath, "services"), { recursive: true });
  await mkdir(path.join(workspaceTemplatePath, "memory"), { recursive: true });
  await writeFile(
    path.join(workspaceTemplatePath, "config.json"),
    `${JSON.stringify({ preferences: { added: true, preserved: "template" } })}\n`,
  );
  await writeFile(
    path.join(workspaceTemplatePath, "services", "built-in.js"),
    "export default 'current';\n",
  );
  await writeFile(
    path.join(workspaceTemplatePath, "services", "package.json"),
    '{"type":"module"}\n',
  );
  for (const name of ["long-memory.md", "experience-model.md", "short-memory.json"]) {
    await writeFile(
      path.join(workspaceTemplatePath, "memory", name),
      await readFile(path.join(TEMPLATE_MEMORY_DIR, name), "utf8"),
    );
  }
  return {
    root,
    workspaceRoot,
    workspaceTemplatePath,
    userPath,
    restore: () => rm(root, { recursive: true, force: true }),
  };
}

test("runtime workspace initialization does not synchronize existing user state", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(path.join(fixture.userPath, "services"), { recursive: true });
    await mkdir(path.join(fixture.userPath, "memory"), { recursive: true });
    await writeFile(
      path.join(fixture.userPath, "config.json"),
      `${JSON.stringify({ preferences: { preserved: "user" }, userOnly: true })}\n`,
    );
    await writeFile(
      path.join(fixture.userPath, "services", "built-in.js"),
      "export default 'stale';\n",
    );
    await writeFile(
      path.join(fixture.userPath, "services", "user-defined.js"),
      "export default 'user';\n",
    );
    await writeFile(
      path.join(fixture.userPath, "memory", "long-memory.md"),
      USER_LONG_MEMORY_DOCUMENT,
    );

    await ensureUserWorkspaceInitialized({
      workspaceRoot: fixture.workspaceRoot,
      workspaceTemplatePath: fixture.workspaceTemplatePath,
      userId: "user-1",
    });

    const config = JSON.parse(await readFile(path.join(fixture.userPath, "config.json"), "utf8"));
    assert.deepEqual(config, { preferences: { preserved: "user" }, userOnly: true });
    assert.equal(
      await readFile(path.join(fixture.userPath, "services", "built-in.js"), "utf8"),
      "export default 'stale';\n",
    );
    await assert.rejects(
      readFile(path.join(fixture.userPath, "services", "package.json"), "utf8"),
      { code: "ENOENT" },
    );
    assert.equal(
      await readFile(path.join(fixture.userPath, "services", "user-defined.js"), "utf8"),
      "export default 'user';\n",
    );
    assert.equal(
      await readFile(path.join(fixture.userPath, "memory", "long-memory.md"), "utf8"),
      USER_LONG_MEMORY_DOCUMENT,
    );
  } finally {
    await fixture.restore();
  }
});

test("concurrent workspace initialization preserves existing user state", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(fixture.userPath, { recursive: true });
    await writeFile(path.join(fixture.workspaceTemplatePath, "config.example.json"), "{}\n");
    await writeFile(path.join(fixture.userPath, "config.example.json"), '{"stale":true}\n');

    const initialized = await Promise.all(
      Array.from({ length: 20 }, () =>
        ensureUserWorkspaceInitialized({
          workspaceRoot: fixture.workspaceRoot,
          workspaceTemplatePath: fixture.workspaceTemplatePath,
          userId: "user-1",
        }),
      ),
    );

    assert.deepEqual(new Set(initialized), new Set([fixture.userPath]));
    assert.equal(
      await readFile(path.join(fixture.userPath, "config.example.json"), "utf8"),
      '{"stale":true}\n',
    );
  } finally {
    await fixture.restore();
  }
});

test("workspace mutation locks stay outside the workspace content tree", async () => {
  const fixture = await createFixture();
  const mutationLockRoot = `${path.resolve(fixture.workspaceRoot)}.mutation-locks`;
  try {
    await ensureUserWorkspaceInitialized({
      workspaceRoot: fixture.workspaceRoot,
      workspaceTemplatePath: fixture.workspaceTemplatePath,
      userId: "user-1",
    });

    const workspaceEntries = await readdir(fixture.workspaceRoot);
    assert.equal(
      workspaceEntries.some((entry) => entry.endsWith(".mutation-lock")),
      false,
    );
    assert.deepEqual(await readdir(mutationLockRoot), []);
  } finally {
    await fixture.restore();
    await rm(mutationLockRoot, { recursive: true, force: true });
  }
});

test("workspace initialization preserves an existing empty short-memory document", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(fixture.userPath, { recursive: true });
    await mkdir(path.join(fixture.userPath, "memory"), { recursive: true });
    await writeFile(path.join(fixture.userPath, "memory", "short-memory.json"), "\n");

    await ensureUserWorkspaceInitialized({
      workspaceRoot: fixture.workspaceRoot,
      workspaceTemplatePath: fixture.workspaceTemplatePath,
      userId: "user-1",
    });

    assert.equal(
      await readFile(path.join(fixture.userPath, "memory", "short-memory.json"), "utf8"),
      "\n",
    );
  } finally {
    await fixture.restore();
  }
});

test("workspace initialization repairs missing canonical memory files from the template", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(fixture.userPath, { recursive: true });
    await mkdir(path.join(fixture.userPath, "memory"), { recursive: true });

    await ensureUserWorkspaceInitialized({
      workspaceRoot: fixture.workspaceRoot,
      workspaceTemplatePath: fixture.workspaceTemplatePath,
      userId: "user-1",
    });

    assert.equal(
      await readFile(path.join(fixture.userPath, "memory", "experience-model.md"), "utf8"),
      await readFile(path.join(TEMPLATE_MEMORY_DIR, "experience-model.md"), "utf8"),
    );
    assert.equal(
      await readFile(path.join(fixture.userPath, "memory", "short-memory.json"), "utf8"),
      await readFile(path.join(TEMPLATE_MEMORY_DIR, "short-memory.json"), "utf8"),
    );
  } finally {
    await fixture.restore();
  }
});

test("workspace initialization repairs a missing long-memory document from the template", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(path.join(fixture.userPath, "memory"), { recursive: true });
    await ensureUserWorkspaceInitialized({
      workspaceRoot: fixture.workspaceRoot,
      workspaceTemplatePath: fixture.workspaceTemplatePath,
      userId: "user-1",
    });
    assert.equal(
      await readFile(path.join(fixture.userPath, "memory", "long-memory.md"), "utf8"),
      EMPTY_LONG_MEMORY_DOCUMENT,
    );
  } finally {
    await fixture.restore();
  }
});

test("workspace initialization backs up and repairs legacy memory documents", async () => {
  const fixture = await createFixture();
  try {
    const memoryDir = path.join(fixture.userPath, "memory");
    await mkdir(path.join(memoryDir, "daily_summary", "2026-09-01"), { recursive: true });
    await writeFile(path.join(memoryDir, "long-memory.md"), "1. legacy numbered memory\n");
    await writeFile(path.join(memoryDir, "long-memory-model.md"), "NOOBOT_LONG_MEMORY_MODEL/1\n");
    await writeFile(path.join(memoryDir, "daily_summary", "2026-09-01", "域.md"), "经验：旧\n");

    await ensureUserWorkspaceInitialized({
      workspaceRoot: fixture.workspaceRoot,
      workspaceTemplatePath: fixture.workspaceTemplatePath,
      userId: "user-1",
    });

    assert.equal(
      await readFile(path.join(memoryDir, "long-memory.md"), "utf8"),
      EMPTY_LONG_MEMORY_DOCUMENT,
    );
    assert.equal(
      await readFile(path.join(memoryDir, "daily_summary", "2026-09-01", "域.md"), "utf8"),
      "NOOBOT_EXPERIENCE_DAILY_SUMMARY/1\n\n经验：旧\n",
    );
    await assert.rejects(readFile(path.join(memoryDir, "long-memory-model.md"), "utf8"), {
      code: "ENOENT",
    });
    const backupRoot = path.join(fixture.userPath, "runtime", "memory-repair-backups");
    const [stamp] = await readdir(backupRoot);
    const backupMemoryDir = path.join(backupRoot, stamp, "memory");
    assert.equal(
      await readFile(path.join(backupMemoryDir, "long-memory.md"), "utf8"),
      "1. legacy numbered memory\n",
    );
    assert.equal(
      await readFile(path.join(backupMemoryDir, "long-memory-model.md"), "utf8"),
      "NOOBOT_LONG_MEMORY_MODEL/1\n",
    );
    assert.equal(
      await readFile(path.join(backupMemoryDir, "daily_summary", "2026-09-01", "域.md"), "utf8"),
      "经验：旧\n",
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
      baseValues: {
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
      },
    });

    const config = JSON.parse(await readFile(path.join(fixture.userPath, "config.json"), "utf8"));
    assert.deepEqual(config, {
      providers: {
        primary: {
          enabled: true,
          used_for_conversation: true,
          api_key: "${OPENAI_API_KEY}",
          base_url: "${OPENAI_API_ADDRESS}",
          model: "default-model",
          description: "Generic OpenAI-compatible fallback model",
          prompt_cache_fields: [],
          reasoning_effort: "high",
          tool_reasoning_effort: "medium",
        },
        added: {
          enabled: true,
          used_for_conversation: true,
          api_key: "${OPENAI_API_KEY}",
          base_url: "${OPENAI_API_ADDRESS}",
          model: "default-model",
          description: "Generic OpenAI-compatible fallback model",
          prompt_cache_fields: [],
          reasoning_effort: "medium",
          tool_reasoning_effort: "medium",
          reasoning_effort_options: ["low", "medium", "high"],
          reasoning_effort_parameter: "reasoning_effort",
          multimodal_parsing: { enabled: false, input_modalities: [] },
          multimodal_generation: {
            support_generation: { enabled: false, support_scope: [] },
          },
        },
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

test("workspace synchronization preserves invalid config JSON and repairs from the template", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(fixture.userPath, { recursive: true });
    await writeFile(path.join(fixture.userPath, "config.json"), "{broken");

    await syncUserWorkspaceFromTemplate({
      workspaceRoot: fixture.workspaceRoot,
      workspaceTemplatePath: fixture.workspaceTemplatePath,
      userId: "user-1",
      baseValues: { preferences: { added: true, preserved: "template" } },
    });

    assert.deepEqual(
      JSON.parse(await readFile(path.join(fixture.userPath, "config.json"), "utf8")),
      { preferences: { added: true, preserved: "template" } },
    );
    assert.equal(
      (await readdir(fixture.userPath)).filter((name) => name.startsWith("config.json.invalid-"))
        .length,
      1,
    );
  } finally {
    await fixture.restore();
  }
});
