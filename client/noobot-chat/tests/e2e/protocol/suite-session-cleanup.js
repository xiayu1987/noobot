/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { addressPort, resolveRuntimeTopology } from "@noobot/runtime-topology-protocol/ports";
import { request as playwrightRequest } from "@playwright/test";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol/layout";
import { readE2eCredentials } from "./fixtures/auth.fixture.js";
import { admissionRetryDelayMs } from "./helpers/http-admission.js";
import { workspaceRoot } from "./helpers/persistence-audit.js";
import { runOpsWorkdir } from "./helpers/run-ops-workdir.js";

const registryPath = String(process.env.NOOBOT_E2E_SESSION_REGISTRY || "").trim();
const runId = String(process.env.NOOBOT_E2E_RUN_ID || "").trim();
const REGISTRY_SOURCE = "playwright-e2e-created-session";

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
  if (!registryPath) return [];
  try {
    const records = JSON.parse(await fs.readFile(registryPath, "utf8"));
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function registryRecordKey(record) {
  const runIdPart = String(record?.runId || "").trim();
  const userIdPart = String(record?.userId || "").trim();
  const sessionIdPart = String(record?.sessionId || "").trim();
  return `${runIdPart}/${userIdPart}/${sessionIdPart}`;
}

async function retireRegistryRecords(reclaimedKeys) {
  const remaining = (await readRegistry()).filter(
    (record) => !reclaimedKeys.has(registryRecordKey(record)),
  );
  if (remaining.length === 0) {
    await fs.unlink(registryPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    return;
  }
  await fs.writeFile(registryPath, `${JSON.stringify(remaining, null, 2)}\n`, { mode: 0o600 });
}

export async function registerSuiteSession(record) {
  if (!registryPath) throw new Error("NOOBOT_E2E_SESSION_REGISTRY is required");
  if (!runId) throw new Error("NOOBOT_E2E_RUN_ID is required");
  const userId = String(record?.userId || "").trim();
  const sessionId = String(record?.sessionId || "").trim();
  if (!userId || !sessionId) {
    throw new Error("E2E cleanup registration requires userId and sessionId");
  }
  const records = await readRegistry();
  const entry = { source: REGISTRY_SOURCE, runId, userId, sessionId };
  const entryKey = registryRecordKey(entry);
  if (!records.some((item) => registryRecordKey(item) === entryKey)) {
    records.push(entry);
  }
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
}

function hasPatterns(value) {
  return (Array.isArray(value) ? value : [value]).some(Boolean);
}

function isMatchAll(grep) {
  const patterns = Array.isArray(grep) ? grep : [grep];
  return patterns.length === 1 && patterns[0] instanceof RegExp && patterns[0].source === ".*";
}

async function listSpecFiles(dir, pattern) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listSpecFiles(target, pattern)));
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
    const specFiles = await listSpecFiles(project.testDir, project.testMatch);
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
    this.failureEvidenceRoot = String(failureEvidenceRoot || "").trim();
    if (!path.isAbsolute(this.failureEvidenceRoot)) {
      throw new Error("Suite Session cleanup requires an absolute failureEvidenceRoot");
    }
    this.outputDirs = [];
  }

  onBegin(config, suite) {
    this.outputDirs = [...new Set(config.projects.map((project) => project.outputDir))];
    this.fullSuiteCheck =
      process.env.NOOBOT_E2E_FULL_SUITE === "1"
        ? assertUnfilteredFullSuite(config, suite)
        : Promise.resolve();
    this.fullSuiteCheck.catch(() => {});
  }

  async preserveFailureEvidence(userId) {
    const evidenceDir = path.join(this.failureEvidenceRoot, runId);
    await fs.mkdir(evidenceDir, { recursive: true });
    const runtimeDir = WORKSPACE_LAYOUT.RUNTIME_DIR;
    await fs.cp(
      path.join(workspaceRoot(), userId, runtimeDir),
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
    await fs.cp(registryPath, path.join(evidenceDir, path.basename(registryPath)));
  }

  async onEnd(result) {
    await this.fullSuiteCheck;
    const allRecords = await readRegistry();
    const records = allRecords.filter(
      (record) =>
        record?.source === REGISTRY_SOURCE &&
        record?.runId === runId &&
        String(record?.userId || "").trim() &&
        String(record?.sessionId || "").trim(),
    );
    if (process.env.NOOBOT_E2E_FULL_SUITE !== "1") return;
    const credentials = readE2eCredentials();
    if (result.status !== "passed") {
      if (records.length > 0) await this.preserveFailureEvidence(credentials.userId);
      return;
    }
    await fs.rm(this.failureEvidenceRoot, { recursive: true, force: true });
    await fs.rm(path.join(workspaceRoot(), credentials.userId, runOpsWorkdir()), {
      recursive: true,
      force: true,
    });
    if (records.length === 0) return;
    if (records.some((record) => record.userId !== credentials.userId)) {
      throw new Error("Suite Session cleanup requires credentials for every registered owner");
    }
    const topology = resolveRuntimeTopology(process.env);
    const defaultBaseUrl = `http://${topology.loopbackHost}:${addressPort(topology.clientAddr)}`;
    const baseURL = String(process.env.NOOBOT_E2E_BASE_URL || defaultBaseUrl).replace(/\/$/, "");
    const context = await playwrightRequest.newContext({ baseURL });
    const reclaimed = new Set();
    try {
      const apiKey = await connectForCleanup(context, credentials);
      for (const record of records) {
        const userId = String(record?.userId || "").trim();
        await deleteSessionWithAdmissionRetry(context, {
          userId,
          sessionId: record.sessionId,
          apiKey,
        });
        reclaimed.add(registryRecordKey(record));
      }
    } finally {
      await context.dispose();
      await retireRegistryRecords(reclaimed);
    }
  }
}
