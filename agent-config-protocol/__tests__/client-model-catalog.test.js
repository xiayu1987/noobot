/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createClientModelCatalog,
  createClientModelOptions,
  normalizeClientModelOptions,
} from "../src/index.js";

test("client model catalog only projects conversation providers with protocol fields", () => {
  const catalog = createClientModelCatalog({
    providers: {
      chat: { used_for_conversation: true, model: "m/chat", description: " d ", name: "x" },
      tool: { used_for_conversation: false, model: "m/tool" },
    },
    defaultAlias: "chat",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(catalog)), {
    enabledModels: [
      {
        alias: "chat",
        model: "m/chat",
        description: "d",
        supplier: "",
        inputModalities: [],
        outputModalities: [],
      },
    ],
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
    [
      {
        alias: "a",
        model: "m",
        description: "",
        supplier: "",
        inputModalities: [],
        outputModalities: [],
      },
    ],
  );
});

test("client model catalog preserves supplier and enabled modality facts without credentials", () => {
  const catalog = createClientModelCatalog({
    providers: {
      image: {
        used_for_conversation: true,
        model: "gpt-image-2",
        supplier: "OpenAI",
        api_key: "private",
        base_url: "private",
        multimodal_parsing: { enabled: true, input_modalities: ["image", "video"] },
        multimodal_generation: { support_generation: { enabled: true, support_scope: ["image"] } },
      },
      disabled: {
        used_for_conversation: true,
        model: "gemini-test",
        supplier: "Google",
        multimodal_generation: { support_generation: { enabled: false, support_scope: ["video"] } },
      },
    },
  });
  const options = normalizeClientModelOptions(catalog.enabledModels);
  assert.equal(options[0].supplier, "OpenAI");
  assert.deepEqual(options[0].inputModalities, ["image", "video"]);
  assert.deepEqual(options[0].outputModalities, ["image"]);
  assert.equal(options[1].supplier, "Google");
  assert.deepEqual(options[1].outputModalities, []);
  assert.equal(JSON.stringify(options).includes("private"), false);
});

test("supplier is declared and never inferred from a model name", () => {
  const options = createClientModelOptions({
    custom: { model: "gpt-image-2", supplier: "Private lab" },
    undeclared: { model: "gemini-test" },
  });
  assert.equal(options[0].supplier, "Private lab");
  assert.equal(options[1].supplier, "");
});

test("model reference requirements filter declared capabilities and reject unknown requirements", () => {
  const providers = {
    chat: { model: "chat", used_for_conversation: true },
    vision: {
      model: "vision",
      multimodal_parsing: { enabled: true, input_modalities: ["image", "document"] },
    },
    video: {
      model: "video",
      multimodal_generation: { support_generation: { enabled: true, support_scope: ["video"] } },
    },
    disabled: {
      model: "disabled",
      multimodal_generation: { support_generation: { enabled: false, support_scope: ["video"] } },
    },
  };
  const aliases = (requirement) =>
    createClientModelOptions(providers, requirement).map(({ alias }) => alias);
  assert.deepEqual(aliases("conversation"), ["chat"]);
  assert.deepEqual(aliases("parse:image"), ["vision"]);
  assert.deepEqual(aliases("parse:document"), ["vision"]);
  assert.deepEqual(aliases("generate:video"), ["video"]);
  assert.deepEqual(aliases("generate:image"), []);
  assert.equal(aliases("model").length, 4);
  assert.throws(() => aliases("generate:unknown"), /unsupported model reference requirement/);
});
