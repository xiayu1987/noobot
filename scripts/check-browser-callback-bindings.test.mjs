/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { findBrowserCallbackModuleBindings } from "./check-browser-callback-bindings.mjs";

const names = (source) => findBrowserCallbackModuleBindings(source).map((hit) => hit.name);

test("detects module bindings referenced inside browser callbacks", () => {
  const source = `import { text, isFunction } from "x";
    await locator.evaluate((node) => isFunction(node.x) && text(node.textContent));
    await page.addInitScript(() => { const v = { value: text("a") }; });`;
  assert.deepEqual(names(source), ["isFunction", "text", "text"]);
});

test("ignores keys, member properties, shadowed names and node-side usage", () => {
  const source = `import { text } from "x";
    const label = text(" a ");
    await page.addInitScript(({ modelAlias }) => {
      const scenarioModels = { text: modelAlias };
      return document.body.text;
    });
    await page.evaluate((text) => text.trim(), label);
    await page.waitForFunction(() => { const text = "local"; return text; });`;
  assert.deepEqual(names(source), []);
});
