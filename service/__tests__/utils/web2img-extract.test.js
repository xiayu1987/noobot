/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { extractUsefulAndFullText } from "../../system-core/utils/web/web2img/web2img-extract.js";

function createFakePage() {
  return {
    async title() {
      return "Test Title";
    },
    locator() {
      return {
        first() {
          return {
            async getAttribute() {
              return "Description text";
            },
          };
        },
      };
    },
    async evaluate(payload) {
      if (typeof payload === "string") {
        return [
          { type: "text", text: "This is normal content line" },
          { type: "code", lang: "js", text: "console.log('ok')" },
          { type: "text", text: "广告" },
        ];
      }
      return "This is normal content line\n广告\nThis is normal content line\nAnother valid content line";
    },
    async content() {
      return "<html></html>";
    },
    url() {
      return "https://example.com";
    },
  };
}

test("web2img extract: extractUsefulAndFullText composes useful/full text", async () => {
  const page = createFakePage();
  const [usefulText, fullText] = await extractUsefulAndFullText(page, ["广告"], false);

  assert.match(usefulText, /Test Title/);
  assert.match(usefulText, /Description text/);
  assert.match(usefulText, /This is normal content line/);
  assert.match(usefulText, /```js/);

  assert.match(fullText, /This is normal content line/);
  assert.match(fullText, /Another valid content line/);
  assert.doesNotMatch(fullText, /^.*广告.*$/m);
  assert.match(fullText, /\[ORDERED_CONTENT\]/);
});
