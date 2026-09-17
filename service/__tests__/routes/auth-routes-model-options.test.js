/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { registerAuthRoutes } from "../../routes/auth-routes.js";
import { withTestServer } from "./session-routes.helpers.js";

test("connect exposes a case-sensitive custom provider after rejecting system field overrides", async () => {
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app, {
    workspaceService: { ensureUserWorkspace: async () => {} },
    loadUserConfigForUser: async () => ({
      providers: {
        "GLM_5_3": {
          enabled: true,
          used_for_conversation: true,
          model: "ZHIPU/GLM-5.3",
          name: "GLM 5.3",
          description: "forged user description",
          reasoning_effort: "medium",
          tool_reasoning_effort: "medium",
          reasoning_effort_options: ["forged"],
          reasoning_effort_parameter: "enable_thinking",
          use_responses_api: true,
        },
      },
    }),
    globalConfigProvider: () => ({
      superAdmin: { userId: "admin", connectCode: "admin-code" },
      providers: {},
      scenarios: {},
    }),
    issueApiKey: () => "test-api-key",
    readWorkspaceUsers: async () => [],
    readWorkspaceUsersConfig: async () => ({ users: [] }),
    writeWorkspaceUsersConfig: async (value) => value,
    normalizeWorkspaceUsersConfig: (value) => value,
    requireApiKey: (_req, _res, next) => next(),
    requireSuperAdmin: (_req, _res, next) => next(),
    connectorRuntime: { unlockUser: async () => {} },
    translateText: (key) => key,
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "admin", connectCode: "admin-code" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.deepEqual(
      payload.enabledModels.find((item) => item.value === "GLM_5_3"),
      {
        value: "GLM_5_3",
        alias: "GLM_5_3",
        key: "GLM_5_3",
        label: "GLM_5_3",
        name: "GLM_5_3",
        model: "ZHIPU/GLM-5.3",
        description: "forged user description",
      },
    );
    assert.equal(payload.enabledModels.some((item) => item.value === "glm_5_3"), false);
  });
});
