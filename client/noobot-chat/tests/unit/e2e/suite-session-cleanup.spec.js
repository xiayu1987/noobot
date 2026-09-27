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

it("authenticates cleanup after a restart without persisting session credentials", async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-cleanup-"));
  const registry = path.join(directory, "sessions.json");
  vi.stubEnv("NOOBOT_E2E_SESSION_REGISTRY", registry);
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
  await registerSuiteSession({ userId: "owner", sessionId: "session-1", apiKey: "expired-key" });
  const records = JSON.parse(await fs.readFile(registry, "utf8"));
  expect(records[0]).not.toHaveProperty("apiKey");
  await new Reporter().onEnd({ status: "failed" });
  expect(context.post).not.toHaveBeenCalled();
  await new Reporter().onEnd({ status: "passed" });
  expect(context.post).toHaveBeenCalledWith("/api/internal/connect", {
    data: { userId: "owner", connectCode: "test-code" },
  });
  expect(context.delete).toHaveBeenCalledWith("/api/internal/session/owner/session-1", {
    headers: { "x-api-key": "fresh-key" },
  });
  expect(context.dispose).toHaveBeenCalledOnce();
  await expect(fs.access(registry)).rejects.toMatchObject({ code: "ENOENT" });
});
