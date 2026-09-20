/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from "vitest";
import {
  USER_CONFIG_SECTIONS,
  buildConfigFormTree,
} from "../../../../src/modules/settings/state/configStructureContract.js";
import {
  hasConfigReferenceSource,
  resolveConfigFieldOptions,
  resolveConfigReferenceOptions,
} from "../../../../src/modules/settings/state/configReferenceOptions.js";
import { CONFIG_DOCUMENT_SCOPE } from "@noobot/agent-config-protocol";
import {
  buildConfigDocumentForSave,
  cloneConfigDocument,
} from "../../../../src/modules/settings/state/configDocumentState.js";

function findNode(node, path) {
  if (!node) return null;
  if (node.path === path) return node;
  for (const child of node.children || []) {
    const found = findNode(child, path);
    if (found) return found;
  }
  if (node.entry) {
    const found = findNode(node.entry, path);
    if (found) return found;
  }
  return null;
}

const userTree = buildConfigFormTree(CONFIG_DOCUMENT_SCOPE.USER);

describe("user config builtin sections", () => {
  it("hides builtin sections from the user form", () => {
    const keys = USER_CONFIG_SECTIONS.map((section) => section.key);
    expect(keys).not.toContain("session");
    expect(keys).not.toContain("context");
    expect(keys).not.toContain("attachments");
    expect(keys).not.toContain("memory");
    expect(keys).not.toContain("desktop");
  });

  it("keeps explicit user sections", () => {
    const keys = USER_CONFIG_SECTIONS.map((section) => section.key);
    expect(keys).toContain("providers");
    expect(keys).toContain("scenarios");
    expect(keys).toContain("preferences");
  });
});

describe("contract enum declarations", () => {
  it("renders plugin mode as an enum", () => {
    const node = findNode(userTree, "plugins.harness.mode");
    expect(node.kind).toBe("enum");
    expect(node.options).toEqual(["on", "off"]);
  });

  it("renders preference language as an enum", () => {
    const node = findNode(userTree, "preferences.language");
    expect(node.kind).toBe("enum");
    expect(node.options).toEqual(["zh-CN", "en-US"]);
  });
});

describe("resolveConfigReferenceOptions", () => {
  const document = {
    providers: { alpha: {}, beta: {} },
    scenarios: { definitions: { chat: {}, coding: {} } },
  };

  it("resolves model references from document providers", () => {
    const node = findNode(userTree, "default_provider");
    expect(hasConfigReferenceSource(node)).toBe(true);
    expect(resolveConfigReferenceOptions(node, document)).toEqual(["alpha", "beta"]);
  });

  it("resolves document references from the declared source path", () => {
    const node = findNode(userTree, "scenarios.default");
    expect(resolveConfigReferenceOptions(node, document)).toEqual(["chat", "coding"]);
  });

  it("resolves model references inside reference collections", () => {
    const node = findNode(userTree, "plugins.harness.stepModels.*");
    expect(resolveConfigReferenceOptions(node, document)).toEqual(["alpha", "beta"]);
  });

  it("returns an empty list for plain fields", () => {
    const node = findNode(userTree, "preferences.language");
    expect(hasConfigReferenceSource(node)).toBe(false);
    expect(resolveConfigReferenceOptions(node, document)).toEqual([]);
  });

  it("returns an empty list when the source container is missing", () => {
    const node = findNode(userTree, "default_provider");
    expect(resolveConfigReferenceOptions(node, {})).toEqual([]);
  });

  it("resolves reasoning effort from the fixed options declared by the same provider", () => {
    const node = findNode(userTree, "providers.*.reasoning_effort");
    const provider = { reasoning_effort_options: ["none", "low", "high"] };
    expect(resolveConfigFieldOptions(node, provider, document)).toEqual(["none", "low", "high"]);
    expect(hasConfigReferenceSource(node)).toBe(false);
  });

  it("prefers fixed options from the read-only system declaration", () => {
    const node = findNode(userTree, "providers.*.reasoning_effort");
    const provider = { reasoning_effort_options: ["legacy"] };
    const declaration = { reasoning_effort_options: ["none", "medium", "high"] };
    expect(resolveConfigFieldOptions(node, provider, document, declaration)).toEqual([
      "none",
      "medium",
      "high",
    ]);
  });

  it("offers every compatible cache field in the model-family protocol", () => {
    const node = findNode(userTree, "providers.*.prompt_cache_fields");
    expect(resolveConfigFieldOptions(node, { model: "gpt-5.6-sol" }, document)).toEqual([
      "prompt_cache_key",
      "prompt_cache_options",
      "prompt_cache_retention",
    ]);
    expect(resolveConfigFieldOptions(node, { model: "gpt-5.5" }, document)).toEqual([
      "prompt_cache_key",
      "prompt_cache_options",
      "prompt_cache_retention",
    ]);
    expect(resolveConfigFieldOptions(node, { model: "claude-opus-5" }, document)).toEqual([
      "cache_control",
    ]);
    expect(resolveConfigFieldOptions(node, { model: "qwen3-coder-plus" }, document)).toEqual([
      "prompt_cache_key",
      "prompt_cache_options",
      "prompt_cache_retention",
      "cache_control",
    ]);
    expect(resolveConfigFieldOptions(node, { model: "qwen3.5-omni-plus" }, document)).toEqual([
      "prompt_cache_key",
      "prompt_cache_options",
      "prompt_cache_retention",
      "cache_control",
    ]);
    expect(resolveConfigFieldOptions(node, { model: "gemini-3" }, document)).toEqual([
      "prompt_cache_key",
      "prompt_cache_options",
      "prompt_cache_retention",
    ]);
    expect(resolveConfigFieldOptions(node, { model: "kimi-k3" }, document)).toEqual([
      "prompt_cache_key",
      "prompt_cache_options",
      "prompt_cache_retention",
    ]);
  });
});

describe("hidden builtin sections on save", () => {
  it("removes existing builtin values from the user document", () => {
    const document = {
      session: { executionBundleTimeoutMs: 120000 },
      context: { promptSections: ["*"] },
      default_provider: "p1",
      providers: { p1: { model: "m1" } },
    };
    const saved = buildConfigDocumentForSave(document, cloneConfigDocument(document));
    expect(saved.session).toBeUndefined();
    expect(saved.context).toBeUndefined();
    expect(saved.default_provider).toBe("p1");
  });
});
