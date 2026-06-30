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
import {
  applyStartupRuntimeEnv,
  createDefaultStartupContext,
  loadStartupContext,
  normalizeStartupContext,
  resolveStartupContextPath,
  safeStartupContextForLog,
} from "../services/startup-context-service.js";

test("startup-context-service resolves --startup-context argument forms", () => {
  const filePath = path.join(os.tmpdir(), "noobot-startup-context.json");
  assert.equal(resolveStartupContextPath(["node", "app.js", "--startup-context", filePath]), path.resolve(filePath));
  assert.equal(resolveStartupContextPath(["node", "app.js", `--startup-context=${filePath}`]), path.resolve(filePath));
});

test("startup-context-service normalizes pluginRootDir from backendRoot", () => {
  const cwd = path.join(os.tmpdir(), "noobot-backend");
  const context = normalizeStartupContext({ paths: { backendRoot: cwd } }, { cwd });
  assert.equal(context.paths.backendRoot, path.resolve(cwd));
  assert.equal(context.paths.pluginRootDir, path.join(path.resolve(cwd), "plugin"));
});

test("startup-context-service loads explicit snapshot and preserves explicit pluginRootDir", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-startup-context-test-"));
  const backendRoot = path.join(tempDir, "resources", "backend");
  const pluginRootDir = path.join(backendRoot, "plugin");
  const startupContextPath = path.join(tempDir, "startup-context.json");
  await fs.writeFile(startupContextPath, JSON.stringify({
    schemaVersion: 1,
    app: { platform: "desktop", channel: "win32", packaged: true },
    paths: { backendRoot, pluginRootDir },
    service: { port: 10061, origin: "http://127.0.0.1:10061" },
    runtime: {
      env: {
        PATH: "/managed/bin:/usr/bin",
        NOOBOT_FFMPEG_PATH: "/managed/bin/ffmpeg",
        LIBRE_OFFICE_EXE: "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      },
      dependencies: {
        hasFfmpeg: true,
        hasLibreOffice: true,
        ffmpegPath: "/managed/bin/ffmpeg",
        libreOfficePath: "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      },
    },
  }), "utf8");

  const context = await loadStartupContext({
    argv: ["node", "app.js", "--startup-context", startupContextPath],
    cwd: tempDir,
  });

  assert.equal(context.app.platform, "desktop");
  assert.equal(context.app.packaged, true);
  assert.equal(context.paths.backendRoot, path.resolve(backendRoot));
  assert.equal(context.paths.pluginRootDir, path.resolve(pluginRootDir));
  assert.equal(context.service.port, 10061);
  assert.equal(context.runtime.env.NOOBOT_FFMPEG_PATH, "/managed/bin/ffmpeg");
  assert.equal(context.runtime.env.LIBRE_OFFICE_EXE, "/Applications/LibreOffice.app/Contents/MacOS/soffice");
  assert.equal(context.runtime.dependencies.hasFfmpeg, true);
});

test("startup-context-service applies runtime env to service process env", () => {
  const env = {};
  const applied = applyStartupRuntimeEnv({
    runtime: {
      env: {
        PATH: "/managed/bin:/usr/bin",
        NOOBOT_FFMPEG_PATH: "/managed/bin/ffmpeg",
        EMPTY_VALUE: "",
      },
    },
  }, { env });

  assert.deepEqual(applied, {
    PATH: "/managed/bin:/usr/bin",
    NOOBOT_FFMPEG_PATH: "/managed/bin/ffmpeg",
  });
  assert.equal(env.PATH, "/managed/bin:/usr/bin");
  assert.equal(env.NOOBOT_FFMPEG_PATH, "/managed/bin/ffmpeg");
  assert.equal("EMPTY_VALUE" in env, false);
});

test("startup-context-service creates web/dev default context when no snapshot is provided", () => {
  const cwd = path.join(os.tmpdir(), "noobot-service");
  const context = createDefaultStartupContext({ cwd });
  assert.equal(context.app.platform, "web");
  assert.equal(context.paths.backendRoot, path.resolve(cwd));
  assert.equal(context.paths.pluginRootDir, path.join(path.resolve(cwd), "plugin"));
});

test("startup-context-service uses repository root when service cwd is the service directory", () => {
  const repoRoot = path.join(os.tmpdir(), "noobot-repo");
  const cwd = path.join(repoRoot, "service");
  const context = createDefaultStartupContext({ cwd });
  assert.equal(context.paths.backendRoot, path.resolve(repoRoot));
  assert.equal(context.paths.pluginRootDir, path.join(path.resolve(repoRoot), "plugin"));
});

test("startup-context-service safe log returns normalized startup fields", () => {
  const cwd = path.join(os.tmpdir(), "noobot-safe-log");
  const logContext = safeStartupContextForLog({ paths: { backendRoot: cwd }, service: { port: 12345 } });
  assert.equal(logContext.paths.pluginRootDir, path.join(path.resolve(cwd), "plugin"));
  assert.equal(logContext.service.port, 12345);
  assert.equal(typeof logContext.createdAt, "string");
});
