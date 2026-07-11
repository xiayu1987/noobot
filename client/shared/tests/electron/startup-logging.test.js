/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { clientFilePath as path } from "../../path-resolver.js";
import test from "node:test";
import { DESKTOP_LOG_FILES, createStartupLogger } from "../../electron/startup-logging.js";

function waitForLogWrites() {
  return new Promise((resolve) => setTimeout(resolve, 40));
}

test("desktop logger writes role-specific files under one logs directory", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-startup-logging-"));
  const app = {
    getPath: (name) => {
      assert.equal(name, "userData");
      return rootDir;
    },
  };

  try {
    const logger = createStartupLogger({ app, startupDebugEnabled: true });
    logger.writeStartupLog("main", "status", { phase: "checking", message: "Checking service" });
    logger.appendDesktopLog("window ready");
    logger.writeDependencyLog("ensure:start", { key: "ffmpeg" });
    logger.appendServiceLog("service stdout line");
    logger.appendAgentProxyLog("agent proxy stdout line");

    await waitForLogWrites();

    const logsDir = path.join(rootDir, "logs");
    assert.equal(logger.getLogDir(), logsDir);
    assert.equal(logger.getLogFilePath(), path.join(logsDir, DESKTOP_LOG_FILES.STARTUP));
    assert.equal(logger.getLogFilePath(DESKTOP_LOG_FILES.SERVICE), path.join(logsDir, DESKTOP_LOG_FILES.SERVICE));

    assert.match(await readFile(path.join(logsDir, DESKTOP_LOG_FILES.STARTUP), "utf8"), /main:status/);
    assert.match(await readFile(path.join(logsDir, DESKTOP_LOG_FILES.MAIN), "utf8"), /window ready/);
    assert.match(await readFile(path.join(logsDir, DESKTOP_LOG_FILES.DEPENDENCY), "utf8"), /dependency:ensure:start/);
    assert.match(await readFile(path.join(logsDir, DESKTOP_LOG_FILES.SERVICE), "utf8"), /service stdout line/);
    assert.match(await readFile(path.join(logsDir, DESKTOP_LOG_FILES.AGENT_PROXY), "utf8"), /agent proxy stdout line/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
