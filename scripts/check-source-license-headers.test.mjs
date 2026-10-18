/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CANONICAL_CONTACT, measureLicenseHeaders } from "./check-source-license-headers.mjs";
import { fixSourceLicenseHeaders, repairMaskedContact } from "./fix-source-license-headers.mjs";

const blockHeader = `/*
 * Copyright (c) 2026 xiayu
 * ${CANONICAL_CONTACT}
 * SPDX-License-Identifier: MIT
 */`;
const maskedHeader = blockHeader.replace(CANONICAL_CONTACT, "Contact: xxxx@example.invalid");

function withFiles(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-license-header-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, source] of Object.entries(files))
    fs.writeFileSync(path.join(root, file), source);
  return root;
}

test("license guard accepts block, shebang, and vue headers", (t) => {
  const files = {
    "valid.js": `${blockHeader}\nexport {};\n`,
    "valid.mjs": `#!/usr/bin/env node\n${blockHeader}\n`,
    "valid.vue": `<!--\n  Copyright (c) 2026 xiayu\n  ${CANONICAL_CONTACT}\n  SPDX-License-Identifier: MIT\n-->\n<template />\n`,
  };
  const measured = measureLicenseHeaders(withFiles(t, files), Object.keys(files));
  assert.deepEqual(measured.missingHeader.samples, []);
});

test("license guard reports misplaced and masked headers without writing", (t) => {
  const files = {
    "misplaced.js": `import "node:path";\n${blockHeader}\n`,
    "masked.js": `${maskedHeader}\n`,
  };
  const root = withFiles(t, files);
  const measured = measureLicenseHeaders(root, Object.keys(files));
  assert.deepEqual(measured.missingHeader.samples, [
    "misplaced.js:1 license header must be the first syntax element (after an optional shebang)",
    `masked.js:1 header missing ${CANONICAL_CONTACT}`,
  ]);
  assert.equal(fs.readFileSync(path.join(root, "masked.js"), "utf8"), `${maskedHeader}\n`);
});

test("license fix repairs masked contact lines only", (t) => {
  assert.equal(repairMaskedContact(`${blockHeader}\n`), `${blockHeader}\n`);
  const root = withFiles(t, { "masked.js": `${maskedHeader}\n`, "valid.js": `${blockHeader}\n` });
  assert.equal(fixSourceLicenseHeaders(root, ["masked.js", "valid.js"]), 1);
  assert.equal(fs.readFileSync(path.join(root, "masked.js"), "utf8"), `${blockHeader}\n`);
});
