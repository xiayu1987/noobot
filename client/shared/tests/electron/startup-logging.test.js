/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { clientFilePath as path } from "../../path-resolver.js";
import test from "node:test";
import { appendDesktopLogLine, DESKTOP_LOG_FILES, createStartupLogger } from "../../electron/runtime/logging.js";

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

test("desktop logger rotates oversized files with bounded retention", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-startup-log-rotation-"));
  const logFile = path.join(rootDir, "service.log");
  try {
    await writeFile(logFile, "old-log-content", "utf8");
    await appendDesktopLogLine(logFile, "new-line\n", { maxBytes: 10, retain: 2 });
    assert.equal(await readFile(logFile, "utf8"), "new-line\n");
    assert.equal(await readFile(`${logFile}.1`, "utf8"), "old-log-content");

    await appendDesktopLogLine(logFile, "next-line\n", { maxBytes: 10, retain: 2 });
    assert.equal(await readFile(`${logFile}.1`, "utf8"), "new-line\n");
    assert.equal(await readFile(`${logFile}.2`, "utf8"), "old-log-content");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
