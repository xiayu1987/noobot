/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { useMessageFiles } from "../../../../../src/composables/message/useMessageFiles";

export function createMessageFiles(options) {
  return useMessageFiles({
    getAllMessages: () => [],
    getSessionDocs: () => [],
    getUserId: () => "admin",
    ...options,
  });
}
