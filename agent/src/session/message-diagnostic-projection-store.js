/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  MESSAGE_DIAGNOSTIC_PROJECTION_DIRECTORY,
  MESSAGE_DIAGNOSTIC_CURSOR_FILE,
  requireMessageDiagnosticCursor,
} from "@noobot/session-protocol/session-changes";
import {
  EXECUTION_LOG_BATCH_MAX_RECORDS,
  requireExecutionLogProjectionDelivery,
  executionLogProjectionFailure,
} from "@noobot/session-protocol";
import {
  syncStorageDirectory,
  writeDurableReplacement,
} from "./session-artifact-session/immutable-storage-io.js";

async function createProjectionDirectory(directory, sessionDir) {
  try {
    await mkdir(directory);
    await syncStorageDirectory(sessionDir);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

export async function projectMessageDiagnostics({ storageService, sessionDir, reader, deliver }) {
  if (typeof deliver !== "function") throw new TypeError("Diagnostic projection requires delivery");
  const directory = path.join(sessionDir, MESSAGE_DIAGNOSTIC_PROJECTION_DIRECTORY);
  const file = path.join(directory, MESSAGE_DIAGNOSTIC_CURSOR_FILE);
  const stored = await storageService.readOptionalJson(file);
  const cursor =
    stored === null ? { version: 1, sequence: 0 } : requireMessageDiagnosticCursor(stored);
  const page = await reader.readMessageDiagnosticPage({
    after: cursor.sequence,
    limit: EXECUTION_LOG_BATCH_MAX_RECORDS,
  });
  if (!page.entries.length) return { records: 0, pending: false };
  let outcomes = page.entries.map(() => "unknown");
  try {
    await createProjectionDirectory(directory, sessionDir);
    outcomes = requireExecutionLogProjectionDelivery(
      page.entries,
      await deliver(page.entries, { receiptDirectory: directory }),
    );
    await writeDurableReplacement(
      file,
      `${JSON.stringify({ version: 1, sequence: page.sequence })}\n`,
    );
  } catch (cause) {
    throw executionLogProjectionFailure(
      cause,
      page.entries.map(({ record }) => record),
      outcomes,
    );
  }
  return { records: page.entries.length, pending: page.pending };
}
