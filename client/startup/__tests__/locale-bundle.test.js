/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

test("startup bundles only its shared composer catalog and stays within the chunk budget", async () => {
  let chunkSizeWarningLimit;
  const result = await build({
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "error",
    build: { write: false },
    plugins: [
      {
        name: "capture-chunk-budget",
        configResolved(config) {
          chunkSizeWarningLimit = config.build.chunkSizeWarningLimit;
        },
      },
    ],
  });
  const chunks = result.output.filter((output) => output.type === "chunk");
  const localeModules = chunks
    .flatMap((chunk) => chunk.moduleIds)
    .filter((id) => id.includes("/i18n/src/"));
  assert.deepEqual(localeModules, [
    fileURLToPath(new URL("../../../i18n/src/client/composer-messages.js", import.meta.url)),
  ]);
  for (const chunk of chunks) {
    assert.ok(
      Buffer.byteLength(chunk.code) <= chunkSizeWarningLimit * 1000,
      `${chunk.fileName} exceeds the configured ${chunkSizeWarningLimit} kB budget`,
    );
  }
});
