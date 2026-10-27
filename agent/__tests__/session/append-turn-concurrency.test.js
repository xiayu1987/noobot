/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createSessionFacade } from "../../src/session/index.js";
import { createTestSessionServices, provisionTestSession } from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";

const USER_ID = "u1";
const SESSION_ID = "s-concurrency";
const TURN = Object.freeze({ dialogProcessId: "dp-1", turnScopeId: "client-turn:t1" });

test("appendTurns from continuations spawned inside a session lock keeps every message", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-append-concurrency-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeUserWorkspace(root, USER_ID);
  const runtime = createTestSessionServices({ workspaceRoot: root });
  await provisionTestSession(runtime, {
    userId: USER_ID,
    sessionId: SESSION_ID,
    caller: SESSION_CALLER.USER,
  });
  const repo = runtime.repositories.sessionRepository;
  const facade = createSessionFacade(runtime);
  const append = (messageUid) =>
    facade.appendTurns({
      userId: USER_ID,
      sessionId: SESSION_ID,
      persistenceScope: null,
      turns: [{ ...TURN, role: "user", messageOrigin: "natural", messageUid, content: messageUid }],
    });
  await append("sm_seed");

  const concurrentUids = Array.from({ length: 6 }, (_, index) => `sm_c${index}`);
  let spawned;
  await repo.withSessionMutation(
    USER_ID,
    SESSION_ID,
    async () => {
      spawned = new Promise((resolve) => setTimeout(resolve, 30)).then(() =>
        Promise.all(concurrentUids.map(append)),
      );
    },
    { persistenceContext: repo.treePersistenceContext(USER_ID, SESSION_ID) },
  );
  const results = await spawned;
  assert.deepEqual(
    results.map((result) => result.appended),
    concurrentUids.map(() => true),
  );

  const manifest = JSON.parse(
    await readFile(
      path.join(root, USER_ID, "runtime", "session", SESSION_ID, "session.json"),
      "utf8",
    ),
  );
  const durableUids = new Set(manifest.messageOrder.map((entry) => entry.messageUid));
  assert.deepEqual(
    concurrentUids.filter((uid) => !durableUids.has(uid)),
    [],
    "every reported append must be in the committed messageOrder",
  );
});
