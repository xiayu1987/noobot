/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { filePath as path } from "@noobot/path-resolver";
import {
  renderDefaultMemoryDocument,
  renderDefaultShortMemoryText,
} from "@noobot/memory-protocol/defaults";
import { MEMORY_DOCUMENT_KIND } from "@noobot/memory-protocol/document";
import { renderDefaultExperienceModelText } from "@noobot/memory-protocol/experience/default-model";
import { WORKSPACE_LAYOUT, WORKSPACE_RUNTIME_DIRECTORIES } from "@noobot/workspace-protocol";
import {
  ensureUserWorkspace,
  resetUserWorkspace,
  syncUserWorkspace,
} from "../src/workspace-lifecycle/index.js";

const EMPTY_LONG_MEMORY_DOCUMENT = "NOOBOT_LONG_MEMORY/1\n";
const USER_LONG_MEMORY_DOCUMENT = "NOOBOT_LONG_MEMORY/1\n\npersonal_info.occupation：工程师\n";
const BASE_VALUES = { preferences: { language: "zh-CN" } };
const USER_CONFIG = { preferences: { language: "en-US" } };

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-workspace-lifecycle-"));
  const workspaceRoot = path.join(root, "workspace");
  const assetPackagePath = path.join(root, "assets");
  const userPath = path.join(workspaceRoot, "user-1");
  await mkdir(path.join(assetPackagePath, "services"), { recursive: true });
  await mkdir(path.join(assetPackagePath, "skills", "demo"), { recursive: true });
  await writeFile(path.join(assetPackagePath, "services", "built-in.js"), "export default 'v1';\n");
  await writeFile(path.join(assetPackagePath, "skills", "demo", "SKILL.md"), "# demo v1\n");
  const options = { workspaceRoot, assetPackagePath, userId: "user-1", baseValues: BASE_VALUES };
  return {
    root,
    userPath,
    assetPackagePath,
    options,
    read: (relativePath) => readFile(path.join(userPath, relativePath), "utf8"),
    write: async (relativePath, content) => {
      await mkdir(path.dirname(path.join(userPath, relativePath)), { recursive: true });
      await writeFile(path.join(userPath, relativePath), content);
    },
    restore: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function listBackupFiles(userPath) {
  const backupRoot = path.join(userPath, WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR);
  const [stamp] = await readdir(backupRoot);
  return { stampDir: path.join(backupRoot, stamp), stamps: await readdir(backupRoot) };
}

test("ensure creates a new workspace from the protocols and the asset package", async () => {
  const fixture = await createFixture();
  try {
    assert.equal(await ensureUserWorkspace(fixture.options), fixture.userPath);
    for (const dir of WORKSPACE_RUNTIME_DIRECTORIES) {
      assert.ok((await stat(path.join(fixture.userPath, dir))).isDirectory(), dir);
    }
    assert.equal(await fixture.read("memory/short-memory.json"), renderDefaultShortMemoryText());
    assert.equal(await fixture.read("memory/long-memory.md"), EMPTY_LONG_MEMORY_DOCUMENT);
    assert.equal(
      await fixture.read("memory/long-memory-model.md"),
      renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL),
    );
    assert.equal(
      await fixture.read("memory/experience-model.md"),
      renderDefaultExperienceModelText(),
    );
    assert.equal(
      await fixture.read("memory/experience-fields.md"),
      renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.EXPERIENCE_FIELDS),
    );
    assert.deepEqual(JSON.parse(await fixture.read("config.json")), BASE_VALUES);
    assert.equal(await fixture.read("services/built-in.js"), "export default 'v1';\n");
    assert.equal(await fixture.read("skills/demo/SKILL.md"), "# demo v1\n");
    const state = JSON.parse(await fixture.read(WORKSPACE_LAYOUT.ASSET_STATE_FILE));
    assert.deepEqual(Object.keys(state.files), ["services/built-in.js", "skills/demo/SKILL.md"]);
  } finally {
    await fixture.restore();
  }
});

test("ensure on an existing workspace keeps user config, memory and edited assets", async () => {
  const fixture = await createFixture();
  try {
    const userConfig = `${JSON.stringify(USER_CONFIG)}\n`;
    await fixture.write("config.json", userConfig);
    await fixture.write("memory/long-memory.md", USER_LONG_MEMORY_DOCUMENT);
    await fixture.write("services/built-in.js", "export default 'edited';\n");
    await fixture.write("services/user-defined.js", "export default 'user';\n");

    await ensureUserWorkspace(fixture.options);

    assert.equal(await fixture.read("config.json"), userConfig);
    assert.equal(await fixture.read("memory/long-memory.md"), USER_LONG_MEMORY_DOCUMENT);
    assert.equal(await fixture.read("services/built-in.js"), "export default 'edited';\n");
    assert.equal(await fixture.read("services/user-defined.js"), "export default 'user';\n");
    assert.equal(await fixture.read("skills/demo/SKILL.md"), "# demo v1\n");
  } finally {
    await fixture.restore();
  }
});

