/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from "vitest";
import {
  buildConfigNavTree,
  configEntryNodes,
  configLeafFields,
  defaultValueForConfigNode,
  ensureConfigNavContainer,
  findConfigNavNode,
  findConfigNavTrail,
  firstConfigNavPath,
  isConfigContainerNode,
  isConfigGroupNode,
  resolveConfigNavContainer,
  resolveConfigNavParent,
} from "../../../../src/modules/settings/state/configNavigation.js";
import { CONFIG_FORM_NODE_KIND } from "../../../../src/modules/settings/state/configStructureContract.js";

function documentFixture() {
  return {
    default_provider: "p1",
    providers: {
      p1: { model: "m1", temperature: 0.5 },
      p2: { model: "m2" },
    },
    plugins: { character: { characterAssets: [{ id: "a1", path: "p" }] } },
  };
}

describe("configNavigation", () => {
  it("builds a nav tree whose group nodes track document presence", () => {
    const tree = buildConfigNavTree(documentFixture());
    const providers = tree.find((navNode) => navNode.key === "providers");
    expect(providers.exists).toBe(true);
    expect(providers.children.map((child) => child.path)).toEqual(["providers/p1", "providers/p2"]);
    const absent = tree.find((navNode) => navNode.key === "mcp_servers");
    expect(absent.exists).toBe(false);
  });

  it("keeps leaf fields out of the nav tree and only nests group children", () => {
    const tree = buildConfigNavTree(documentFixture());
    const providerEntry = findConfigNavNode(tree, "providers/p1");
    const childKeys = providerEntry.children.map((child) => child.key);
    expect(childKeys).not.toContain("capabilities");
    expect(childKeys).not.toContain("model");
    expect(childKeys).not.toContain("temperature");
    expect(providerEntry.children.every((child) => isConfigGroupNode(child.node))).toBe(true);
    expect(configLeafFields(providerEntry.node).map((field) => field.key)).toContain("model");
  });

  it("resolves a trail across nested collections and arrays", () => {
    const tree = buildConfigNavTree(documentFixture());
    const trail = findConfigNavTrail(tree, "plugins/character/characterAssets/0");
    expect(trail.map((navNode) => navNode.key)).toEqual([
      "plugins",
      "character",
      "characterAssets",
      0,
    ]);
    expect(firstConfigNavPath(tree)).toBe(tree[0].path);
    expect(findConfigNavTrail(tree, "")).toEqual([]);
    expect(findConfigNavNode(tree, "providers/missing")).toBeNull();
  });

  it("reads containers and parents along a trail without mutating the document", () => {
    const document = documentFixture();
    const tree = buildConfigNavTree(document);
    const trail = findConfigNavTrail(tree, "providers/p1");
    expect(resolveConfigNavContainer(document, trail)).toEqual({ model: "m1", temperature: 0.5 });
    expect(resolveConfigNavParent(document, trail)).toBe(document.providers);
    const missingTrail = findConfigNavTrail(buildConfigNavTree({}), "providers");
    expect(resolveConfigNavContainer({}, missingTrail)).toBeUndefined();
  });

  it("binds a top-level scalar editor to the document instead of replacing its value", () => {
    const document = documentFixture();
    const tree = buildConfigNavTree(document);
    const trail = findConfigNavTrail(tree, "default_provider");
    expect(resolveConfigNavContainer(document, trail)).toBe(document);
    expect(ensureConfigNavContainer(document, trail)).toBe(document);
    expect(document.default_provider).toBe("p1");
  });

  it("materialises missing object containers but reads array slots as-is", () => {
    const document = {};
    const tree = buildConfigNavTree(document);
    const providersTrail = findConfigNavTrail(tree, "providers");
    expect(ensureConfigNavContainer(document, providersTrail)).toEqual({});
    expect(document.providers).toEqual({});

    const arrayDocument = { plugins: { character: {} } };
    const arrayTrail = findConfigNavTrail(
      buildConfigNavTree({ plugins: { character: { characterAssets: [] } } }),
      "plugins/character/characterAssets",
    );
    expect(ensureConfigNavContainer(arrayDocument, arrayTrail)).toEqual([]);
    expect(arrayDocument.plugins.character.characterAssets).toEqual([]);
  });

  it("classifies node kinds and their default values", () => {
    expect(isConfigGroupNode({ kind: CONFIG_FORM_NODE_KIND.OBJECT })).toBe(true);
    expect(isConfigGroupNode({ kind: CONFIG_FORM_NODE_KIND.BOOLEAN })).toBe(false);
    expect(isConfigContainerNode({ kind: CONFIG_FORM_NODE_KIND.COLLECTION })).toBe(true);
    expect(isConfigContainerNode({ kind: CONFIG_FORM_NODE_KIND.OBJECT })).toBe(false);
    expect(defaultValueForConfigNode({ kind: CONFIG_FORM_NODE_KIND.ARRAY })).toEqual([]);
    expect(defaultValueForConfigNode({ kind: CONFIG_FORM_NODE_KIND.RAW })).toEqual({});
    expect(defaultValueForConfigNode({ kind: CONFIG_FORM_NODE_KIND.BOOLEAN })).toBe(false);
    expect(defaultValueForConfigNode({ kind: CONFIG_FORM_NODE_KIND.STRING })).toBe("");
  });

  it("returns no entry nodes when the stored value shape does not match the node kind", () => {
    expect(configEntryNodes({ kind: CONFIG_FORM_NODE_KIND.COLLECTION, entry: {} }, [])).toEqual([]);
    expect(configEntryNodes({ kind: CONFIG_FORM_NODE_KIND.ARRAY, item: {} }, {})).toEqual([]);
    expect(configLeafFields({ kind: CONFIG_FORM_NODE_KIND.COLLECTION })).toEqual([]);
  });

  it("keeps only user-editable provider fields in config.json declaration order", () => {
    const tree = buildConfigNavTree(documentFixture());
    const providerEntry = findConfigNavNode(tree, "providers/p1");
    const keys = configLeafFields(providerEntry.node).map((field) => field.key);
    expect(keys.slice(0, 6)).toEqual([
      "enabled",
      "used_for_conversation",
      "api_key",
      "base_url",
      "model",
      "description",
    ]);
    expect(keys).toContain("reasoning_effort");
    expect(keys).not.toContain("reasoning_effort_options");
    expect(keys).toContain("prompt_cache_fields");
    expect(keys).not.toContain("prompt_cache_key");
    expect(keys).not.toContain("prompt_cache_options");
    expect(keys).not.toContain("prompt_cache_retention");
    expect(keys).not.toContain("cache_control");
    expect(keys).not.toContain("use_responses_api");

    const cacheFields = configLeafFields(providerEntry.node).find(
      (field) => field.key === "prompt_cache_fields",
    );
    expect(cacheFields).toMatchObject({
      kind: CONFIG_FORM_NODE_KIND.ENUM_LIST,
      options: [
        "prompt_cache_key",
        "prompt_cache_options",
        "prompt_cache_retention",
        "cache_control",
      ],
    });
  });
});
