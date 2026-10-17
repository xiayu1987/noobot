/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import { RuleTester } from "eslint";
import { noobotLocalRules } from "./eslint-local-rules.mjs";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

test("no-positional-pattern-holes allows only the entry value pair", () => {
  ruleTester.run(
    "no-positional-pattern-holes",
    noobotLocalRules.rules["no-positional-pattern-holes"],
    {
      valid: [
        "entries.filter(([, value]) => value);",
        "const [key, value] = pair;",
        "const { name } = match.groups;",
      ],
      invalid: [
        { code: "const [, name, expr] = match;", errors: [{ messageId: "positionalHole" }] },
        { code: "const [key, , node] = tuple;", errors: [{ messageId: "positionalHole" }] },
        {
          code: "rows.map(([, , , error]) => error);",
          errors: [
            { messageId: "positionalHole" },
            { messageId: "positionalHole" },
            { messageId: "positionalHole" },
          ],
        },
        { code: "const [first, ,] = list;", errors: [{ messageId: "positionalHole" }] },
      ],
    },
  );
});
