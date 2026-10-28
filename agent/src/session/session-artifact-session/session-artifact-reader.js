/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { readSessionForProtocolRepair } from "@noobot/session-repair";
import { buildSessionArtifactFileMap } from "../session-artifact-files.js";
import { readJsonWithStorage } from "./artifact-json-io.js";
import {
  TURN_JOURNAL_SCHEMA_VERSION,
  assertCanonicalSessionManifest,
  turnArtifactRequiresRewrite,
} from "./turn-journal-store.js";
import { turnMaterializer } from "./turn-materializer.js";
import { text, isObjectLike } from "@noobot/shared/value";

async function readCanonicalManifest({ storageService, sessionDir }) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonWithStorage({
    storageService,
    artifactPath: files.session,
    fallback: null,
  });
  if (!isObjectLike(session)) return null;
  return assertCanonicalSessionManifest(session, "Session artifact");
}

async function materializeOrderedMessages(sessionDir, turnItems, references) {
  const messagesByUid = new Map();
  for (const item of turnItems) {
    for (const message of await turnMaterializer.materialize(sessionDir, item))
      messagesByUid.set(message.messageUid, message);
  }
  return references.map((reference) => {
    const { messageUid } = reference;
    const message = messagesByUid.get(messageUid);
    if (message) return message;
    const error = new Error(`session message order references a missing message: ${messageUid}`);
    error.code = SESSION_ERROR_CODE.MESSAGE_ORDER_MESSAGE_MISSING;
    throw error;
  });
}

export async function readSessionArtifact({ storageService = null, sessionDir = "" } = {}) {
  const session = await readCanonicalManifest({ storageService, sessionDir });
  if (!session) return null;
  return {
    ...session,
    messages: await materializeOrderedMessages(sessionDir, session.turnOrder, session.messageOrder),
  };
}

export async function readSessionTurnView({
  storageService = null,
  sessionDir = "",
  turnScopeIds = [],
} = {}) {
  const session = await readCanonicalManifest({ storageService, sessionDir });
  if (!session) return null;
  const scopes = new Set(turnScopeIds.map((turnScopeId) => text(turnScopeId)));
  const lastMessageUid = text(session.messageOrder.at(-1)?.messageUid);
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
      messages: await materializeOrderedMessages(
        sessionDir,
        turnItems,
        session.messageOrder.filter((reference) => viewMessageUids.has(reference.messageUid)),
      ),
    },
    turnScopeIds: turnItems.map((item) => item.turnScopeId),
  };
}

export async function readSessionArtifactForRepair({
  storageService = null,
  sessionDir = "",
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonWithStorage({
    storageService,
    artifactPath: files.session,
    fallback: null,
  });
  if (!isObjectLike(session)) return null;
  if (session.schemaVersion === TURN_JOURNAL_SCHEMA_VERSION) {
    return readSessionArtifact({ storageService, sessionDir });
  }
  return readSessionForProtocolRepair({ sessionDir, session });
}
