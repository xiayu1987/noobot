/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import os from "node:os";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { afterEach, expect, it, vi } from "vitest";

const { newContext } = vi.hoisted(() => ({ newContext: vi.fn() }));
vi.mock("@playwright/test", () => ({ request: { newContext }, expect: vi.fn() }));
let directory;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

async function setupSuite() {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-cleanup-"));
  const runRegistry = (runId) =>
    path.join(directory, "owner", "runtime", "ops_workdir", `e2e-${runId}`, "suite-sessions.json");
  const evidenceRoot = path.join(directory, "evidence");
  const outputDir = path.join(directory, "raw");
  const testDir = path.join(directory, "specs");
  const specFile = path.join(testDir, "001-a.spec.js");
  await fs.mkdir(testDir, { recursive: true });
  await fs.writeFile(specFile, "");
  await fs.writeFile(path.join(testDir, "README.md"), "");
  vi.stubEnv("NOOBOT_WORKSPACE_ROOT", directory);
  vi.stubEnv("NOOBOT_E2E_RUN_ID", "current-run");
  vi.stubEnv("NOOBOT_E2E_USER_ID", "owner");
  vi.stubEnv("NOOBOT_E2E_CONNECT_CODE", "test-code");
  vi.stubEnv("NOOBOT_E2E_FULL_SUITE", "1");
  const response = (payload) => ({ ok: () => true, json: async () => payload });
  const context = {
    post: vi.fn().mockResolvedValue(response({ ok: true, apiKey: "fresh-key" })),
    delete: vi.fn().mockResolvedValue(response({ ok: true })),
    dispose: vi.fn(),
  };
  newContext.mockResolvedValue(context);
  const { default: Reporter, registerSuiteSession } =
    await import("../../e2e/protocol/suite-session-cleanup.js");
  const project = { outputDir, testDir, testMatch: /\.spec\.js$/, grep: /.*/, grepInvert: null };
  const createReporter = (overrides = {}) => {
    const reporter = new Reporter({ failureEvidenceRoot: evidenceRoot });
    const config = { grep: /.*/, grepInvert: null, shard: null, projects: [project], ...overrides };
    const suite = { allTests: () => (overrides.selectedFiles ?? [specFile]).map(fileTest) };
    reporter.onBegin(config, suite);
    return reporter;
  };
  await fs.mkdir(path.join(directory, "owner", "runtime", "session", "session-1"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(directory, "owner", "runtime", "session", "session-1", "s.json"),
    "{}",
  );
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "trace.zip"), "trace");
  return { runRegistry, evidenceRoot, context, createReporter, registerSuiteSession };
}

const fileTest = (file) => ({ location: { file } });

it("requires an absolute failure evidence root", async () => {
  const { default: Reporter } = await import("../../e2e/protocol/suite-session-cleanup.js");
  expect(() => new Reporter()).toThrow(/failureEvidenceRoot/);
});

it("rejects filtered full suite runs before touching evidence or sessions", async () => {
  const { evidenceRoot, context, createReporter, registerSuiteSession } = await setupSuite();
  await registerSuiteSession({ userId: "owner", sessionId: "session-1" });
  await expect(createReporter({ grep: /@smoke/ }).onEnd({ status: "failed" })).rejects.toThrow(
    /must not filter/,
  );
  await expect(createReporter({ selectedFiles: [] }).onEnd({ status: "passed" })).rejects.toThrow(
    /every spec file/,
  );
  await expect(fs.access(evidenceRoot)).rejects.toMatchObject({ code: "ENOENT" });
  expect(context.post).not.toHaveBeenCalled();
});

it("preserves failure evidence and deletes it once the full suite passes", async () => {
  const { runRegistry, evidenceRoot, context, createReporter, registerSuiteSession } =
    await setupSuite();
  await registerSuiteSession({ userId: "owner", sessionId: "session-1", apiKey: "expired-key" });
  const records = JSON.parse(await fs.readFile(runRegistry("current-run"), "utf8"));
  expect(records).toEqual([{ userId: "owner", sessionId: "session-1" }]);
  await createReporter().onEnd({ status: "failed" });
  expect(context.post).not.toHaveBeenCalled();
  const evidenceDir = path.join(evidenceRoot, "current-run");
  await expect(
    fs.readFile(path.join(evidenceDir, "runtime", "session", "session-1", "s.json"), "utf8"),
  ).resolves.toBe("{}");
  await expect(fs.readFile(path.join(evidenceDir, "raw", "trace.zip"), "utf8")).resolves.toBe(
    "trace",
  );
  await expect(
    fs.readFile(
      path.join(evidenceDir, "runtime", "ops_workdir", "e2e-current-run", "suite-sessions.json"),
      "utf8",
    ),
  ).resolves.toContain("session-1");
  await createReporter().onEnd({ status: "passed" });
  expect(context.post).toHaveBeenCalledWith("/api/internal/connect", {
    data: { userId: "owner", connectCode: "test-code" },
  });
  expect(context.delete).toHaveBeenCalledWith("/api/internal/session/owner/session-1", {
    headers: { "x-api-key": "fresh-key" },
  });
  expect(context.dispose).toHaveBeenCalledOnce();
  await expect(fs.access(runRegistry("current-run"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(fs.access(evidenceRoot)).rejects.toMatchObject({ code: "ENOENT" });
});

it("scopes the registry to its run so a later run never reclaims earlier records", async () => {
  const { runRegistry, context, createReporter, registerSuiteSession } = await setupSuite();
  await registerSuiteSession({ userId: "owner", sessionId: "session-1" });
  await createReporter().onEnd({ status: "failed" });
  vi.stubEnv("NOOBOT_E2E_RUN_ID", "next-run");
  await registerSuiteSession({ userId: "owner", sessionId: "session-2" });
  await createReporter().onEnd({ status: "passed" });
  expect(context.delete).toHaveBeenCalledOnce();
  expect(context.delete).toHaveBeenCalledWith("/api/internal/session/owner/session-2", {
    headers: { "x-api-key": "fresh-key" },
  });
  await expect(fs.access(runRegistry("next-run"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(fs.readFile(runRegistry("current-run"), "utf8")).resolves.toContain("session-1");
});
