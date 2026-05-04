/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import os from "node:os";
import { createWriteStream } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { once } from "node:events";
import yazl from "yazl";

async function addDirectoryToZip({
  zipFile,
  sourceDirectoryPath = "",
  zipDirectoryPath = "",
} = {}) {
  const directoryEntries = await readdir(sourceDirectoryPath, { withFileTypes: true });
  for (const directoryEntry of directoryEntries) {
    const absoluteEntryPath = path.join(sourceDirectoryPath, directoryEntry.name);
    const zipEntryPath = zipDirectoryPath
      ? `${zipDirectoryPath}/${directoryEntry.name}`
      : directoryEntry.name;
    if (directoryEntry.isDirectory()) {
      await addDirectoryToZip({
        zipFile,
        sourceDirectoryPath: absoluteEntryPath,
        zipDirectoryPath: zipEntryPath,
      });
      continue;
    }
    if (directoryEntry.isFile()) {
      zipFile.addFile(absoluteEntryPath, zipEntryPath);
    }
  }
}

export async function buildDirectoryArchiveFile({
  absoluteDirectoryPath = "",
  archiveName = "workspace-directory",
} = {}) {
  const safeArchiveName = String(archiveName || "workspace-directory")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "workspace-directory";
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "noobgo-workspace-download-"),
  );
  const archiveFilePath = path.join(
    temporaryDirectory,
    `${safeArchiveName}.zip`,
  );
  const sourceDirectoryName = path.basename(absoluteDirectoryPath);
  const zipFile = new yazl.ZipFile();
  await addDirectoryToZip({
    zipFile,
    sourceDirectoryPath: absoluteDirectoryPath,
    zipDirectoryPath: sourceDirectoryName,
  });
  const outputStream = createWriteStream(archiveFilePath);
  zipFile.outputStream.pipe(outputStream);
  zipFile.end();
  await Promise.race([
    once(outputStream, "close"),
    once(outputStream, "error").then(([error]) => {
      throw error;
    }),
  ]);
  return {
    archiveFilePath,
    temporaryDirectory,
    archiveFileName: `${safeArchiveName}.zip`,
  };
}
