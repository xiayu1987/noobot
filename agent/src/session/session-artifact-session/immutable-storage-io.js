/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { hash } from "node:crypto";
import { immutablePublicationTemporaryFile } from "@noobot/session-protocol/immutable-storage";
import {
  createDurableFilePublisher,
  syncStorageDirectory as syncDirectory,
} from "../../shared/storage/durable-file.js";
import { recordStorageWork } from "../session-storage-observation.js";

export { withStorageCleanup } from "../../shared/storage/durable-file.js";

const publisher = createDurableFilePublisher(immutablePublicationTemporaryFile);

export function contentDigest(bytes) {
  return hash("sha256", bytes, "hex");
}

export async function syncStorageDirectory(directory) {
  if (await syncDirectory(directory)) recordStorageWork("immutableDirectorySyncs");
}

export function publishSyncedFile(file, write, syncWork) {
  return publisher.publishSyncedFile(file, write, () => recordStorageWork(syncWork));
}

export const { replaceSyncedFile } = publisher;

export async function writeDurableReplacement(file, bytes) {
  if (await publisher.writeDurableReplacement(file, bytes))
    recordStorageWork("immutableDirectorySyncs");
}
