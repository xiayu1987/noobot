/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";

export async function readRepairJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw Object.assign(new Error(`Session repair artifact is unreadable: ${file}`), {
      code:
        error instanceof SyntaxError
          ? "ARTIFACT_JSON_CORRUPTED"
          : "SESSION_REPAIR_ARTIFACT_READ_FAILED",
      cause: error,
    });
  }
}

export async function readRepairJournal(file, committedBytes) {
  const raw = await readFile(file);
  const committed = Number(committedBytes || 0);
  if (!Number.isSafeInteger(committed) || committed < 0 || raw.length < committed) {
    throw Object.assign(new Error(`Session repair journal has an invalid boundary: ${file}`), {
      code: "TURN_JOURNAL_TRUNCATED",
    });
  }
  return raw
    .subarray(0, committed)
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw Object.assign(new Error(`Session repair journal is corrupted: ${file}`), {
          code: "ARTIFACT_JSON_CORRUPTED",
          cause: error,
        });
      }
    });
}
