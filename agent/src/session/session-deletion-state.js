/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  parseWorkspaceSessionDeletionState,
  readWorkspaceSessionDeletionState,
} from "@noobot/workspace-protocol/session-store";
import { createParsedTextMemo } from "../shared/storage/parsed-text-memo.js";
import { fsReadFile } from "../shared/storage/fs-adapter.js";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { createSessionDeletedError } from "@noobot/session-protocol";

const parseDeletionState = createParsedTextMemo((raw, file) =>
  parseWorkspaceSessionDeletionState({ raw, file }),
);

export async function readSessionDeletionState(basePath) {
  return readWorkspaceSessionDeletionState({
    file: path.join(basePath, WORKSPACE_LAYOUT.SESSION_TOMBSTONE_FILE),
    readFile: fsReadFile,
    parse: ({ raw, file }) => parseDeletionState(raw, file),
  });
}

export async function assertSessionsWritable(basePath, userId, sessionIds) {
  const { sessions } = await readSessionDeletionState(basePath);
  for (const sessionId of sessionIds) {
    if (Object.hasOwn(sessions, sessionId)) throw createSessionDeletedError({ userId, sessionId });
  }
}
