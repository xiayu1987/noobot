/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireCanonicalTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";
import { readSessionForProtocolRepair } from "@noobot/session-repair";
import { buildSessionArtifactFileMap } from "../session-artifact-files.js";
import { readOptionalJsonWithStorage } from "./artifact-json-io.js";
import { readCheckpointReceiptProjection } from "./checkpoint-receipts.js";
import { readSessionArtifactEvents } from "./artifact-event-journal.js";
import {
  TURN_JOURNAL_SCHEMA_VERSION,
  assertCanonicalSessionManifest,
  turnArtifactRequiresRewrite,
} from "./turn-journal-store.js";
import { getTurnMaterializer } from "./turn-materializer.js";

async function readCanonicalManifest({ storageService, sessionDir }) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readOptionalJsonWithStorage({
    storageService,
    artifactPath: files.session,
  });
  if (session === null) return null;
  assertCanonicalSessionManifest(session, "Session artifact");
  session.sessionArtifactEvents = await readSessionArtifactEvents(sessionDir, session);
  return readCheckpointReceiptProjection({ storageService, sessionDir, session });
}

async function materializeOrderedMessages({ storageService, sessionDir, turnItems }) {
  const entries = [];
  for (const item of turnItems) {
    entries.push(
      ...(await getTurnMaterializer().materializeEntries({
        storageService,
        sessionDir,
        item,
      })),
    );
  }
  const identities = new Set();
  const ordinals = new Set();
  return entries
    .sort((left, right) => left.ordinal - right.ordinal)
    .map(({ message, ordinal }) => {
      if (identities.has(message.messageUid) || ordinals.has(ordinal))
        throw new TypeError("Session journals contain duplicate message identities or ordinals");
      identities.add(message.messageUid);
      ordinals.add(ordinal);
      return message;
    });
}

export async function readSessionArtifact({ storageService, sessionDir }) {
  const session = await readCanonicalManifest({ storageService, sessionDir });
  if (!session) return null;
  return {
    ...session,
    messages: await materializeOrderedMessages({
      storageService,
      sessionDir,
      turnItems: session.turnOrder,
    }),
  };
}

export async function readSessionTurnView({ storageService, sessionDir, turnScopeIds }) {
  const session = await readCanonicalManifest({ storageService, sessionDir });
  if (!session) return null;
  const scopes = new Set(turnScopeIds.map(requireCanonicalTurnScopeId));
  const lastMessageOrdinal = Math.max(
    0,
    ...session.turnOrder.map((item) => item.lastMessageOrdinal),
  );
  const turnItems = session.turnOrder.filter(
    (item) =>
      scopes.has(item.turnScopeId) ||
      (lastMessageOrdinal > 0 && item.lastMessageOrdinal === lastMessageOrdinal) ||
      turnArtifactRequiresRewrite(session, item),
  );
  return {
    session: {
      ...session,
      messages: await materializeOrderedMessages({
        storageService,
        sessionDir,
        turnItems,
      }),
    },
    turnScopeIds: turnItems.map((item) => item.turnScopeId),
  };
}

export async function readSessionArtifactForRepair({ storageService, sessionDir }) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readOptionalJsonWithStorage({
    storageService,
    artifactPath: files.session,
  });
  if (session === null) return null;
  if (session.schemaVersion === TURN_JOURNAL_SCHEMA_VERSION) {
    return readSessionArtifact({ storageService, sessionDir });
  }
  return readSessionForProtocolRepair({ sessionDir, session });
}
