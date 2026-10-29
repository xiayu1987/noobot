/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireCanonicalTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";
import { readSessionForProtocolRepair } from "@noobot/session-repair";
import { buildSessionArtifactFileMap } from "../session-artifact-files.js";
import { readOptionalJsonWithStorage } from "./artifact-json-io.js";
import {
  TURN_JOURNAL_SCHEMA_VERSION,
  assertCanonicalSessionManifest,
  turnArtifactRequiresRewrite,
} from "./turn-journal-store.js";
import { turnMaterializer } from "./turn-materializer.js";

async function readCanonicalManifest({ storageService, sessionDir }) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readOptionalJsonWithStorage({
    storageService,
    artifactPath: files.session,
  });
  if (session === null) return null;
  return assertCanonicalSessionManifest(session, "Session artifact");
}

async function materializeOrderedMessages({ storageService, sessionDir, turnItems, references }) {
  const messagesByUid = new Map();
  for (const item of turnItems) {
    for (const message of await turnMaterializer.materialize({ storageService, sessionDir, item }))
      messagesByUid.set(message.messageUid, message);
  }
  return references.map(({ messageUid }) => messagesByUid.get(messageUid));
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
      references: session.messageOrder,
    }),
  };
}

export async function readSessionTurnView({ storageService, sessionDir, turnScopeIds }) {
  const session = await readCanonicalManifest({ storageService, sessionDir });
  if (!session) return null;
  const scopes = new Set(turnScopeIds.map(requireCanonicalTurnScopeId));
  const lastMessageUid = session.messageOrder.length ? session.messageOrder.at(-1).messageUid : "";
  const turnItems = session.turnOrder.filter(
    (item) =>
      scopes.has(item.turnScopeId) ||
      (lastMessageUid && item.messageOrder.includes(lastMessageUid)) ||
      turnArtifactRequiresRewrite(session, item),
  );
  const viewMessageUids = new Set(turnItems.flatMap((item) => item.messageOrder));
  return {
    session: {
      ...session,
      messages: await materializeOrderedMessages({
        storageService,
        sessionDir,
        turnItems,
        references: session.messageOrder.filter((reference) =>
          viewMessageUids.has(reference.messageUid),
        ),
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
