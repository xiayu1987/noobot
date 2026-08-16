/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import {
  allowedPluginApiSpecifiers,
  inspectFrontendSource,
} from "./check-plugin-frontend-reverse-deps.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(projectRoot, "../..");
const fixtureImporter = path.resolve(repoRoot, "plugin/example/frontend/index.js");

test("accepts exported plugin API imports and ignores incidental source text", async () => {
  const source = [
    'import { BaseEmptyHint } from "noobot-chat/plugin-api/ui";',
    'import { ref } from "vue";',
    '// import value from "../../client/noobot-chat/src/internal.js";',
  ].join("\n");
  assert.deepEqual(await inspectFrontendSource(fixtureImporter, source), []);
});

test("rejects relative client source imports and private host subpaths", async () => {
  const source = [
    'import value from "../../../client/noobot-chat/src/public/ui.js";',
    'import internal from "noobot-chat/src/shared/internal.js";',
  ].join("\n");
  assert.deepEqual(
    (await inspectFrontendSource(fixtureImporter, source)).map(({ reason }) => reason),
    [
      "plugin frontend must not import client source by relative file path",
      "plugin frontend must use an exported noobot-chat/plugin-api subpath",
    ],
  );
});

test("package exports expose exactly the supported plugin API surface", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.resolve(projectRoot, "package.json"), "utf8"),
  );
  const expectedExportKeys = new Set(
    [...allowedPluginApiSpecifiers].map((specifier) => `.${specifier.slice("noobot-chat".length)}`),
  );
  assert.deepEqual(new Set(Object.keys(packageJson.exports)), expectedExportKeys);
  for (const specifier of allowedPluginApiSpecifiers) {
    assert.match(import.meta.resolve(specifier), /client\/noobot-chat\/src\/public\/.+\.js$/);
  }
  assert.throws(
    () => import.meta.resolve("noobot-chat/src/shared/ui/index.js"),
    (error) => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
});
