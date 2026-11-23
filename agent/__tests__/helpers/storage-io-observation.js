/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { performance } from "node:perf_hooks";
import { isFunction } from "@noobot/shared/value";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

export async function observeStorageIo(root, operation) {
  const previous = getFsAdapter();
  const absoluteRoot = path.resolve(root);
  const prefix = `${absoluteRoot}${path.sep}`;
  const owns = (file) => String(file) === absoluteRoot || String(file).startsWith(prefix);
  const traceDirectoryReads = process.env.NOOBOT_TEST_TRACE_DIRECTORY_READS === "1";
  const work = {
    openCalls: 0,
    readCalls: 0,
    syncCalls: 0,
    completedSyncs: 0,
    readBytes: 0,
    readBytesByPath: new Map(),
    elapsedMsByCategory: new Map(),
    ...(traceDirectoryReads ? { directoryReadBytesByStack: new Map() } : {}),
    writeBytes: 0,
    writeBytesByPath: new Map(),
    renames: 0,
  };
  function recordElapsed(kind, file, started) {
    const name = path.basename(file);
    const category = name.endsWith(".pages")
      ? "catalog"
      : name === "START" || name === "offsets.idx"
        ? "partitionIndex"
        : name === "records.log"
          ? "records"
          : "other";
    const key = `${kind}:${category}`;
    const totals = work.elapsedMsByCategory;
    totals.set(key, (totals.get(key) ?? 0) + performance.now() - started);
  }
  function recordRead(file, bytes) {
    const name = path.relative(absoluteRoot, file);
    work.readBytes += bytes;
    work.readBytesByPath.set(name, (work.readBytesByPath.get(name) ?? 0) + bytes);
  }
  function recordWrite(file, bytes) {
    const name = path.relative(absoluteRoot, file);
    work.writeBytes += bytes;
    work.writeBytesByPath.set(name, (work.writeBytesByPath.get(name) ?? 0) + bytes);
  }
  setFsAdapter({
    ...previous,
    async open(file, ...args) {
      const stack =
        traceDirectoryReads && owns(file) && String(file).endsWith(".pages")
          ? new Error().stack
              .split("\n")
              .filter((frame) => frame.includes("/partition-storage/"))
              .join("\n")
          : null;
      if (!owns(file)) return previous.open(file, ...args);
      const started = performance.now();
      const handle = await previous.open(file, ...args);
      recordElapsed("open", file, started);
      work.openCalls += 1;
      return new Proxy(handle, {
        get(target, key) {
          if (key === "read" || key === "readv")
            return async (...readArgs) => {
              work.readCalls += 1;
              const started = performance.now();
              const result = await target[key](...readArgs);
              recordElapsed("read", file, started);
              recordRead(file, result.bytesRead);
              if (stack !== null) {
                const totals = work.directoryReadBytesByStack;
                totals.set(stack, (totals.get(stack) ?? 0) + result.bytesRead);
              }
              return result;
            };
          if (key === "readFile")
            return async (...readArgs) => {
              const started = performance.now();
              const result = await target.readFile(...readArgs);
              recordElapsed("read", file, started);
              recordRead(file, Buffer.isBuffer(result) ? result.length : Buffer.byteLength(result));
              return result;
            };
          if (key === "sync")
            return async () => {
              work.syncCalls += 1;
              const started = performance.now();
              await target.sync();
              recordElapsed("sync", file, started);
              work.completedSyncs += 1;
            };
          if (key === "write" || key === "writev")
            return async (...writeArgs) => {
              const result = await target[key](...writeArgs);
              recordWrite(file, result.bytesWritten);
              return result;
            };
          if (key === "writeFile")
            return async (data, options) => {
              await target.writeFile(data, options);
              recordWrite(
                file,
                typeof data === "string"
                  ? Buffer.byteLength(
                      data,
                      typeof options === "string" ? options : options?.encoding,
                    )
                  : data.byteLength,
              );
            };
          const value = Reflect.get(target, key, target);
          return isFunction(value) ? value.bind(target) : value;
        },
      });
    },
    async readFile(file, ...args) {
      if (!owns(file)) return previous.readFile(file, ...args);
      const started = performance.now();
      const result = await previous.readFile(file, ...args);
      recordElapsed("read", file, started);
      recordRead(file, Buffer.isBuffer(result) ? result.length : Buffer.byteLength(result));
      return result;
    },
    async writeFile(file, data, options) {
      await previous.writeFile(file, data, options);
      if (owns(file))
        recordWrite(
          file,
          typeof data === "string"
            ? Buffer.byteLength(data, typeof options === "string" ? options : options?.encoding)
            : data.byteLength,
        );
    },
    async rename(source, target) {
      await previous.rename(source, target);
      if (owns(target)) work.renames += 1;
    },
  });
  try {
    return {
      result: await operation(
        () => work.readBytes,
        () => work.writeBytes,
      ),
      work,
    };
  } finally {
    setFsAdapter(previous);
  }
}
