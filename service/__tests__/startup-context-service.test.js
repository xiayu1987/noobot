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
import { RUNTIME_PORT_TOPOLOGY } from "@noobot/runtime-topology-protocol/ports";
import {
  applyStartupRuntimeEnv,
  createDefaultStartupContext,
  loadStartupContext,
  normalizeStartupContext,
  resolveStartupContextPath,
  safeStartupContextForLog,
} from "../services/startup-context-service.js";

const ffmpegSourceItem = Object.freeze({
  key: "ffmpeg",
  name: "FFmpeg",
  available: true,
  installMode: "managed",
  sourceType: "self-hosted",
  hasCustomSource: true,
  customSourceEnvKeys: ["NOOBOT_FFMPEG_MAC_URL"],
  configKeys: ["darwinManaged.url"],
});

function createDesktopStartupContext(backendRoot) {
  return {
    schemaVersion: 1,
    app: { name: "Noobot", platform: "desktop", channel: "darwin", packaged: true },
    paths: {
      backendRoot,
      frontendRoot: path.join(backendRoot, "frontend"),
      pluginRootDir: path.join(backendRoot, "plugin"),
      userDataDir: path.join(backendRoot, "user-data"),
    },
    service: { port: 10061, host: "127.0.0.1", origin: "http://127.0.0.1:10061" },
    runtime: {
      node: process.version,
      cwd: backendRoot,
      execPath: process.execPath,
      resourcesPath: "",
      env: {
        PATH: "/managed/bin:/usr/bin",
        NOOBOT_FFMPEG_PATH: "/managed/bin/ffmpeg",
        LIBRE_OFFICE_EXE: "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      },
      dependencies: {
        hasPlaywrightChromium: false,
        hasFfmpeg: true,
        hasFfprobe: false,
        hasLibreOffice: true,
        ffmpegPath: "/managed/bin/ffmpeg",
        ffprobePath: "",
        libreOfficePath: "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        playwrightChromiumPath: "",
        pathPrefix: "/managed/bin | /usr/bin",
        sourceSummary: { platform: "darwin", dependencies: [ffmpegSourceItem] },
      },
    },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

test("startup-context-service resolves --startup-context argument forms", () => {
  const filePath = path.join(os.tmpdir(), "noobot-startup-context.json");
  assert.equal(
    resolveStartupContextPath(["node", "app.js", "--startup-context", filePath]),
    path.resolve(filePath),
  );
  assert.equal(
    resolveStartupContextPath(["node", "app.js", `--startup-context=${filePath}`]),
    path.resolve(filePath),
  );
  assert.equal(resolveStartupContextPath(["node", "app.js"]), "");
});

test("startup-context-service loads the desktop snapshot written by the client", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-startup-context-test-"));
  const snapshot = createDesktopStartupContext(path.join(tempDir, "backend"));
  const startupContextPath = path.join(tempDir, "startup-context.json");
  await fs.writeFile(startupContextPath, JSON.stringify(snapshot), "utf8");

  const context = await loadStartupContext({
    argv: ["node", "app.js", "--startup-context", startupContextPath],
    cwd: tempDir,
    env: { PORT: "1" },
  });

  assert.deepEqual(context, snapshot);
});

test("startup-context-service rejects incomplete or invalid snapshots", () => {
  const snapshot = createDesktopStartupContext(path.join(os.tmpdir(), "noobot-invalid"));
  assert.throws(
    () => normalizeStartupContext({ ...snapshot, service: { port: 10061 } }),
    /service\.host must be a string/,
  );
  assert.throws(
    () => normalizeStartupContext({ ...snapshot, app: { ...snapshot.app, platform: "mobile" } }),
    /app\.platform must be one of desktop, web/,
  );
  const { hasPlaywrightChromium, ...dependencies } = snapshot.runtime.dependencies;
  assert.equal(hasPlaywrightChromium, false);
  assert.throws(
    () => normalizeStartupContext({ ...snapshot, runtime: { ...snapshot.runtime, dependencies } }),
    /runtime\.dependencies\.hasPlaywrightChromium must be a boolean/,
  );
});

test("startup-context-service creates the headless context from the runtime topology", () => {
  const cwd = path.join(os.tmpdir(), "noobot-service-headless");
  const context = createDefaultStartupContext({ cwd, env: {} });
  assert.equal(context.app.platform, "web");
  assert.equal(context.paths.backendRoot, path.resolve(cwd));
  assert.equal(context.paths.pluginRootDir, path.join(path.resolve(cwd), "plugin"));
  assert.equal(context.service.port, RUNTIME_PORT_TOPOLOGY.servicePort);
  assert.equal(context.service.host, "");
  assert.equal(context.runtime.dependencies, null);
  assert.equal(createDefaultStartupContext({ cwd, env: { PORT: "31061" } }).service.port, 31061);
});

test("startup-context-service uses repository root when service cwd is the service directory", () => {
  const repoRoot = path.join(os.tmpdir(), "noobot-repo");
  const context = createDefaultStartupContext({ cwd: path.join(repoRoot, "service"), env: {} });
  assert.equal(context.paths.backendRoot, path.resolve(repoRoot));
  assert.equal(context.paths.pluginRootDir, path.join(path.resolve(repoRoot), "plugin"));
});

test("startup-context-service applies runtime env to service process env", () => {
  const snapshot = normalizeStartupContext(
    createDesktopStartupContext(path.join(os.tmpdir(), "noobot-env")),
  );
  const env = {};
  const applied = applyStartupRuntimeEnv(snapshot, { env });
  assert.deepEqual(applied, snapshot.runtime.env);
  assert.equal(env.NOOBOT_FFMPEG_PATH, "/managed/bin/ffmpeg");
});

test("startup-context-service safe log redacts runtime env", () => {
  const snapshot = normalizeStartupContext(
    createDesktopStartupContext(path.join(os.tmpdir(), "noobot-safe-log")),
  );
  const logContext = safeStartupContextForLog(snapshot);
  assert.equal(logContext.service.port, 10061);
  assert.deepEqual(logContext.runtime.env, {
    PATH: "[set]",
    NOOBOT_FFMPEG_PATH: "/managed/bin/ffmpeg",
    NOOBOT_FFPROBE_PATH: "",
    NOOBOT_PLAYWRIGHT_CHROMIUM_PATH: "",
    LIBRE_OFFICE_EXE: "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  });
  assert.equal(snapshot.runtime.env.PATH, "/managed/bin:/usr/bin");
});
