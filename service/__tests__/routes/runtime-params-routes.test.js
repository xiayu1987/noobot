/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { RUNTIME_PARAMS_API } from "@noobot/shared/runtime-params";
import { createAuthService } from "../../services/auth-service.js";
import { registerRuntimeParamsRoutes } from "../../routes/runtime-params-routes.js";

test("runtime parameter HTTP API enforces real authentication, authorization, validation and revisions", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-params-api-"));
  const app = express();
  app.use(express.json());
  const auth = createAuthService({ translateText: (key) => key });
  const admin = auth.issueApiKey({ userId: "admin", role: "super_admin" });
  const user = auth.issueApiKey({ userId: "ordinary", role: "user" });
  registerRuntimeParamsRoutes(app, { ...auth, workspaceRootPath: () => root });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    fs.rmSync(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}${RUNTIME_PARAMS_API}`;
  const request = (token, method = "GET", body) =>
    fetch(url, {
      method,
      headers: { ...(token ? { "x-api-key": token } : {}), "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await request(null)).status, 401);
  assert.equal((await request(user)).status, 403);
  assert.equal((await request(user, "PUT", { revision: 0, overrides: {} })).status, 403);
  assert.equal((await request(admin)).status, 200);
  const invalid = await request(admin, "PUT", {
    revision: 0,
    overrides: { "quantity.memory.maxItems": -1 },
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(fs.readdirSync(root), []);
  const updates = await Promise.all(
    [41, 42].map((value) =>
      request(admin, "PUT", {
        revision: 0,
        overrides: { "quantity.memory.maxItems": value },
      }),
    ),
  );
  assert.deepEqual(updates.map((result) => result.status).sort(), [200, 409]);
  const state = await (await request(admin)).json();
  assert.equal(state.revision, 1);
  assert.equal(state.activeRevision, 0);
  assert.equal(state.restartRequired, true);
  assert.equal(state.lastChange.actor, "admin");
});
