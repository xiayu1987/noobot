/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { messageContentReadError } from "@noobot/session-protocol/message-read-budget";

export async function readRequiredMessageContentPage(reader, selection) {
  const page = await reader.readMessageContentPage(selection);
  if (page === null)
    throw messageContentReadError("missing", `Session message is missing: ${selection.messageUid}`);
  return page;
}
