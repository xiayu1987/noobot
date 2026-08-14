/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { clientFilePath as path } from "../../path-resolver.js";
import test from "node:test";
import { createDesktopConfigManager } from "../../electron/runtime/config.js";

async function createFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-desktop-config-"));
  const repoRoot = path.join(rootDir, "repo");
  const packagedBackendRoot = path.join(rootDir, "resources", "backend");
  const userDataPath = path.join(rootDir, "user-data");
  await mkdir(path.join(packagedBackendRoot, "service", "config"), { recursive: true });
  await mkdir(path.join(packagedBackendRoot, "user-template", "default-user"), { recursive: true });
  await writeFile(
    path.join(packagedBackendRoot, "service", "config", "global.config.example.json"),
    JSON.stringify({
      workspace_root: "../workspace",
      workspace_template_path: "../user-template/default-user",
      super_admin: {
        user_id: "admin",
        connect_code: "change-your-connect-code",
      },
      preferences: { language: "zh-CN" },
      newly_added_config: {
        nested: {
          default_value: true,
          preserved_value: "template",
        },
      },
      security: {
        execution_isolation: {
          mode: "sandbox",
          sandbox: { provider: "docker", scope: "user" },
        },
        path_policy: {
          resolution: { follow_symbolic_links: false },
        },
      },
      providers: {
        openai: { model: "gpt", enabled: true, used_for_conversation: true },
      },
      default_provider: "openai",
    }),
  );
  await writeFile(
    path.join(packagedBackendRoot, "user-template", "default-user", "config.example.json"),
    JSON.stringify({
      default_provider: "openai",
      providers: {
        openai: { model: "gpt", enabled: true, used_for_conversation: true },
      },
    }),
  );
  await mkdir(path.join(packagedBackendRoot, "user-template", "default-user", "memory"), {
    recursive: true,
  });
  await mkdir(path.join(packagedBackendRoot, "user-template", "default-user", "runtime"), {
    recursive: true,
  });
  await mkdir(path.join(packagedBackendRoot, "user-template", "default-user", "services"), {
    recursive: true,
  });
  await mkdir(path.join(packagedBackendRoot, "user-template", "default-user", "skills"), {
    recursive: true,
  });
  await writeFile(
    path.join(packagedBackendRoot, "user-template", "default-user", "memory", "short-memory.json"),
    "{}",
  );
  await writeFile(
    path.join(
      packagedBackendRoot,
      "user-template",
      "default-user",
      "services",
      "weather-service-handler.js",
    ),
    "export default {};\n",
  );
  await writeFile(
    path.join(packagedBackendRoot, "user-template", "default-user", "skills", "SKILL.md"),
    "# Skill\n",
  );
  return {
    rootDir,
    repoRoot,
    packagedBackendRoot,
    userDataPath,
    restore: () => rm(rootDir, { recursive: true, force: true }),
  };
}

