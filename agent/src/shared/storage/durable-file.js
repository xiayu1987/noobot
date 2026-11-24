/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { filePath as path } from "@noobot/path-resolver";
import { renameFileAtomic } from "@noobot/platform-compatibility/atomic-file-write";
import { createdDirectoryDepth, syncDirectory } from "@noobot/platform-compatibility/file-system";
import { fsLink, fsMkdir, fsOpen, fsReaddir, fsRename, fsRm } from "./fs-adapter.js";

export async function withStorageCleanup(operation, cleanup) {
  let failed = false;
  let failure;
  let result;
  try {
    result = await operation();
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await cleanup();
  } catch (error) {
    if (failed)
      throw new AggregateError([failure, error], "Storage operation and cleanup failed", {
        cause: failure,
      });
    throw error;
  }
  if (failed) throw failure;
  return result;
}

export function syncStorageDirectory(directory) {
  return syncDirectory({ directory, open: fsOpen });
}

export async function ensureDurableStorageDirectory(directory) {
  const target = path.resolve(directory);
  const firstCreated = await fsMkdir(target, { recursive: true });
  if (firstCreated === undefined) return;
  const depth = createdDirectoryDepth(target, firstCreated);
  let parent = path.dirname(target);
  for (let index = 0; index < depth; index += 1) {
    await syncStorageDirectory(parent);
    parent = path.dirname(parent);
  }
}

export function createDurableFilePublisher(temporaryFile, { exclusiveStage = false, mode } = {}) {
  async function installSyncedFile(file, write, install, onFileSync) {
    const temporary = exclusiveStage ? temporaryFile(file) : temporaryFile(file, randomUUID());
    let handle;
    try {
      handle = await fsOpen(temporary, "wx", mode);
    } catch (cause) {
      if (!exclusiveStage || cause.code !== "EEXIST") throw cause;

      await fsRm(temporary);
      handle = await fsOpen(temporary, "wx", mode);
    }
    try {
      await withStorageCleanup(
        async () => {
          await write(handle);
          await handle.sync();
          onFileSync?.();
        },
        () => handle.close(),
      );
      await install(temporary, file);
    } catch (error) {
      await withStorageCleanup(
        async () => {
          throw error;
        },
        () => fsRm(temporary, { force: true }),
      );
    }
  }

  function publishSyncedFile(file, write, onFileSync, beforeRename) {
    return installSyncedFile(
      file,
      write,
      (source, filePath) =>
        renameFileAtomic({
          source,
          filePath,
          rename: (from, to) => {
            beforeRename?.();
            return fsRename(from, to);
          },
        }),
      onFileSync,
    );
  }

  function replaceSyncedFile(file, bytes, beforeRename) {
    return publishSyncedFile(file, (handle) => handle.writeFile(bytes), undefined, beforeRename);
  }

  async function writeDurableNewFile(file, bytes) {
    await installSyncedFile(
      file,
      (handle) => handle.writeFile(bytes),
      async (source, target) => {
        await fsLink(source, target);
        await fsRm(source);
      },
    );
    return syncStorageDirectory(path.dirname(file));
  }

  async function writeDurableReplacement(file, bytes, beforeRename) {
    await replaceSyncedFile(file, Buffer.from(bytes), beforeRename);
    return syncStorageDirectory(path.dirname(file));
  }

  return { publishSyncedFile, replaceSyncedFile, writeDurableNewFile, writeDurableReplacement };
}

const jsonStagePrefix = (file) => `${file}.publication-`;
const jsonStageSuffix = ".tmp";
const publicationId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const jsonPublisher = createDurableFilePublisher(
  (file, id) => `${jsonStagePrefix(file)}${id}${jsonStageSuffix}`,
);

export function durableJsonPublicationTarget(name) {
  const suffixStart = name.lastIndexOf(".publication-");
  if (suffixStart <= 0 || !name.endsWith(jsonStageSuffix)) return null;
  const file = name.slice(0, suffixStart);
  const id = name.slice(jsonStagePrefix(file).length, -jsonStageSuffix.length);
  return publicationId.test(id) ? file : null;
}

export async function recoverDurableJsonPublication(file) {
  const directory = path.dirname(file);
  const basename = path.basename(file);
  const entries = await fsReaddir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const { name } = entry;
    if (entry.isFile() && durableJsonPublicationTarget(name) === basename)
      await fsRm(path.join(directory, name));
  }
  await syncStorageDirectory(directory);
}

export function writeDurableJsonFile(file, json) {
  return jsonPublisher.writeDurableReplacement(file, json);
}
