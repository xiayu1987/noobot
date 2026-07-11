/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { loadSystemPrompt } from "../../../src/system-core/context/providers/system-prompt-loader.js";

test("loadSystemPrompt selects the Chinese base prompt by default", async () => {
  const prompt = await loadSystemPrompt();

  assert.match(prompt, /规则：/);
  assert.match(prompt, /行动优先/);
});

test("loadSystemPrompt selects the English base prompt for en-US locale", async () => {
  const prompt = await loadSystemPrompt({ locale: "en-US" });

  assert.match(prompt, /Rules:/);
  assert.match(prompt, /Action first/);
  assert.doesNotMatch(prompt, /行动优先/);
});

test("loadSystemPrompt normalizes locale aliases", async () => {
  const prompt = await loadSystemPrompt({ locale: "en" });

  assert.match(prompt, /Rules:/);
  assert.match(prompt, /Persist until verified/);
});
