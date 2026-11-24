/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createDurableFilePublisher,
  syncStorageDirectory as syncDirectory,
} from "../shared/storage/durable-file.js";
import { recordStorageWork } from "./session-storage-observation.js";

export { withStorageCleanup } from "../shared/storage/durable-file.js";

const publisher = createDurableFilePublisher((file, token) => `${file}.${token}.tmp`);

export async function syncStorageDirectory(directory) {
  if (await syncDirectory(directory)) recordStorageWork("artifactDirectorySyncs");
}

export async function writeDurableReplacement(file, bytes) {
  if (await publisher.writeDurableReplacement(file, bytes))
    recordStorageWork("artifactDirectorySyncs");
}
