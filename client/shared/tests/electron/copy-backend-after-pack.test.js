/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { clientFilePath as path } from "../../path-resolver.js";
import test from "node:test";
import copyBackendAfterPack from "../../scripts/copy-backend-after-pack.mjs";

async function writeRuntimeFile(rootDir, relativePath, content = "test") {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function createFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-copy-backend-after-pack-"));
  const projectDir = path.join(rootDir, "client", "windows");
  const backendSource = path.join(projectDir, "build", "backend-runtime", "backend");
  const appOutDir = path.join(projectDir, "dist", "win-unpacked");
  const frontendSource = path.join(rootDir, "client", "noobot-chat", "dist");

  await writeRuntimeFile(backendSource, "service/app.js");
  await writeRuntimeFile(backendSource, "node_modules/noobot-agent/package.json", "{}");
  await writeRuntimeFile(backendSource, "node_modules/@noobot/sanitize/package.json", "{}");
  await writeRuntimeFile(
    backendSource,
    "node_modules/noobot-agent/src/system-core/system-prompt/base.md",
    "base prompt",
  );
  await writeRuntimeFile(
    backendSource,
    "node_modules/noobot-agent/src/system-core/system-prompt/base.zh-CN.md",
    "zh prompt",
  );
  await writeRuntimeFile(
    backendSource,
    "node_modules/noobot-agent/src/system-core/system-prompt/base.en-US.md",
    "en prompt",
  );
  await writeRuntimeFile(backendSource, "node_modules/express/package.json", "{}");
  await writeRuntimeFile(backendSource, "plugin/noobot-plugin-harness/manifest.json", "{}");
  await writeRuntimeFile(backendSource, "plugin/noobot-plugin-workflow/manifest.json", "{}");
  await writeRuntimeFile(backendSource, "service/config/global.config.example.json", "{}");
  await writeRuntimeFile(backendSource, "user-template/default-user/config.example.json", "{}");
  await writeRuntimeFile(frontendSource, "index.html", "<html></html>");

  const context = {
    appOutDir,
    electronPlatformName: "win32",
    packager: {
      projectDir,
    },
  };

  return { rootDir, context, backendSource, appOutDir };
}

