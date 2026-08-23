/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineConfig, devices } from "@playwright/test";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { fileURLToPath } from "node:url";
import { validateModelObservationPolicyCoverage } from "./helpers/model-observation-policy.js";

const protocolRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(protocolRoot, "../../../../..");
const suiteSessionRegistry = path.join(repositoryRoot, "test-results/protocol/suite-sessions.json");
process.env.NOOBOT_E2E_SESSION_REGISTRY = suiteSessionRegistry;
const e2eWorkspaceRoot = String(process.env.NOOBOT_E2E_WORKSPACE_ROOT || "").trim();
const runtimeEventsWorkspaceRoot = String(process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT || "").trim();
const workspaceRoot = String(process.env.NOOBOT_WORKSPACE_ROOT || "").trim();
const configuredWorkspaceRoots = [workspaceRoot, e2eWorkspaceRoot, runtimeEventsWorkspaceRoot].filter(Boolean);

function resolveBaseUrl(value) {
  const raw = String(value || "").trim();
  const candidate = raw || "http://127.0.0.1:10060";
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("NOOBOT_E2E_BASE_URL must be an absolute HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("NOOBOT_E2E_BASE_URL must be an absolute HTTP(S) URL");
  }
  return parsed.toString().replace(/\/$/, "");
}

validateModelObservationPolicyCoverage(path.join(protocolRoot, "specs"));

if (configuredWorkspaceRoots.some((value) => !path.isAbsolute(value))) {
  throw new Error("configured Noobot workspace roots must be absolute paths");
}
if (new Set(configuredWorkspaceRoots).size > 1) {
  throw new Error(
    "NOOBOT_WORKSPACE_ROOT, NOOBOT_E2E_WORKSPACE_ROOT and "
      + "NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT must identify the same workspace",
  );
}

export default defineConfig({
  testDir: path.join(protocolRoot, "specs"),
  outputDir: path.join(repositoryRoot, "test-results/protocol/raw"),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 420000,
  expect: { timeout: 15000 },
  reporter: [["line"], [path.join(protocolRoot, "suite-session-cleanup.js")], ["html", {
    open: "never",
    outputFolder: path.join(repositoryRoot, "test-results/protocol/report"),
  }]],
  use: {
    baseURL: resolveBaseUrl(process.env.NOOBOT_E2E_BASE_URL),
    actionTimeout: 15000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{
    name: "chromium-protocol",
    use: {
      ...devices["Desktop Chrome"],
      // The managed Linux runner disallows Chromium's sandbox host. Keep the
      // browser test itself enabled and explicitly select Playwright's
      // supported no-sandbox launch mode for this environment.
      launchOptions: { chromiumSandbox: false },
    },
  }],
});
