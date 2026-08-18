/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { attachmentIdentityKey, projectAttachmentIdentity } from "@noobot/attachment-protocol";

function messageAttachments(messages = []) {
  return (Array.isArray(messages) ? messages : []).flatMap((message) =>
    Array.isArray(message?.attachments) ? message.attachments : [],
  );
}

export async function projectSessionAttachmentState({
  attachmentService,
  userId = "",
  session = {},
} = {}) {
  if (!attachmentService?.readAttachmentMetas) {
    throw new TypeError("session attachment projection requires attachmentService");
  }
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const attachments = messageAttachments(messages);
  if (!attachments.length) return session;

  const scopes = new Map();
  for (const attachment of attachments) {
    const identity = projectAttachmentIdentity(attachment);
    scopes.set(JSON.stringify([identity.sessionId, identity.attachmentSource]), identity);
  }

  const canonicalByIdentity = new Map();
  for (const scope of scopes.values()) {
    const records = await attachmentService.readAttachmentMetas({
      userId,
      sessionId: scope.sessionId,
      attachmentSource: scope.attachmentSource,
    });
    for (const record of records) {
      canonicalByIdentity.set(attachmentIdentityKey(projectAttachmentIdentity(record)), record);
    }
  }

  return {
    ...session,
    messages: messages.map((message) => {
      if (!Array.isArray(message?.attachments) || !message.attachments.length) return message;
      return {
        ...message,
        attachments: message.attachments.map((attachment) => {
          const canonical = canonicalByIdentity.get(
            attachmentIdentityKey(projectAttachmentIdentity(attachment)),
          );
          return canonical ? { ...attachment, ...canonical } : attachment;
        }),
      };
    }),
  };
}
