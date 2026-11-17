/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { writeRuntimeEvent } from "../src/index.js";
import { resolveWorkspaceSessionLocation } from "../src/session-location.js";
import { persistSession, tempRoot, markSessionDeleted } from "./runtime-events-test-fixtures.js";

async function fixture(t) {
  const workspaceRoot = await tempRoot();
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const sessionId = "location-port";
  const sessionDir = await persistSession(workspaceRoot, "admin", {
    sessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  return { workspaceRoot, userId: "admin", sessionId, sessionDir };
}

test("location port binds identity, writes the selected directory and never falls back", async (t) => {
  const { sessionDir, ...request } = await fixture(t);
  const selected = path.join(request.workspaceRoot, "admin/runtime/plugin-data/test/session");
  await fs.mkdir(path.dirname(selected), { recursive: true });
  await fs.rename(sessionDir, selected);
  const locationResolver = {
    async locateSessionScope(userId, sessionId) {
      assert.equal(userId, request.userId);
      assert.equal(sessionId, request.sessionId);
      return { sessionDir: selected };
    },
  };
  const result = await writeRuntimeEvent(
    {
      scope: "session",
      userId: request.userId,
      sessionId: request.sessionId,
      source: "agent",
      category: "system",
      event: "scoped.test",
    },
    { locationResolver },
  );
  assert.equal(result.ok, true);
  assert.equal(result.file, path.join(selected, "events/system.jsonl"));
  await assert.rejects(fs.access(sessionDir), { code: "ENOENT" });
  const failure = new Error("bound identity mismatch");
  await assert.rejects(
    resolveWorkspaceSessionLocation({
      ...request,
      locationResolver: {
        locateSessionScope() {
          throw failure;
        },
      },
    }),
    (error) => error === failure,
  );
  assert.deepEqual(
    await resolveWorkspaceSessionLocation({
      ...request,
      locationResolver: { locateSessionScope: async () => null },
    }),
    { missingSession: true },
  );
  await fs.writeFile(path.join(selected, "head.json"), "invalid");
  await assert.rejects(resolveWorkspaceSessionLocation({ ...request, locationResolver }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("location port rejects malformed or foreign paths and observes deletion before lookup", async (t) => {
  const { sessionDir, ...request } = await fixture(t);
  for (const target of [
    "relative",
    request.workspaceRoot,
    path.join(request.workspaceRoot, "other/session"),
  ]) {
    await assert.rejects(
      resolveWorkspaceSessionLocation({
        ...request,
        locationResolver: { locateSessionScope: async () => ({ sessionDir: target }) },
      }),
      TypeError,
    );
  }
  await assert.rejects(
    resolveWorkspaceSessionLocation({ ...request, locationResolver: {} }),
    TypeError,
  );
  await markSessionDeleted(request.workspaceRoot, request.userId, request.sessionId);
  assert.deepEqual(
    await resolveWorkspaceSessionLocation({
      ...request,
      locationResolver: {
        locateSessionScope() {
          assert.fail("deleted session must not resolve");
        },
      },
    }),
    { deleted: true },
  );
  assert.ok(await fs.stat(path.join(sessionDir, "head.json")));
});
