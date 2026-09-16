/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerWorkspaceRoutes } from "../../routes/workspace-routes.js";
import { withTestServer } from "./session-routes.helpers.js";

test("workspace config declarations expose only user-visible provider metadata", async () => {
  const app = express();
  registerWorkspaceRoutes(app, {
    workspaceService: {},
    workspaceRootPath: () => "",
    requireApiKey: (_req, _res, next) => next(),
    requireSuperAdmin: (_req, _res, next) => next(),
    globalConfig: {
      workspace_root: "/private/workspace",
      providers: {
        primary: {
          api_key: "secret",
          model: "private-model",
          reasoning_effort_options: ["none", "high"],
          use_responses_api: true,
        },
      },
    },
    translateText: (key) => key,
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/workspace/alice/config-declarations`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      declarations: {
        providers: { primary: { reasoning_effort_options: ["none", "high"] } },
      },
    });
  });
});
