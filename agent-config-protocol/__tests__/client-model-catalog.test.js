/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createClientModelCatalog, normalizeClientModelOptions } from "../src/index.js";

test("client model catalog only projects conversation providers with protocol fields", () => {
  const catalog = createClientModelCatalog({
    providers: {
      chat: { used_for_conversation: true, model: "m/chat", description: " d ", name: "x" },
      tool: { used_for_conversation: false, model: "m/tool" },
    },
    defaultAlias: "chat",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(catalog)), {
    enabledModels: [{ alias: "chat", model: "m/chat", description: "d" }],
    defaultModelAlias: "chat",
  });
});

test("client model catalog does not derive a default outside conversation models", () => {
  const providers = { chat: { used_for_conversation: true, model: "m/chat" } };
  assert.equal(createClientModelCatalog({ providers, defaultAlias: "tool" }).defaultModelAlias, "");
  assert.equal(createClientModelCatalog({ providers }).defaultModelAlias, "");
});

test("normalizeClientModelOptions reads alias only and drops duplicates", () => {
  assert.deepEqual(
    normalizeClientModelOptions([
      { alias: "a", model: "m", value: "ignored" },
      { alias: "a", model: "dup" },
      { value: "legacy" },
      "string-option",
    ]).map((item) => ({ ...item })),
    [{ alias: "a", model: "m", description: "" }],
  );
});
