/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { storageDigest } from "#storage-digest";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { JOURNAL_JSON_MAX_DEPTH } from "./partition-journal-json.js";

export const journalDigestBytes = storageDigest("").length / 2;
export const PARTITION_JOURNAL_FRAME = Object.freeze({
  lengthBytes: Uint32Array.BYTES_PER_ELEMENT,
  headerBytes: Uint32Array.BYTES_PER_ELEMENT + journalDigestBytes,
  trailer: "COMMIT\n",
  get controlBytes() {
    return LENGTH_THRESHOLDS.sessionStorage.journalControlBytes;
  },
  get directoryBytes() {
    return LENGTH_THRESHOLDS.sessionStorage.journalDirectoryBytes;
  },
  offsetBytes: BigUint64Array.BYTES_PER_ELEMENT,
  maxPayloadBytes: 2 ** (Uint32Array.BYTES_PER_ELEMENT * 8) - 1,
  maxTimerMs: 0x7fffffff,
  maxJsonDepth: JOURNAL_JSON_MAX_DEPTH,
});
