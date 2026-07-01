/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDesktopConfigManager } from "../../electron/desktop-config.js";

async function createFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-desktop-config-"));
  const repoRoot = path.join(rootDir, "repo");
  const packagedBackendRoot = path.join(rootDir, "resources", "backend");
  const userDataPath = path.join(rootDir, "user-data");
  await mkdir(path.join(packagedBackendRoot, "service", "config"), { recursive: true });
  await mkdir(path.join(packagedBackendRoot, "user-template", "default-user"), { recursive: true });
  await writeFile(path.join(packagedBackendRoot, "service", "config", "global.config.example.json"), JSON.stringify({
    workspace_root: "../workspace",
    workspace_template_path: "../user-template/default-user",
    super_admin: {
      user_id: "admin",
      connect_code: "change-your-connect-code",
    },
    preferences: { language: "zh-CN" },
    providers: {
      openai: { model: "gpt", enabled: true, used_for_conversation: true },
    },
    default_provider: "openai",
  }));
  await writeFile(path.join(packagedBackendRoot, "user-template", "default-user", "config.example.json"), JSON.stringify({
    default_provider: "openai",
    providers: {
      openai: { model: "gpt", enabled: true, used_for_conversation: true },
    },
    tools: { execute_script: { sandbox_mode: true } },
  }));
  return {
    rootDir,
    repoRoot,
    packagedBackendRoot,
    userDataPath,
    restore: () => rm(rootDir, { recursive: true, force: true }),
  };
}

test("packaged desktop config restores missing userData template example before saving super admin", async () => {
  const fixture = await createFixture();
  const logs = [];
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
      appendDesktopLog: (line) => logs.push(line),
    });

    const state = manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });
    const templateExample = path.join(fixture.userDataPath, "user-template", "default-user", "config.example.json");
    assert.equal(state.workspaceTemplatePath, path.dirname(templateExample));
    assert.equal(state.templateConfigPath, path.join(path.dirname(templateExample), "config.json"));
    assert.equal(JSON.parse(await readFile(templateExample, "utf8")).default_provider, "openai");

    await rm(templateExample, { force: true });
    const restoredState = manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });
    assert.equal(JSON.parse(await readFile(templateExample, "utf8")).default_provider, "openai");
    manager.saveSuperAdminConfig({
      globalConfigPath: restoredState.globalConfigPath,
      userConfigPath: restoredState.templateConfigPath,
      userId: "owner",
      connectCode: "secret",
      language: "en-US",
      model: "openai",
    });

    const globalConfig = JSON.parse(await readFile(restoredState.globalConfigPath, "utf8"));
    const templateConfig = JSON.parse(await readFile(restoredState.templateConfigPath, "utf8"));
    assert.equal(globalConfig.super_admin.user_id, "owner");
    assert.equal(globalConfig.super_admin.connect_code, "secret");
    assert.equal(templateConfig.default_provider, "openai");
  } finally {
    await fixture.restore();
  }
});
