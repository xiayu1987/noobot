/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { addressPort, resolveRuntimeTopology } from "@noobot/runtime-topology-protocol/ports";
import { requireWorkspaceRootEnv } from "@noobot/runtime-topology-protocol/workspace-root";
import { request as playwrightRequest } from "@playwright/test";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol/layout";
import { readE2eCredentials } from "./fixtures/auth.fixture.js";
import { admissionRetryDelayMs } from "./helpers/http-admission.js";
import { withNativeDesktop } from "./helpers/native-desktop.js";
import { e2eRunId, runOpsWorkdir, runOpsWorkdirPath } from "./helpers/run-ops-workdir.js";
import { text } from "@noobot/shared/value";
import { validateRequestLogOrder } from "../../../../../scripts/quality/model-context-convergence/request-log-audit.mjs";

const REGISTRY_FILE = "suite-sessions.json";

function registryPath() {
  const { userId } = readE2eCredentials();
  return path.join(requireWorkspaceRootEnv(), userId, runOpsWorkdirPath(REGISTRY_FILE));
}

async function connectForCleanup(context, credentials) {
  for (;;) {
    const response = await context.post("/api/internal/connect", { data: credentials });
    const payload = await response.json();
    if (response.ok() && payload?.ok === true && payload?.apiKey) return payload.apiKey;
    if (response.status() !== 429) {
      throw new Error(`Suite Session cleanup authentication failed (${response.status()})`);
    }
    await new Promise((resolve) => setTimeout(resolve, admissionRetryDelayMs(response, payload)));
  }
}

