/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { build } from "vite";
import { expect, test } from "vitest";

test("file mutation browser contract excludes Node byte codecs", async () => {
  const bundle = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.resolve(
          import.meta.dirname,
          "../../../../../file-mutation-protocol/src/index.js",
        ),
        formats: ["es"],
      },
    },
  });
  const modules = bundle.flatMap((result) =>
    result.output.flatMap((chunk) => Object.keys(chunk.modules ?? {})),
  );
  expect(
    modules.some((moduleId) => moduleId.endsWith("/file-mutation-protocol/src/index.js")),
  ).toBe(true);
  expect(
    modules.filter((moduleId) =>
      /iconv-lite|safe-buffer|text-codec-node|browser-external/.test(moduleId),
    ),
  ).toEqual([]);
});
