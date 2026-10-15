/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { addressPort, resolveRuntimeTopology } from "@noobot/runtime-topology-protocol/ports";
import { requireWorkspaceRootEnv } from "@noobot/runtime-topology-protocol/workspace-root";
import { validateModelObservationPolicyCoverage } from "./helpers/model-observation-policy.js";
import { PROTOCOL_TIMEOUTS } from "./helpers/protocol-timeouts.js";
import { text } from "@noobot/shared/value";

const protocolRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(protocolRoot, "../../../../..");
const failureEvidenceRoot = path.join(repositoryRoot, "test-results/e2e-evidence");
process.env.NOOBOT_E2E_RUN_ID = text(process.env.NOOBOT_E2E_RUN_ID) || randomUUID();

function resolveBaseUrl(value) {
  const raw = text(value);
  const topology = resolveRuntimeTopology(process.env);
  const candidate = raw || `http://${topology.loopbackHost}:${addressPort(topology.clientAddr)}`;
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

requireWorkspaceRootEnv();

export default defineConfig({
  testDir: path.join(protocolRoot, "specs"),
  testMatch: /\.spec\.js$/,
  outputDir: path.join(repositoryRoot, "test-results/protocol/raw"),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: PROTOCOL_TIMEOUTS.model,
  expect: { timeout: 15000 },
  reporter: [
    ["line"],
    [path.join(protocolRoot, "suite-session-cleanup.js"), { failureEvidenceRoot }],
    [
      "html",
      {
        open: "never",
        outputFolder: path.join(repositoryRoot, "test-results/protocol/report"),
      },
    ],
  ],
  use: {
    baseURL: resolveBaseUrl(process.env.NOOBOT_E2E_BASE_URL),
    actionTimeout: 15000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-protocol",
      use: {
        ...devices["Desktop Chrome"],

        launchOptions: { chromiumSandbox: false },
      },
    },
  ],
});
