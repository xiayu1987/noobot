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

for (const userId of ["admin", "user"]) {
  for (const bindingName of ["user_read", "invalid.name"]) {
    test(`connect exposes effective tool bindings for ${userId}: ${bindingName}`, async () => {
      const app = express();
      app.use(express.json());
      registerAuthRoutes(app, {
        workspaceService: { ensureUserWorkspace: async () => {} },
        connectorRuntime: { unlockUser: async () => {} },
        loadUserConfigForUser: async () => ({
          tools: { bindings: { read_file: { bindingName } } },
        }),
        globalConfigProvider: () => ({
          superAdmin: { userId: "admin", connectCode: "test-code" },
          tools: {
            bindings: {
              read_file: { bindingName: "global_read" },
              help: { bindingName: "global_help" },
            },
          },
        }),
        readWorkspaceUsers: async () => [{ userId: "user", connectCode: "test-code" }],
        issueApiKey: () => "test-key",
        requireApiKey: (_req, _res, next) => next(),
        requireSuperAdmin: (_req, _res, next) => next(),
        translateText: (key) => key,
      });
      await withTestServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/internal/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, connectCode: "test-code" }),
        });
        const payload = await response.json();
        assert.equal(response.status, 200);
        assert.deepEqual(payload.toolNameBindings, {
          read_file: { bindingName },
          help: { bindingName: "global_help" },
        });
      });
    });
  }
}
