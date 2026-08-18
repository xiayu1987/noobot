/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const guardPath = fileURLToPath(new URL("./check-source-license-headers.mjs", import.meta.url));
const blockHeader = `/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */`;

function runGuard(root) {
  return spawnSync(process.execPath, [guardPath, root], { encoding: "utf8" });
}

test("source license guard requires the header at the file boundary", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-license-header-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, "valid.js"), `${blockHeader}\nexport {};\n`);
  fs.writeFileSync(
    path.join(root, "valid.mjs"),
    `#!/usr/bin/env node\n/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */\n`,
  );
  fs.writeFileSync(
    path.join(root, "valid.vue"),
    `<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->\n<template />\n`,
  );

  const validResult = runGuard(root);
  assert.equal(validResult.status, 0, validResult.stderr);

  fs.writeFileSync(path.join(root, "invalid.js"), `import "node:path";\n${blockHeader}\n`);
  const invalidResult = runGuard(root);
  assert.equal(invalidResult.status, 1);
  assert.match(
    invalidResult.stderr,
    /invalid\.js: license header must be the first syntax element/,
  );
});
