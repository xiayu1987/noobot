/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { createHttpAdmissionOptions } from "../../security/http-admission.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAuthService, USER_SCOPE_POLICY } from "../../services/auth-service.js";
import { registerAuthRoutes } from "../../routes/auth-routes.js";
import { registerFileCrudRoutes } from "../../routes/file-crud-routes.js";
import { withTestServer } from "./session-routes.helpers.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

test("resource tickets preserve Range and authorization without delegating general API access", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resource-ticket-"));
  const auth = createAuthService({ translateText: (key) => key });
  const apiKey = auth.issueApiKey({ userId: "alice", role: "user" });
  const app = express();
  app.use(rateLimit(createHttpAdmissionOptions({ resolveAuthByApiKey: auth.resolveAuthByApiKey })));
  app.use(express.json());
  registerAuthRoutes(app, { ...auth, translateText: (key) => key });
  app.use(auth.requireApiKey);
  app.param("userId", auth.createUserScopeParam(USER_SCOPE_POLICY.ADMINISTRABLE));
  registerFileCrudRoutes(app, {
    routePrefix: "/internal/workspace/:userId",
    resolveRootPath: () => root,
    buildDirectoryArchiveFile: async () => {
      throw new Error("Unexpected directory download");
    },
    translateText: (key) => key,
  });
  try {
    await writeFile(path.join(root, "clip.mp4"), "0123456789");
    await withTestServer(app, async (base) => {
      const target = "/internal/workspace/alice/preview?path=clip.mp4";
      const issue = (value, headers = { "x-api-key": apiKey }) =>
        fetch(`${base}/internal/resource-access`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ target: value }),
        });
      assert.equal((await issue(target, {})).status, 401);
      const issued = await issue(target);
      assert.equal(issued.status, 200);
      assert.equal(issued.headers.get("cache-control"), "no-store");
      const { token } = await issued.json();
      assert.ok(token);
      assert.equal(token.includes(apiKey), false);
      assert.equal(
        Buffer.from(token.split(".")[0], "base64url").toString().includes(apiKey),
        false,
      );
      const url = `${base}${target}&resourceToken=${token}`;
      const range = await fetch(url, { headers: { Range: "bytes=2-5" } });
      assert.equal(range.status, 206);
      assert.equal(await range.text(), "2345");
      assert.equal((await fetch(url, { method: "HEAD" })).status, 200);
      assert.equal((await fetch(url, { method: "PUT" })).status, 401);
      assert.equal((await fetch(url.replace("clip.mp4", "other.mp4"))).status, 401);
      assert.equal(
        (await fetch(`${base}/internal/workspace/alice/file?path=clip.mp4&resourceToken=${token}`))
          .status,
        401,
      );
      assert.equal((await fetch(`${url}x`)).status, 401);
      const forbidden = await issue("/internal/workspace/bob/preview?path=clip.mp4");
      const forbiddenTicket = (await forbidden.json()).token;
      assert.equal(
        (
          await fetch(
            `${base}/internal/workspace/bob/preview?path=clip.mp4&resourceToken=${forbiddenTicket}`,
          )
        ).status,
        403,
      );
      for (const value of [
        "https://external.invalid/file",
        "/internal/config",
        "/internal/workspace/alice/preview?path=x&apikey=secret",
        null,
      ]) {
        assert.equal((await issue(value)).status, 400);
      }
      const now = Date.now();
      t.mock.method(Date, "now", () => now + TIME_THRESHOLDS.service.resourceAccessTtlMs + 1);
      assert.equal((await fetch(url)).status, 401);
      t.mock.restoreAll();
    });
  } finally {
    t.mock.restoreAll();
    await rm(root, { recursive: true, force: true });
  }
});

test("resource tickets expire with their parent authentication session", (t) => {
  const auth = createAuthService({ translateText: (key) => key });
  const apiKey = auth.issueApiKey({ userId: "alice", role: "user" });
  const identity = auth.resolveAuthByApiKey({ headers: { "x-api-key": apiKey } });
  const target = "/internal/attachment/alice/a?sessionId=s&attachmentSource=model";
  const { token } = auth.issueResourceAccess(identity, target);
  const now = Date.now();
  t.mock.method(Date, "now", () => now + TIME_THRESHOLDS.service.apiKeyTtlMs + 1);
  assert.equal(
    auth.resolveAuthByApiKey({ method: "GET", url: `${target}&resourceToken=${token}` }),
    null,
  );
  assert.equal(auth.resolveAuthByApiKey({ headers: { "x-api-key": apiKey } }), null);
});
