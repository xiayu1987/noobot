/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  EXECUTION_EVENT_TURNS_DIR,
  EXECUTION_EVENT_INDEX_FILE,
  createSessionExecutionIndex,
  createTurnExecutionIndex,
} from "@noobot/session-protocol/execution-event-index";
import { reconcileExecutionSegmentIndex } from "@noobot/session-repair";
import { filePath as path } from "@noobot/path-resolver";
import { fsRm } from "../shared/storage/fs-adapter.js";
import {
  readExecutionSegmentSummary,
  writeExecutionTurnIndex,
  writeSessionExecutionIndex,
  prepareExecutionTurnDirectory,
} from "./session-artifact-execution-logs.js";
import {
  readExecutionTurnInventory,
  readExecutionSegmentInventory,
} from "./execution-log-inventory.js";

async function readExecutionSegmentStates({ storageService, sessionDir, signal }) {
  const turns = [];
  for (const turn of await readExecutionTurnInventory({ storageService, sessionDir, signal })) {
    const segments = [];
    for (const segment of await readExecutionSegmentInventory({ ...turn, signal })) {
      const actual = await readExecutionSegmentSummary({
        turnDir: turn.turnDir,
        file: segment.file,
        dialogProcessId: turn.dialogProcessId,
        signal,
      });
      segments.push({ ...segment, ...actual });
    }
    turns.push({ ...turn, segments });
  }
  return turns;
}

export async function recoverExecutionLogIndexes({ storageService, sessionDir, signal }) {
  const turns = await readExecutionSegmentStates({ storageService, sessionDir, signal });
  const plans = turns.map((turn) => ({
    turn,
    ...(turn.index === null
      ? { index: createTurnExecutionIndex([]), repaired: [EXECUTION_EVENT_INDEX_FILE] }
      : reconcileExecutionSegmentIndex(turn.index, turn.segments)),
  }));
  const repaired = [];
  for (const { turn, index, repaired: files } of plans) {
    signal?.throwIfAborted();
    if (!files.length) continue;
    if (turn.index === null) {
      for (const file of turn.temporaryFiles) {
        signal?.throwIfAborted();
        await fsRm(path.join(turn.turnDir, file));
      }
      await prepareExecutionTurnDirectory(sessionDir, turn.turnDir);
    }
    await writeExecutionTurnIndex({ storageService, turnDir: turn.turnDir, index });
    repaired.push(
      ...files.map((file) => `${EXECUTION_EVENT_TURNS_DIR}/${turn.dialogProcessId}/${file}`),
    );
  }
  if (turns.some((turn) => !turn.registered)) {
    signal?.throwIfAborted();
    await writeSessionExecutionIndex({
      storageService,
      sessionDir,
      index: createSessionExecutionIndex(turns.map(({ dialogProcessId }) => ({ dialogProcessId }))),
    });
    repaired.push(EXECUTION_EVENT_INDEX_FILE);
  }
  return { dialogProcessIds: turns.map(({ dialogProcessId }) => dialogProcessId), repaired };
}
