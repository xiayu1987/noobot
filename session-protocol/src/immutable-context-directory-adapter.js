/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableStorageError } from "./immutable-storage-error.js";
import {
  requireOrdinalDirectoryPage,
  updateOrdinalDirectory,
  readDirectoryOrdinals,
} from "./ordinal-directory.js";

export const immutableStorageContextDirectory = Object.freeze({
  requirePage: (page, prefix) => requireOrdinalDirectoryPage(page, prefix, immutableStorageError),
  update: (directory, ordinal, present) =>
    updateOrdinalDirectory(directory, ordinal, present, immutableStorageError),
  read: (readPage, options) => readDirectoryOrdinals(readPage, options, immutableStorageError),
});