test("copyBackendAfterPack copies backend plugins into packaged resources", async () => {
  const fixture = await createFixture();
  try {
    await copyBackendAfterPack(fixture.context);

    const backendDestination = path.join(fixture.appOutDir, "resources", "backend");
    assert.equal(
      await readFile(path.join(backendDestination, "plugin", "noobot-plugin-harness", "manifest.json"), "utf8"),
      "{}",
    );
    assert.equal(
      await readFile(path.join(backendDestination, "plugin", "noobot-plugin-workflow", "manifest.json"), "utf8"),
      "{}",
    );
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("copyBackendAfterPack copies bundled agent system prompts into packaged resources", async () => {
  const fixture = await createFixture();
  try {
    await copyBackendAfterPack(fixture.context);

    const backendDestination = path.join(fixture.appOutDir, "resources", "backend");
    const systemPromptDir = path.join(
      backendDestination,
      "node_modules",
      "noobot-agent",
      "src",
      "system-core",
      "system-prompt",
    );
    assert.equal(await readFile(path.join(systemPromptDir, "base.md"), "utf8"), "base prompt");
    assert.equal(await readFile(path.join(systemPromptDir, "base.zh-CN.md"), "utf8"), "zh prompt");
    assert.equal(await readFile(path.join(systemPromptDir, "base.en-US.md"), "utf8"), "en prompt");
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("copyBackendAfterPack copies the sanitize workspace into packaged resources", async () => {
  const fixture = await createFixture();
  try {
    await copyBackendAfterPack(fixture.context);

    const backendDestination = path.join(fixture.appOutDir, "resources", "backend");
    assert.equal(
      await readFile(path.join(backendDestination, "node_modules", "@noobot", "sanitize", "package.json"), "utf8"),
      "{}",
    );
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("copyBackendAfterPack fails when the prepared runtime is missing sanitize", async () => {
  const fixture = await createFixture();
  try {
    await rm(path.join(fixture.backendSource, "node_modules", "@noobot", "sanitize"), {
      recursive: true,
      force: true,
    });

    await assert.rejects(
      () => copyBackendAfterPack(fixture.context),
      /Missing required backend runtime file after prepare: node_modules\/@noobot\/sanitize\/package\.json/,
    );
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("copyBackendAfterPack fails when prepared backend runtime is missing locale system prompts", async () => {
  const fixture = await createFixture();
  try {
    await rm(
      path.join(
        fixture.backendSource,
        "node_modules",
        "noobot-agent",
        "src",
        "system-core",
        "system-prompt",
        "base.en-US.md",
      ),
      { force: true },
    );

    await assert.rejects(
      () => copyBackendAfterPack(fixture.context),
      /Missing required backend runtime file after prepare: node_modules\/noobot-agent\/src\/system-core\/system-prompt\/base\.en-US\.md/,
    );
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("copyBackendAfterPack copies bundled agent system prompts into macOS app resources", async () => {
  const fixture = await createFixture();
  try {
    const macContext = {
      ...fixture.context,
      electronPlatformName: "darwin",
      packager: {
        ...fixture.context.packager,
        appInfo: {
          productFilename: "Noobot",
        },
      },
    };
    await copyBackendAfterPack(macContext);

    const systemPromptDir = path.join(
      fixture.appOutDir,
      "Noobot.app",
      "Contents",
      "Resources",
      "backend",
      "node_modules",
      "noobot-agent",
      "src",
      "system-core",
      "system-prompt",
    );
    assert.equal(await readFile(path.join(systemPromptDir, "base.zh-CN.md"), "utf8"), "zh prompt");
    assert.equal(await readFile(path.join(systemPromptDir, "base.en-US.md"), "utf8"), "en prompt");
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("copyBackendAfterPack keeps legacy bundled agent system prompt required", async () => {
  const fixture = await createFixture();
  try {
    await rm(
      path.join(
        fixture.backendSource,
        "node_modules",
        "noobot-agent",
        "src",
        "system-core",
        "system-prompt",
        "base.md",
      ),
      { force: true },
    );

    await assert.rejects(
      () => copyBackendAfterPack(fixture.context),
      /Missing required backend runtime file after prepare: node_modules\/noobot-agent\/src\/system-core\/system-prompt\/base\.md/,
    );
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("copyBackendAfterPack fails when prepared backend runtime is missing bundled agent system prompt directory", async () => {
  const fixture = await createFixture();
  try {
    await rm(
      path.join(fixture.backendSource, "node_modules", "noobot-agent", "src", "system-core", "system-prompt"),
      { recursive: true, force: true },
    );

    await assert.rejects(
      () => copyBackendAfterPack(fixture.context),
      /Missing required backend runtime file after prepare: node_modules\/noobot-agent\/src\/system-core\/system-prompt\/base\.md/,
    );
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("copyBackendAfterPack fails when prepared backend runtime is missing bundled agent Chinese system prompt", async () => {
  const fixture = await createFixture();
  try {
    await rm(
      path.join(
        fixture.backendSource,
        "node_modules",
        "noobot-agent",
        "src",
        "system-core",
        "system-prompt",
        "base.zh-CN.md",
      ),
      { force: true },
    );

    await assert.rejects(
      () => copyBackendAfterPack(fixture.context),
      /Missing required backend runtime file after prepare: node_modules\/noobot-agent\/src\/system-core\/system-prompt\/base\.zh-CN\.md/,
    );
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("copyBackendAfterPack preserves the legacy base prompt content", async () => {
  const fixture = await createFixture();
  try {
    await copyBackendAfterPack(fixture.context);

    const backendDestination = path.join(fixture.appOutDir, "resources", "backend");
    assert.equal(
      await readFile(
        path.join(
          backendDestination,
          "node_modules",
          "noobot-agent",
          "src",
          "system-core",
          "system-prompt",
          "base.md",
        ),
        "utf8",
      ),
      "base prompt",
    );
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("copyBackendAfterPack fails when prepared backend runtime is missing plugin manifests", async () => {
  const fixture = await createFixture();
  try {
    await rm(path.join(fixture.backendSource, "plugin", "noobot-plugin-harness"), { recursive: true, force: true });

    await assert.rejects(
      () => copyBackendAfterPack(fixture.context),
      /Missing required backend runtime file after prepare: plugin\/noobot-plugin-harness\/manifest\.json/,
    );
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("copyBackendAfterPack fails when prepared backend runtime is missing default user template", async () => {
  const fixture = await createFixture();
  try {
    await rm(path.join(fixture.backendSource, "user-template"), { recursive: true, force: true });

    await assert.rejects(
      () => copyBackendAfterPack(fixture.context),
      /Missing required backend runtime file after prepare: user-template\/default-user\/config\.example\.json/,
    );
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});
