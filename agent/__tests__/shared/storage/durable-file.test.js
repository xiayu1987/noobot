/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { filePath as path } from "@noobot/path-resolver";
import { createDurableFilePublisher } from "../../../src/shared/storage/durable-file.js";
import { getFsAdapter, setFsAdapter } from "../../../src/shared/storage/fs-adapter.js";

for (const failClose of [false, true]) {
  for (const failRemove of [false, true]) {
    test(`failed durable write preserves operation and cleanup errors (close=${failClose}, remove=${failRemove})`, async (t) => {
      const root = await mkdtemp(path.join(tmpdir(), "durable-file-fault-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      const target = path.join(root, "CURRENT");
      await writeFile(target, "committed");
      const adapter = getFsAdapter();
      const writeError = new Error("injected write failure");
      const closeError = new Error("injected close failure");
      const removeError = new Error("injected remove failure");
      const events = [];
      setFsAdapter({
        ...adapter,
        async open(file, ...args) {
          const handle = await adapter.open(file, ...args);
          return {
            async writeFile(bytes) {
              await handle.writeFile(bytes);
              events.push("write");
              throw writeError;
            },
            async close() {
              await handle.close();
              events.push("close");
              if (failClose) throw closeError;
            },
          };
        },
        async rm(file, options) {
          events.push("remove");
          if (failRemove) throw removeError;
          return adapter.rm(file, options);
        },
      });
      const publisher = createDurableFilePublisher((file, id) => `${file}.${id}.tmp`);
      try {
        await assert.rejects(publisher.writeDurableReplacement(target, "uncommitted"), (error) => {
          const operation = failRemove ? error.errors[0] : error;
          if (failClose) {
            assert.ok(operation instanceof AggregateError);
            assert.deepEqual(operation.errors, [writeError, closeError]);
            assert.equal(operation.cause, writeError);
          } else assert.equal(operation, writeError);
          if (failRemove) {
            assert.ok(error instanceof AggregateError);
            assert.equal(error.errors[1], removeError);
            assert.equal(error.cause, operation);
          }
          return true;
        });
      } finally {
        setFsAdapter(adapter);
      }
      assert.deepEqual(events, ["write", "close", "remove"]);
      assert.equal(await readFile(target, "utf8"), "committed");
      const entries = await readdir(root);
      assert.equal(entries.length, failRemove ? 2 : 1);
      await publisher.writeDurableReplacement(target, "retried");
      assert.equal(await readFile(target, "utf8"), "retried");
    });
  }
}
