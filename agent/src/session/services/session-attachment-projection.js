/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  attachmentIdentityKey,
  projectAttachmentIdentity,
  readRequiredAttachmentMetadata,
} from "@noobot/attachment-protocol";

function messageAttachments(messages) {
  return messages.flatMap((message) =>
    Array.isArray(message?.attachments) ? message.attachments : [],
  );
}

export async function projectSessionAttachmentState({
  attachmentService,
  userId = "",
  session = {},
} = {}) {
  const { messages } = session;
  const attachments = messageAttachments(messages);
  if (!attachments.length) return session;

  const requested = new Map();
  for (const attachment of attachments) {
    const identity = projectAttachmentIdentity(attachment);
    requested.set(attachmentIdentityKey(identity), identity);
  }
  const records = await readRequiredAttachmentMetadata(attachmentService, {
    userId,
    identities: [...requested.values()],
  });
  const canonicalByIdentity = new Map(
    [...requested.keys()].map((key, index) => [key, records[index]]),
  );

  return {
    ...session,
    messages: messages.map((message) => {
      if (!Array.isArray(message?.attachments) || !message.attachments.length) return message;
      return {
        ...message,
        attachments: message.attachments.map((attachment) =>
          canonicalByIdentity.get(attachmentIdentityKey(projectAttachmentIdentity(attachment))),
        ),
      };
    }),
  };
}
