/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionArtifactNotFoundError } from "@noobot/session-protocol";
import { buildSessionArtifactFileMap } from "../session-artifact-files.js";
import { readOptionalJsonWithStorage } from "./artifact-json-io.js";
import { assertCanonicalSessionManifest } from "./turn-journal-store.js";
import { turnMaterializer } from "./turn-materializer.js";
import {
  matchesTurnLookupKey,
  requireTurnLookupKey,
} from "@noobot/session-protocol/turn-lookup-key";

async function materializeTurn({ storageService, sessionDir, item }) {
  return {
    turnId: item.turnId,
    artifactOrdinal: item.artifactOrdinal,
    committedBytes: item.committedBytes,
    turnScopeId: item.turnScopeId,
    dialogProcessId: item.dialogProcessId,
    messages: await turnMaterializer.materialize({ storageService, sessionDir, item }),
    summarySnapshots: item.summarySnapshots,
  };
}

async function readCanonicalManifest({ storageService, sessionDir, label }) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readOptionalJsonWithStorage({
    storageService,
    artifactPath: files.session,
  });
  if (session === null) throw createSessionArtifactNotFoundError(`${label} manifest`);
  assertCanonicalSessionManifest(session, label);
  return session;
}

export async function readRecentSessionTurns({ storageService, sessionDir, limit }) {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new TypeError("recent Session turns limit must be a non-negative integer");
  }
  const session = await readCanonicalManifest({
    storageService,
    sessionDir,
    label: "recent Session turns",
  });
  const turns = [];
  for (const item of session.turnOrder.slice(Math.max(0, session.turnOrder.length - limit))) {
    turns.push(await materializeTurn({ storageService, sessionDir, item }));
  }
  return turns;
}

export async function readSessionTurn({
  storageService,
  sessionDir,
  turnScopeId,
  dialogProcessId,
}) {
  const lookupKey = requireTurnLookupKey({ turnScopeId, dialogProcessId });
  const session = await readCanonicalManifest({
    storageService,
    sessionDir,
    label: "session turn lookup",
  });
  const turn = session.turnOrder.find((item) => matchesTurnLookupKey(item, lookupKey));
  if (!turn) return null;
  return {
    sessionId: session.sessionId,
    ...(await materializeTurn({ storageService, sessionDir, item: turn })),
  };
}
