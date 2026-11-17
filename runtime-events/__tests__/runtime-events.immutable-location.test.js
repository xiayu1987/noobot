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
import { resolveWorkspaceSessionLocation } from "../src/session-location.js";
import {
  encodeImmutableSessionHead,
  decodeImmutableSessionHead,
} from "@noobot/session-protocol/immutable-storage";
import { persistSession, tempRoot } from "./runtime-events-test-fixtures.js";

test("runtime event location requires the registered immutable head and rejects legacy or foreign authority", async () => {
  const workspaceRoot = await tempRoot();
  const sessionId = "immutable-session";
  const sessionDir = await persistSession(workspaceRoot, "admin", {
    sessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const location = { workspaceRoot, userId: "admin", sessionId };
  assert.deepEqual(await resolveWorkspaceSessionLocation(location), { sessionDir });
  await assert.rejects(fs.access(path.join(sessionDir, "session.json")), { code: "ENOENT" });
  const file = path.join(sessionDir, "head.json");
  const original = await fs.readFile(file, "utf8");
  await fs.writeFile(
    file,
    encodeImmutableSessionHead({ ...decodeImmutableSessionHead(original), sessionId: "foreign" }),
  );
  await assert.rejects(resolveWorkspaceSessionLocation(location), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await fs.writeFile(file, original.replace(sessionId, "corrupt"));
  await assert.rejects(resolveWorkspaceSessionLocation(location), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await fs.rm(file);
  await fs.writeFile(path.join(sessionDir, "session.json"), JSON.stringify({ sessionId }));
  await assert.rejects(resolveWorkspaceSessionLocation(location), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});
