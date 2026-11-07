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
import { BUILTIN_TOOL_IDS } from "noobot-agent/tools";

for (const bindings of [{}, { nb_read_file: { bindingName: "invalid.name" } }]) {
  test(`workspace config declarations preserve bindings ${JSON.stringify(bindings)} without exposing credentials`, async () => {
    const app = express();
    registerWorkspaceRoutes(app, {
      workspaceService: {},
      workspaceRootPath: () => "",
      requireApiKey: (_req, _res, next) => next(),
      requireSuperAdmin: (_req, _res, next) => next(),
      globalConfig: {
        workspace_root: "/private/workspace",
        tools: { bindings },
        providers: {
          primary: {
            api_key: "secret",
            base_url: "https://private.example.test/v1",
            model: "private-model",
            reasoning_effort_options: ["none", "high"],
            multimodal_parsing: { enabled: true, input_modalities: ["image", "video"] },
            multimodal_generation: {
              support_generation: { enabled: true, support_scope: ["image"] },
            },
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
          providers: {
            primary: {
              reasoning_effort_options: ["none", "high"],
              multimodal_parsing: { enabled: true, input_modalities: ["image", "video"] },
              multimodal_generation: {
                support_generation: { enabled: true, support_scope: ["image"] },
              },
            },
          },
          toolBindings: { toolIds: [...BUILTIN_TOOL_IDS], bindings },
        },
      });
    });
  });
}