test("concurrent ensure calls resolve to the same workspace", async () => {
  const fixture = await createFixture();
  const lockRoot = `${path.resolve(fixture.options.workspaceRoot)}.mutation-locks`;
  try {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => ensureUserWorkspace(fixture.options)),
    );
    assert.deepEqual(new Set(results), new Set([fixture.userPath]));
    assert.deepEqual(await readdir(lockRoot), []);
  } finally {
    await fixture.restore();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("ensure backs up and removes the retired user config example once", async () => {
  const fixture = await createFixture();
  try {
    await ensureUserWorkspace(fixture.options);
    await fixture.write("config.example.json", '{"legacy":true}\n');
    await ensureUserWorkspace(fixture.options);
    const names = await readdir(fixture.userPath);
    assert.equal(names.includes("config.example.json"), false);
    const { stampDir, stamps } = await listBackupFiles(fixture.userPath);
    assert.equal(
      await readFile(path.join(stampDir, "config.example.json"), "utf8"),
      '{"legacy":true}\n',
    );
    await ensureUserWorkspace(fixture.options);
    assert.deepEqual((await listBackupFiles(fixture.userPath)).stamps, stamps);
  } finally {
    await fixture.restore();
  }
});

test("ensure backs up invalid config JSON and rebuilds it through the config protocol", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write("config.json", "{broken");
    await ensureUserWorkspace(fixture.options);
    assert.deepEqual(JSON.parse(await fixture.read("config.json")), BASE_VALUES);
    const { stampDir } = await listBackupFiles(fixture.userPath);
    assert.equal(await readFile(path.join(stampDir, "config.json"), "utf8"), "{broken");
    const names = await readdir(fixture.userPath);
    assert.equal(
      names.some((name) => name.startsWith("config.json.invalid-")),
      false,
    );
  } finally {
    await fixture.restore();
  }
});

test("ensure backs up and repairs legacy memory documents", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write("memory/long-memory.md", "1. legacy numbered memory\n");
    await fixture.write("memory/long-memory-model.md", "NOOBOT_LONG_MEMORY_MODEL/1\n");
    await fixture.write("memory/daily_summary/2026-09-01/域.md", "经验：旧\n");

    await ensureUserWorkspace(fixture.options);

    assert.equal(await fixture.read("memory/long-memory.md"), EMPTY_LONG_MEMORY_DOCUMENT);
    assert.equal(
      await fixture.read("memory/daily_summary/2026-09-01/域.md"),
      "NOOBOT_EXPERIENCE_DAILY_SUMMARY/1\n\n经验：旧\n",
    );
    assert.equal(
      await fixture.read("memory/long-memory-model.md"),
      renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL),
    );
    const backupRoot = path.join(fixture.userPath, WORKSPACE_LAYOUT.MEMORY_REPAIR_BACKUPS_DIR);
    const [stamp] = await readdir(backupRoot);
    assert.equal(
      await readFile(path.join(backupRoot, stamp, "memory", "long-memory.md"), "utf8"),
      "1. legacy numbered memory\n",
    );
  } finally {
    await fixture.restore();
  }
});

test("repair does not restore deleted assets while sync restores them", async () => {
  const fixture = await createFixture();
  try {
    await ensureUserWorkspace(fixture.options);
    await rm(path.join(fixture.userPath, "skills", "demo", "SKILL.md"));
    await ensureUserWorkspace(fixture.options);
    await assert.rejects(fixture.read("skills/demo/SKILL.md"), { code: "ENOENT" });
    await syncUserWorkspace(fixture.options);
    assert.equal(await fixture.read("skills/demo/SKILL.md"), "# demo v1\n");
  } finally {
    await fixture.restore();
  }
});

test("sync upgrades pristine assets, keeps edited ones and removes retired pristine ones", async () => {
  const fixture = await createFixture();
  try {
    await writeFile(path.join(fixture.assetPackagePath, "services", "retired.js"), "old\n");
    await ensureUserWorkspace(fixture.options);
    await fixture.write("skills/demo/SKILL.md", "# demo edited\n");
    await writeFile(
      path.join(fixture.assetPackagePath, "services", "built-in.js"),
      "export default 'v2';\n",
    );
    await writeFile(path.join(fixture.assetPackagePath, "skills", "demo", "SKILL.md"), "# v2\n");
    await rm(path.join(fixture.assetPackagePath, "services", "retired.js"));

    await syncUserWorkspace(fixture.options);

    assert.equal(await fixture.read("services/built-in.js"), "export default 'v2';\n");
    assert.equal(await fixture.read("skills/demo/SKILL.md"), "# demo edited\n");
    await assert.rejects(fixture.read("services/retired.js"), { code: "ENOENT" });
  } finally {
    await fixture.restore();
  }
});

