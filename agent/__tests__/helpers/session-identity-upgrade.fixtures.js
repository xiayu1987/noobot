/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { MESSAGE_ORIGIN } from "@noobot/session-protocol";
import { TEST_SCOPED_SESSION_ROOTS } from "./scoped-session-roots.js";
import { TEST_STORAGE_SERVICE } from "./storage-service.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "./session-message-facts.js";

export const SESSION_ID = "s-v9";
export const jsonl = (records) => records.map((record) => `${JSON.stringify(record)}\n`).join("");

export async function saveCanonicalSession(sessionRepo) {
  const persistenceContext = sessionRepo.treePersistenceContext("alice", SESSION_ID);
  const message = (messageUid, role, extra) => ({
    sessionId: SESSION_ID,
    messageUid,
    role,
    content: messageUid,
    dialogProcessId: "d1",
    turnScopeId: "t1",
    ts: `2026-01-01T00:00:0${messageUid.at(-1)}.000Z`,
    ...extra,
  });
  await sessionRepo.save(
    "alice",
    applySessionMessageFacts({
      ...createTestSessionRequiredFields(),
      parentSessionId: "",
      sessionId: SESSION_ID,
      aggregateVersion: 0,
      messages: [
        message("m1", "user", { messageOrigin: MESSAGE_ORIGIN.NATURAL }),
        message("m2", "assistant", { modelMessageId: "mm_m2", presentationMessageId: "pm_1" }),
      ],
    }),
    { createOnly: true, persistenceContext },
  );
  const scope = await sessionRepo.requireSessionScope("alice", SESSION_ID, persistenceContext);
  return scope.sessionDir;
}

export function v9Options(root) {
  return {
    base: path.join(root, "alice"),
    backupBase: path.join(root, "layout-backup"),
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
    storageService: TEST_STORAGE_SERVICE,
  };
}
