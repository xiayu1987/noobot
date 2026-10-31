/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { projectAttachmentIdentity } from "@noobot/attachment-protocol";

export function requireAgentDispatchAttachments(context) {
  if (Object.hasOwn(context, "attachments")) {
    throw new TypeError("agent dispatch attachments must use userMessageAttachments");
  }
  const attachments = context.userMessageAttachments;
  if (!Array.isArray(attachments)) {
    throw new TypeError("agent dispatch context requires userMessageAttachments array");
  }
  for (const attachment of attachments) projectAttachmentIdentity(attachment);
  return attachments;
}
