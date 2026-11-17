/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { isAtomicWriteTemporaryFile } from "@noobot/platform-compatibility/atomic-file-write";
import { fsReaddir } from "../shared/storage/fs-adapter.js";
import {
  EXECUTION_EVENT_INDEX_ERROR_CODE,
  EXECUTION_EVENT_TURNS_DIR,
  requireExecutionSegmentSequence,
} from "@noobot/session-protocol/execution-event-index";
import { requireDialogProcessKey } from "@noobot/session-protocol";
import {
  readExecutionTurnIndex,
  readRegisteredExecutionTurns,
  resolveExecutionEventsDir,
  resolveExecutionTurnDir,
} from "./session-artifact-execution-logs.js";

async function readUnindexedTurnTemporaryFiles(turnDir, dialogProcessId, signal) {
  const temporaryFiles = [];
  for (const file of await fsReaddir(turnDir, { withFileTypes: true })) {
    signal?.throwIfAborted();
    if (!file.isFile() || !isAtomicWriteTemporaryFile(file.name)) {
      throw Object.assign(
        new Error(`unregistered execution turn has no index: ${dialogProcessId}`),
        { code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED },
      );
    }
    temporaryFiles.push(file.name);
  }
  return temporaryFiles;
}

export async function readExecutionTurnInventory({ storageService, sessionDir, signal }) {
  const registered = await readRegisteredExecutionTurns({ storageService, sessionDir, signal });
  const turns = registered.map((turn) => ({ ...turn, registered: true }));
  const registeredIds = new Set(registered.map((turn) => turn.dialogProcessId));
  let entries;
  try {
    entries = await fsReaddir(
      path.join(resolveExecutionEventsDir(sessionDir), EXECUTION_EVENT_TURNS_DIR),
      { withFileTypes: true },
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return turns;
  }
  for (const entry of entries) {
    signal?.throwIfAborted();
    if (!entry.isDirectory()) {
      throw Object.assign(new Error(`execution turn entry is not a directory: ${entry.name}`), {
        code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED,
      });
    }
    const dialogProcessId = requireDialogProcessKey(entry.name);
    if (registeredIds.has(dialogProcessId)) continue;
    const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
    const index = await readExecutionTurnIndex({ storageService, turnDir });

    const temporaryFiles =
      index === null ? await readUnindexedTurnTemporaryFiles(turnDir, dialogProcessId, signal) : [];
    turns.push({ dialogProcessId, turnDir, index, temporaryFiles, registered: false });
  }
  signal?.throwIfAborted();
  return turns;
}

export async function readExecutionSegmentInventory({ turnDir, index, signal }) {
  signal?.throwIfAborted();
  if (index === null) return [];
  const files = new Map(index.segments.map(({ file }) => [file, { file, indexed: true }]));
  for (const entry of await fsReaddir(turnDir, { withFileTypes: true })) {
    signal?.throwIfAborted();
    if (!entry.name.endsWith(".jsonl")) continue;
    requireExecutionSegmentSequence(entry.name);
    if (!entry.isFile())
      throw Object.assign(new Error(`execution segment is not a regular file: ${entry.name}`), {
        code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED,
      });
    if (!files.has(entry.name)) files.set(entry.name, { file: entry.name, indexed: false });
  }
  signal?.throwIfAborted();
  return [...files.values()];
}