test("packaged desktop startup incrementally adds any bundled global config fields", async () => {
  const fixture = await createFixture();
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    const configDir = path.join(fixture.userDataPath, "config");
    const globalConfigPath = path.join(configDir, "global.config.json");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        newly_added_config: { nested: { preserved_value: "client" } },
      }),
    );

    manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });

    const config = JSON.parse(await readFile(globalConfigPath, "utf8"));
    assert.equal(config.newly_added_config.nested.default_value, true);
    assert.equal(config.newly_added_config.nested.preserved_value, "client");
    assert.equal(config.security.execution_isolation.mode, "host");
    assert.equal(config.security.path_policy.resolution.follow_symbolic_links, false);
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop config preserves an explicitly selected sandbox and its mounts", async () => {
  const fixture = await createFixture();
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    const configDir = path.join(fixture.userDataPath, "config");
    const globalConfigPath = path.join(configDir, "global.config.json");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        security: {
          execution_isolation: {
            mode: "sandbox",
            sandbox: {
              mounts: [
                {
                  source: "C:\\Users\\owner\\project",
                  target: "/custom-project",
                  read_only: true,
                },
              ],
            },
          },
        },
      }),
    );

    manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });

    const config = JSON.parse(await readFile(globalConfigPath, "utf8"));
    assert.equal(config.security.execution_isolation.mode, "sandbox");
    assert.deepEqual(config.security.execution_isolation.sandbox.mounts, [
      {
        source: "C:\\Users\\owner\\project",
        target: "/custom-project",
        read_only: true,
      },
    ]);
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop defaults to host once and never overrides a later isolation selection", async () => {
  const fixture = await createFixture();
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    const globalConfigPath = path.join(fixture.userDataPath, "config", "global.config.json");

    manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });
    const firstConfig = JSON.parse(await readFile(globalConfigPath, "utf8"));
    assert.equal(firstConfig.security.execution_isolation.mode, "host");

    firstConfig.security.execution_isolation = {
      mode: "sandbox",
      sandbox: {
        scope: "global",
        mounts: [{ source: "/host/project", target: "/project" }],
      },
    };
    await writeFile(globalConfigPath, JSON.stringify(firstConfig));

    const examplePath = path.join(
      fixture.packagedBackendRoot,
      "service",
      "config",
      "global.config.example.json",
    );
    const nextExample = JSON.parse(await readFile(examplePath, "utf8"));
    nextExample.security.execution_isolation.sandbox.lock_wait_timeout_ms = 120000;
    await writeFile(examplePath, JSON.stringify(nextExample));

    manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });
    const restartedConfig = JSON.parse(await readFile(globalConfigPath, "utf8"));
    assert.equal(restartedConfig.security.execution_isolation.mode, "sandbox");
    assert.equal(restartedConfig.security.execution_isolation.sandbox.scope, "global");
    assert.deepEqual(restartedConfig.security.execution_isolation.sandbox.mounts, [
      { source: "/host/project", target: "/project" },
    ]);
    assert.equal(restartedConfig.security.execution_isolation.sandbox.lock_wait_timeout_ms, 120000);
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop config restores missing userData template example before saving super admin", async () => {
  const fixture = await createFixture();
  const logs = [];
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
      appendDesktopLog: (line) => logs.push(line),
    });

    const state = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });
    const templateExample = path.join(
      fixture.userDataPath,
      "user-template",
      "default-user",
      "config.example.json",
    );
    assert.equal(state.workspaceTemplatePath, path.dirname(templateExample));
    assert.equal(state.templateConfigPath, path.join(path.dirname(templateExample), "config.json"));
    assert.equal(JSON.parse(await readFile(templateExample, "utf8")).default_provider, "openai");

    await rm(templateExample, { force: true });
    const restoredState = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });
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
    assert.equal(globalConfig.security.execution_isolation.mode, "host");
    assert.equal(templateConfig.default_provider, "openai");
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop config fails fast when bundled default user template is missing", async () => {
  const fixture = await createFixture();
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    await rm(path.join(fixture.packagedBackendRoot, "user-template"), {
      recursive: true,
      force: true,
    });

    assert.throws(
      () =>
        manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath }),
      /desktop bundled default user config example is missing or invalid:/,
    );
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop config replaces corrupted userData template example from bundled runtime", async () => {
  const fixture = await createFixture();
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    const templateDir = path.join(fixture.userDataPath, "user-template", "default-user");
    const templateExample = path.join(templateDir, "config.example.json");
    await mkdir(templateDir, { recursive: true });
    await writeFile(templateExample, "{broken", "utf8");

    const state = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });
    assert.equal(state.workspaceTemplatePath, templateDir);
    assert.equal(JSON.parse(await readFile(templateExample, "utf8")).default_provider, "openai");
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop config restores core template even when directory sync fails", async () => {
  const fixture = await createFixture();
  const originalCpSync = fs.cpSync;
  try {
    const logs = [];
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
      appendDesktopLog: (line) => logs.push(line),
    });
    fs.cpSync = () => {
      throw new Error("directory copy blocked");
    };

    const state = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });
    const templateExample = path.join(
      fixture.userDataPath,
      "user-template",
      "default-user",
      "config.example.json",
    );
    assert.equal(state.workspaceTemplatePath, path.dirname(templateExample));
    assert.equal(JSON.parse(await readFile(templateExample, "utf8")).default_provider, "openai");
    assert.equal(
      await readFile(
        path.join(
          fixture.userDataPath,
          "user-template",
          "default-user",
          "memory",
          "short-memory.json",
        ),
        "utf8",
      ),
      "{}",
    );
    assert.match(
      await readFile(
        path.join(
          fixture.userDataPath,
          "user-template",
          "default-user",
          "services",
          "weather-service-handler.js",
        ),
        "utf8",
      ),
      /export default/,
    );
    assert.match(
      await readFile(
        path.join(fixture.userDataPath, "user-template", "default-user", "skills", "SKILL.md"),
        "utf8",
      ),
      /Skill/,
    );
    assert.ok(logs.some((line) => line.includes("desktop template directory sync failed")));
    assert.ok(logs.some((line) => line.includes("manual fallback")));
  } finally {
    fs.cpSync = originalCpSync;
    await fixture.restore();
  }
});
