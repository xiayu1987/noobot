/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { storageDigest } from "#storage-digest";
import { exactObject } from "./partition-journal-fields.js";

export function encodePartitionJournalControl(record) {
  const payload = JSON.stringify(record);
  return JSON.stringify({ payload, digest: storageDigest(payload) });
}

export function decodePartitionJournalControl(serialized) {
  const envelope = JSON.parse(serialized);
  exactObject(envelope, ["payload", "digest"], "partition journal control envelope");
  if (typeof envelope.payload !== "string" || storageDigest(envelope.payload) !== envelope.digest)
    throw new TypeError("Partition journal control integrity check failed");
  return JSON.parse(envelope.payload);
}
