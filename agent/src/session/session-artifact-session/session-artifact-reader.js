/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  requireSessionTurnViewSelection,
  SESSION_ARTIFACT_STORAGE_JOURNAL_SCHEMA_VERSION,
} from "@noobot/session-protocol";
import { readSessionForProtocolRepair } from "@noobot/session-repair";
import { buildSessionArtifactFileMap } from "../session-artifact-files.js";
import { readOptionalJsonWithStorage } from "./artifact-json-io.js";
import {
  readCheckpointReceiptProjection,
  readCheckpointReceiptReferences,
} from "./checkpoint-receipts.js";
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
  return session;
}

async function materializeTurnEntries({ storageService, sessionDir, turnItems }) {
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
  return entries;
}

function orderMessages(entries) {
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
  const manifest = await readCanonicalManifest({ storageService, sessionDir });
  if (!manifest) return null;
  return materializeManifest({ storageService, sessionDir, manifest });
}

async function materializeManifest({ storageService, sessionDir, manifest }) {
  const session = await readCheckpointReceiptProjection({
    storageService,
    sessionDir,
    session: manifest,
  });
  return {
    ...session,
    messages: orderMessages(
      await materializeTurnEntries({
        storageService,
        sessionDir,
        turnItems: session.turnOrder,
      }),
    ),
  };
}

async function expandReferencedTurns({
  storageService,
  sessionDir,
  turnOrder,
  turnItems,
  entries,
  messageUids,
}) {
  const unresolved = new Set(messageUids);
  for (const { message } of entries) unresolved.delete(message.messageUid);
  const selected = new Set(turnItems);
  for (const item of turnOrder) {
    if (!unresolved.size) break;
    if (selected.has(item)) continue;
    const options = { storageService, sessionDir, item };
    const uids = await getTurnMaterializer().materializeMessageUids(options);
    if (!uids.some((uid) => unresolved.has(uid))) continue;
    turnItems.push(item);
    entries.push(...(await getTurnMaterializer().materializeEntries(options)));
    for (const uid of uids) unresolved.delete(uid);
  }
}

export async function readSessionTurnView({
  storageService,
  sessionDir,
  turnScopeIds,
  messageUids,
}) {
  const selection = requireSessionTurnViewSelection({ turnScopeIds, messageUids });
  const manifest = await readCanonicalManifest({ storageService, sessionDir });
  if (!manifest) return null;
  const session = await readCheckpointReceiptReferences({
    storageService,
    sessionDir,
    session: manifest,
  });
  const scopes = new Set(selection.turnScopeIds);
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
  const entries = await materializeTurnEntries({ storageService, sessionDir, turnItems });
  await expandReferencedTurns({
    storageService,
    sessionDir,
    turnOrder: session.turnOrder,
    turnItems,
    entries,
    messageUids: selection.messageUids,
  });
  return {
    session: {
      ...session,
      messages: orderMessages(entries),
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
  if (
    session.schemaVersion >= SESSION_ARTIFACT_STORAGE_JOURNAL_SCHEMA_VERSION &&
    session.schemaVersion <= TURN_JOURNAL_SCHEMA_VERSION
  ) {
    assertCanonicalSessionManifest(
      { ...session, schemaVersion: TURN_JOURNAL_SCHEMA_VERSION },
      "Session repair artifact",
    );
    session.sessionArtifactEvents = await readSessionArtifactEvents(sessionDir, session);
    return materializeManifest({ storageService, sessionDir, manifest: session });
  }
  return readSessionForProtocolRepair({ sessionDir, session });
}
