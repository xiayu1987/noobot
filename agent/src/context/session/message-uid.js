/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createMessageUid } from "@noobot/context-protocol/message/identity";

export function createSessionMessageUid() {
  return createMessageUid();
}