async function deleteSessionWithAdmissionRetry(context, { userId, sessionId, apiKey }) {
  const endpoint = `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`;
  for (;;) {
    const response = await context.delete(endpoint, { headers: { "x-api-key": apiKey } });
    const payload = await response.json();
    if (response.ok() && payload?.ok === true) return;
    if (response.status() !== 429) {
      throw new Error(
        `Suite Session cleanup failed (${response.status()}): ${String(payload?.error || "unknown error")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, admissionRetryDelayMs(response, payload)));
  }
}

async function readRegistry() {
  try {
    const records = JSON.parse(await fs.readFile(registryPath(), "utf8"));
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function registerSuiteSession(record) {
  const userId = text(record?.userId);
  const sessionId = text(record?.sessionId);
  if (!userId || !sessionId) {
    throw new Error("E2E cleanup registration requires userId and sessionId");
  }
  const records = await readRegistry();
  if (!records.some((item) => item.userId === userId && item.sessionId === sessionId)) {
    records.push({ userId, sessionId });
  }
  const target = registryPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
}

async function deleteRegisteredSessions(records, credentials) {
  const topology = resolveRuntimeTopology(process.env);
  const defaultBaseUrl = `http://${topology.loopbackHost}:${addressPort(topology.clientAddr)}`;
  const baseURL = String(process.env.NOOBOT_E2E_BASE_URL || defaultBaseUrl).replace(/\/$/, "");
  const context = await playwrightRequest.newContext({ baseURL });
  try {
    const apiKey = await connectForCleanup(context, credentials);
    for (const { userId, sessionId } of records) {
      await deleteSessionWithAdmissionRetry(context, { userId, sessionId, apiKey });
    }
  } finally {
    await context.dispose();
  }
}

function hasPatterns(value) {
  return (Array.isArray(value) ? value : [value]).some(Boolean);
}

function isMatchAll(grep) {
  const patterns = Array.isArray(grep) ? grep : [grep];
  return patterns.length === 1 && patterns[0] instanceof RegExp && patterns[0].source === ".*";
}

async function listSpecFiles(dir, pattern, ignored) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (ignored.some((ignore) => ignore.test(target))) continue;
    if (entry.isDirectory()) files.push(...(await listSpecFiles(target, pattern, ignored)));
    else if (pattern.test(target)) files.push(target);
  }
  return files;
}

async function assertUnfilteredFullSuite(config, suite) {
  const filtered =
    !isMatchAll(config.grep) ||
    hasPatterns(config.grepInvert) ||
    Boolean(config.shard) ||
    config.projects.some((project) => !isMatchAll(project.grep) || hasPatterns(project.grepInvert));
  const selectedFiles = new Set(suite.allTests().map((test) => test.location.file));
  for (const project of config.projects) {
    if (!(project.testMatch instanceof RegExp)) {
      throw new Error("NOOBOT_E2E_FULL_SUITE requires a RegExp testMatch");
    }
    const ignored = [project.testIgnore].flat().filter(Boolean);
    if (ignored.some((pattern) => !(pattern instanceof RegExp))) {
      throw new Error("NOOBOT_E2E_FULL_SUITE requires RegExp testIgnore patterns");
    }
    const specFiles = await listSpecFiles(project.testDir, project.testMatch, ignored);
    if (specFiles.length === 0 || specFiles.some((file) => !selectedFiles.has(file))) {
      throw new Error("NOOBOT_E2E_FULL_SUITE runs must include every spec file");
    }
  }
  if (filtered) {
    throw new Error("NOOBOT_E2E_FULL_SUITE runs must not filter tests (grep/grepInvert/shard)");
  }
}

export default class SuiteSessionCleanupReporter {
  constructor({ failureEvidenceRoot } = {}) {
    this.failureEvidenceRoot = text(failureEvidenceRoot);
    if (!path.isAbsolute(this.failureEvidenceRoot)) {
      throw new Error("Suite Session cleanup requires an absolute failureEvidenceRoot");
    }
    this.requestLogsRoot = process.env.NOOBOT_MODEL_PROXY_LOG_DIR;
    this.outputDirs = [];
  }

  onBegin(config, suite) {
    this.outputDirs = [...new Set(config.projects.map((project) => project.outputDir))];
    if (process.env.NOOBOT_E2E_FULL_SUITE === "1" && !path.isAbsolute(this.requestLogsRoot ?? "")) {
      throw new Error("Full suite requires an absolute NOOBOT_MODEL_PROXY_LOG_DIR");
    }
    this.fullSuiteCheck =
      process.env.NOOBOT_E2E_FULL_SUITE === "1"
        ? assertUnfilteredFullSuite(config, suite)
        : Promise.resolve();
    this.fullSuiteCheck.catch(() => {});
  }

  evidenceDirectory() {
    return path.join(this.failureEvidenceRoot, e2eRunId());
  }

  async preserveFailureEvidence(userId) {
    const evidenceDir = this.evidenceDirectory();
    await fs.mkdir(evidenceDir, { recursive: true });
    const runtimeDir = WORKSPACE_LAYOUT.RUNTIME_DIR;
    await fs.cp(
      path.join(requireWorkspaceRootEnv(), userId, runtimeDir),
      path.join(evidenceDir, runtimeDir),
      {
        recursive: true,
      },
    );
    for (const outputDir of this.outputDirs) {
      await fs.cp(outputDir, path.join(evidenceDir, path.basename(outputDir)), {
        recursive: true,
      });
    }
  }

  async onEnd(result) {
    await this.fullSuiteCheck;
    if (process.env.NOOBOT_E2E_FULL_SUITE !== "1") return;
    const credentials = readE2eCredentials();
    const records = await readRegistry();
    if (result.status !== "passed") {
      if (records.length > 0) await this.preserveFailureEvidence(credentials.userId);
      return;
    }
    if (records.some((record) => record.userId !== credentials.userId)) {
      throw new Error("Suite Session cleanup requires credentials for every registered owner");
    }
    const failures = [];
    const checked = [];
    const logPaths = [];
    for await (const relative of fs.glob("**/*.log", { cwd: this.requestLogsRoot })) {
      logPaths.push(path.join(this.requestLogsRoot, relative));
    }
    validateRequestLogOrder(logPaths, {
      fail: (title, detail) => failures.push(detail ? `${title}\n${detail}` : title),
      pass: (title) => checked.push(title),
    });
    if (failures.length) {
      await this.preserveFailureEvidence(credentials.userId);
      throw new Error(`Pre-cleanup model request audit failed:\n${failures.join("\n")}`);
    }
    console.log(`[model-request-log] pre-cleanup audit passed: ${checked.length} logs`);
    if (records.length > 0) {
      try {
        if (process.env.NOOBOT_E2E_DESKTOP_EXECUTABLE) {
          await withNativeDesktop(process.env.NOOBOT_E2E_DESKTOP_USER_DATA_DIR, () =>
            deleteRegisteredSessions(records, credentials),
          );
        } else {
          await deleteRegisteredSessions(records, credentials);
        }
      } catch (error) {
        await this.preserveFailureEvidence(credentials.userId);
        throw error;
      }
    }
    await fs.rm(this.evidenceDirectory(), { recursive: true, force: true });
    await fs.rm(path.join(requireWorkspaceRootEnv(), credentials.userId, runOpsWorkdir()), {
      recursive: true,
      force: true,
    });
  }
}
