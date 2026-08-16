/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createCommandRequestHash } from "./command-fingerprint.mjs";

export function createMessageDeleteFingerprint({ anchor = {} } = {}) {
  return createCommandRequestHash({ type: "session.message.delete_from", anchor });
}
