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
  findConfigNavTrail,
  firstConfigNavPath,
  isConfigContainerNode,
  isConfigGroupNode,
  resolveConfigNavContainer,
} from "../../../../src/modules/settings/state/configNavigation.js";
import { CONFIG_FORM_NODE_KIND } from "../../../../src/modules/settings/state/configStructureContract.js";

function documentFixture() {
  return {
    default_provider: "p1",
    providers: {
      p1: { model: "m1", temperature: 0.5 },
      p2: { model: "m2" },
    },
    plugins: { character: { selectedCharacterAssetIds: ["a1"] } },
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

  it("resolves a trail across nested objects and keeps list fields as leaves", () => {
    const tree = buildConfigNavTree(documentFixture());
    const trail = findConfigNavTrail(tree, "plugins/character");
    expect(trail.map((navNode) => navNode.key)).toEqual(["plugins", "character"]);
    const character = trail[trail.length - 1];
    expect(character.children.map((child) => child.key)).not.toContain("selectedCharacterAssetIds");
    expect(configLeafFields(character.node).map((field) => field.key)).toContain(
      "selectedCharacterAssetIds",
    );
    expect(firstConfigNavPath(tree)).toBe(tree[0].path);
    expect(findConfigNavTrail(tree, "")).toEqual([]);
  });

  it("reads containers and parents along a trail without mutating the document", () => {
    const document = documentFixture();
    const tree = buildConfigNavTree(document);
    const trail = findConfigNavTrail(tree, "providers/p1");
    expect(resolveConfigNavContainer(document, trail)).toEqual({ model: "m1", temperature: 0.5 });
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

  it("materialises missing object containers along a trail", () => {
    const document = {};
    const tree = buildConfigNavTree(document);
    const providersTrail = findConfigNavTrail(tree, "providers");
    expect(ensureConfigNavContainer(document, providersTrail)).toEqual({});
    expect(document.providers).toEqual({});

    const pluginDocument = {};
    const characterTrail = findConfigNavTrail(
      buildConfigNavTree(pluginDocument),
      "plugins/character",
    );
    expect(ensureConfigNavContainer(pluginDocument, characterTrail)).toEqual({});
    expect(pluginDocument).toEqual({ plugins: { character: {} } });
  });

  it("classifies node kinds and their default values", () => {
    expect(isConfigGroupNode({ kind: CONFIG_FORM_NODE_KIND.OBJECT })).toBe(true);
    expect(isConfigGroupNode({ kind: CONFIG_FORM_NODE_KIND.BOOLEAN })).toBe(false);
    expect(isConfigContainerNode({ kind: CONFIG_FORM_NODE_KIND.COLLECTION })).toBe(true);
    expect(isConfigContainerNode({ kind: CONFIG_FORM_NODE_KIND.OBJECT })).toBe(false);
    expect(defaultValueForConfigNode({ kind: CONFIG_FORM_NODE_KIND.STRING_LIST })).toEqual([]);
    expect(defaultValueForConfigNode({ kind: CONFIG_FORM_NODE_KIND.RAW })).toEqual({});
    expect(defaultValueForConfigNode({ kind: CONFIG_FORM_NODE_KIND.BOOLEAN })).toBe(false);
    expect(defaultValueForConfigNode({ kind: CONFIG_FORM_NODE_KIND.STRING })).toBe("");
  });

  it("returns no entry nodes when the stored value shape does not match the node kind", () => {
    expect(configEntryNodes({ kind: CONFIG_FORM_NODE_KIND.COLLECTION, entry: {} }, [])).toEqual([]);
    expect(configEntryNodes({ kind: CONFIG_FORM_NODE_KIND.OBJECT, children: [] }, {})).toEqual([]);
    expect(configLeafFields({ kind: CONFIG_FORM_NODE_KIND.COLLECTION })).toEqual([]);
  });
});
