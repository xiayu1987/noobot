/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MESSAGE_IDENTITY_STORE,
  SESSION_ARTIFACT_MESSAGE_IDENTITY_SCHEMA_VERSION,
  migrateSessionDocumentIdentity,
} from "@noobot/session-protocol";

export const SESSION_MESSAGE_IDENTITY_MIGRATION = "session-message-identity-v13";

function migrateJournalMessage(message) {
  const result = migrateSessionDocumentIdentity({ message }, MESSAGE_IDENTITY_STORE.JOURNAL);
  return { message: result.document.message, changed: result.changed };
}

export function migrateMessageIdentity(context) {
  if (context.sourceSchemaVersion >= SESSION_ARTIFACT_MESSAGE_IDENTITY_SCHEMA_VERSION) return;
  const session = migrateSessionDocumentIdentity(context.next, MESSAGE_IDENTITY_STORE.SESSION);
  let changed = session.changed;
  const messages = session.document.messages.map((message) => {
    const result = migrateJournalMessage(message);
    changed = result.changed || changed;
    return result.message;
  });
  if (!changed) return;
  Object.assign(context.next, session.document, { messages });
  context.lifecycle = context.next.turnLifecycle;
  context.turns = context.lifecycle.turns;
  context.changed = true;
  context.migrations.push(SESSION_MESSAGE_IDENTITY_MIGRATION);
}
