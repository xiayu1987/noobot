/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  await writeFile(path.join(workspaceTemplatePath, "memory", "long-memory.md"), "template\n");
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
    await writeFile(path.join(fixture.userPath, "memory", "long-memory.md"), "user memory\n");

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
    assert.deepEqual(
      JSON.parse(await readFile(path.join(fixture.userPath, "services", "package.json"), "utf8")),
      { type: "module" },
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

test("concurrent workspace initialization serializes template synchronization", async () => {
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
      "{}\n",
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

test("workspace initialization migrates legacy long memory before template synchronization", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(path.join(fixture.userPath, "memory", "long-memory"), { recursive: true });
    await writeFile(
      path.join(fixture.userPath, "memory", "long-memory.json"),
      JSON.stringify({ staticMemory: "1. migrated memory" }),
    );
    await writeFile(
      path.join(fixture.userPath, "memory", "long-memory", "metadata.json"),
      JSON.stringify({ items: [{ id: 1, key: "style", value: "concise" }] }),
    );

    await ensureUserWorkspaceInitialized({
      workspaceRoot: fixture.workspaceRoot,
      workspaceTemplatePath: fixture.workspaceTemplatePath,
      userId: "user-1",
    });

    assert.equal(
      await readFile(path.join(fixture.userPath, "memory", "long-memory.md"), "utf8"),
      "1. migrated memory\n",
    );
    assert.equal(
      await readFile(path.join(fixture.userPath, "memory", "long-memory", "metadata.md"), "utf8"),
      'M1 key="style" value="concise"\n',
    );
  } finally {
    await fixture.restore();
  }
});

test("workspace initialization repairs an empty short-memory document", async () => {
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

    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(fixture.userPath, "memory", "short-memory.json"), "utf8"),
      ),
      { items: [] },
    );
  } finally {
    await fixture.restore();
  }
});

test("workspace initialization migrates legacy experience files before normal reads", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(path.join(fixture.userPath, "memory", "experience"), { recursive: true });
    await writeFile(
      path.join(fixture.userPath, "memory", "experience", "metadata.json"),
      JSON.stringify({ domainNames: ["coding"], updatedAt: "2026-08-19T00:00:00.000Z" }),
    );
    await writeFile(
      path.join(fixture.userPath, "memory", "experience-model.json"),
      JSON.stringify({ coding: { quality: ["protocol"] } }),
    );

    await ensureUserWorkspaceInitialized({
      workspaceRoot: fixture.workspaceRoot,
      workspaceTemplatePath: fixture.workspaceTemplatePath,
      userId: "user-1",
    });

    const metadata = await readFile(
      path.join(fixture.userPath, "memory", "experience", "metadata.md"),
      "utf8",
    );
    const model = await readFile(
      path.join(fixture.userPath, "memory", "experience-model.md"),
      "utf8",
    );
    assert.match(metadata, /DOMAIN: coding/);
    assert.match(metadata, /UPDATED_AT: 2026-08-19T00:00:00.000Z/);
    assert.match(model, /DOMAIN: coding/);
    assert.match(model, /CATEGORY: quality/);
    assert.match(model, /- protocol/);
  } finally {
    await fixture.restore();
  }
});

test("legacy long-memory migration does not publish current files after parse failure", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(path.join(fixture.userPath, "memory"), { recursive: true });
    await writeFile(path.join(fixture.userPath, "memory", "long-memory.json"), "{broken");

    await assert.rejects(
      ensureUserWorkspaceInitialized({
        workspaceRoot: fixture.workspaceRoot,
        workspaceTemplatePath: fixture.workspaceTemplatePath,
        userId: "user-1",
      }),
      { code: "PERSISTED_JSON_CORRUPTED" },
    );
    await assert.rejects(
      readFile(path.join(fixture.userPath, "memory", "long-memory.md"), "utf8"),
      { code: "ENOENT" },
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
          api_key: "${OPENAI_API_KEY}",
          base_url: "${OPENAI_API_ADDRESS}",
          description: "Generic OpenAI-compatible fallback model",
          enabled: true,
          model: "default-model",
          multimodal_generation: {
            support_generation: { enabled: false, support_scope: [] },
          },
          multimodal_parsing: { enabled: false, input_modalities: [] },
          reasoning_effort: "high",
          reasoning_effort_options: ["low", "medium", "high"],
          reasoning_effort_parameter: "reasoning_effort",
          tool_reasoning_effort: "medium",
          used_for_conversation: true,
        },
        added: {
          api_key: "${OPENAI_API_KEY}",
          base_url: "${OPENAI_API_ADDRESS}",
          description: "Generic OpenAI-compatible fallback model",
          enabled: true,
          model: "default-model",
          multimodal_generation: {
            support_generation: { enabled: false, support_scope: [] },
          },
          multimodal_parsing: { enabled: false, input_modalities: [] },
          reasoning_effort: "medium",
          reasoning_effort_options: ["low", "medium", "high"],
          reasoning_effort_parameter: "reasoning_effort",
          tool_reasoning_effort: "medium",
          used_for_conversation: true,
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
