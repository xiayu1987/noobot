/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { CHECK, DIRECT_I18N_IMPORT } from "./check-i18n-imports.mjs";
import { createExemptionUsage, EXEMPTION_KINDS } from "./quality/check-protocol.mjs";

const I18N_PACKAGE = ["noobot", "i18n"].join("-");

function matches(source) {
  return [...source.matchAll(DIRECT_I18N_IMPORT)].map((match) => match[0]);
}

test("matches static, subpath, and dynamic noobot-i18n imports", () => {
  assert.deepEqual(
    matches(
      [
        `import { messages } from "${I18N_PACKAGE}/client/messages";`,
        `import x from '${I18N_PACKAGE}';`,
        `const lazy = import("${I18N_PACKAGE}/shared");`,
      ].join("\n"),
    ),
    [
      `from "${I18N_PACKAGE}/client/messages"`,
      `from '${I18N_PACKAGE}'`,
      `import("${I18N_PACKAGE}/shared"`,
    ],
  );
});

test("ignores look-alike packages and unrelated strings", () => {
  assert.deepEqual(
    matches(
      [
        `import x from "${I18N_PACKAGE}-extra";`,
        'import y from "@noobot/i18n";',
        `const name = "${I18N_PACKAGE}";`,
      ].join("\n"),
    ),
    [],
  );
});

test("exempts declared entry points and reports everything else", () => {
  const usage = createExemptionUsage(CHECK);
  const exempts = (file) => usage.exempts("directI18nImport", EXEMPTION_KINDS.PATH_PREFIX, file);
  assert.equal(exempts("agent/src/session/index.js"), true);
  assert.equal(exempts("service/bootstrap/create-app-dependencies.js"), true);
  assert.equal(exempts("service/routes/chat.js"), false);
  assert.equal(exempts("plugin/noobot-plugin-harness/src/index.js"), false);
});