test("sync repairs an existing valid config through the config protocol", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write(
      "config.json",
      `${JSON.stringify({ preferences: { language: "xx", undeclared: true } })}\n`,
    );
    await syncUserWorkspace(fixture.options);
    assert.deepEqual(JSON.parse(await fixture.read("config.json")), BASE_VALUES);
  } finally {
    await fixture.restore();
  }
});

test("reset backs up memory and config before regenerating them from the protocols", async () => {
  const fixture = await createFixture();
  try {
    await ensureUserWorkspace(fixture.options);
    await fixture.write("memory/long-memory.md", USER_LONG_MEMORY_DOCUMENT);
    await fixture.write("config.json", `${JSON.stringify(USER_CONFIG)}\n`);
    await fixture.write("services/built-in.js", "export default 'edited';\n");

    await resetUserWorkspace({ ...fixture.options, sections: ["memory", "config"] });

    assert.equal(await fixture.read("memory/long-memory.md"), EMPTY_LONG_MEMORY_DOCUMENT);
    assert.deepEqual(JSON.parse(await fixture.read("config.json")), BASE_VALUES);
    assert.equal(await fixture.read("services/built-in.js"), "export default 'edited';\n");
    const { stampDir } = await listBackupFiles(fixture.userPath);
    assert.equal(
      await readFile(path.join(stampDir, "memory", "long-memory.md"), "utf8"),
      USER_LONG_MEMORY_DOCUMENT,
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(stampDir, "config.json"), "utf8")),
      USER_CONFIG,
    );
  } finally {
    await fixture.restore();
  }
});

test("reset of asset and runtime sections backs up assets and keeps backup roots", async () => {
  const fixture = await createFixture();
  try {
    await ensureUserWorkspace(fixture.options);
    await fixture.write("services/built-in.js", "export default 'edited';\n");
    await fixture.write("runtime/session/s1/meta.json", "{}\n");

    await resetUserWorkspace({ ...fixture.options, sections: ["service", "runtime"] });

    assert.equal(await fixture.read("services/built-in.js"), "export default 'v1';\n");
    await assert.rejects(fixture.read("runtime/session/s1/meta.json"), { code: "ENOENT" });
    const { stampDir } = await listBackupFiles(fixture.userPath);
    assert.equal(
      await readFile(path.join(stampDir, "services", "built-in.js"), "utf8"),
      "export default 'edited';\n",
    );
    await assert.rejects(resetUserWorkspace({ ...fixture.options, sections: ["template"] }), {
      code: "FATAL_INVALID_RESET_SECTIONS",
    });
  } finally {
    await fixture.restore();
  }
});

test("ensure migrates legacy plugin data into the plugin data root", async () => {
  const fixture = await createFixture();
  try {
    await fixture.write("runtime/workflow/session/s1/d1/plan.json", "{}\n");
    await fixture.write("runtime/harness/runs/d1/harness-run.json", "{}\n");
    await ensureUserWorkspace(fixture.options);
    const backupsRoot = path.join(fixture.userPath, WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR);
    const [stamp] = await readdir(backupsRoot);
    assert.equal(
      await readFile(
        path.join(backupsRoot, stamp, "runtime/workflow/session/s1/d1/plan.json"),
        "utf8",
      ),
      "{}\n",
    );
    assert.equal(
      await fixture.read("runtime/plugin-data/workflow/session/s1/d1/plan.json"),
      "{}\n",
    );
    assert.equal(
      await readFile(
        path.join(backupsRoot, stamp, "runtime/harness/runs/d1/harness-run.json"),
        "utf8",
      ),
      "{}\n",
    );
    assert.equal(
      await fixture.read("runtime/plugin-data/harness/runs/d1/harness-run.json"),
      "{}\n",
    );
    await assert.rejects(stat(path.join(fixture.userPath, "runtime", "harness")), {
      code: "ENOENT",
    });
    await assert.rejects(stat(path.join(fixture.userPath, "runtime", "workflow")), {
      code: "ENOENT",
    });
    await fixture.write("runtime/workflow/planning/x.json", "{}\n");
    await assert.rejects(ensureUserWorkspace(fixture.options), {
      code: "WORKSPACE_LAYOUT_MIGRATION_CONFLICT",
    });
  } finally {
    await fixture.restore();
  }
});
