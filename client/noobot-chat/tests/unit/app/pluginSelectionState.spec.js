/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SELECTED_PLUGINS_STORAGE_KEY,
  hasStoredSelectedPluginKeys,
  loadSelectedPluginKeys,
  normalizeAvailablePlugins,
  persistSelectedPlugins,
  safeParseStringArray,
  selectedPluginsStorageKey,
  syncSelectedPluginsWithConfig,
} from "../../../src/app/state/pluginSelectionState.js";

describe("plugin selection state", () => {
  const storage = new Map();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key) => (storage.has(key) ? storage.get(key) : null)),
      setItem: vi.fn((key, value) => storage.set(key, String(value))),
    });
  });

  it("parses string arrays from storage defensively", () => {
    expect(safeParseStringArray('[" workflow ", "", 42, null, "harness"]')).toEqual([
      "workflow",
      "42",
      "harness",
    ]);
    expect(safeParseStringArray("not-json")).toEqual([]);
    expect(safeParseStringArray('{"workflow":true}')).toEqual([]);
  });

  it("loads selected plugin keys and detects whether the user has stored a selection", () => {
    expect(hasStoredSelectedPluginKeys("xiayu")).toBe(false);
    expect(loadSelectedPluginKeys("xiayu")).toEqual([]);

    localStorage.setItem(selectedPluginsStorageKey("xiayu"), '["workflow"," ","harness"]');

    expect(hasStoredSelectedPluginKeys("xiayu")).toBe(true);
    expect(loadSelectedPluginKeys("xiayu")).toEqual(["workflow", "harness"]);
    expect(loadSelectedPluginKeys("admin")).toEqual([]);
  });

  it("normalizes enabled plugin definitions for composer options", () => {
    expect(
      normalizeAvailablePlugins({
        workflow: {
          label: " Workflow ",
          description: " Runs workflow ",
          enabled: true,
          mode: "off",
        },
        harness: {
          name: "Harness",
          enabled: true,
          mode: " ON ",
        },
        disabled: {
          label: "Disabled",
          enabled: false,
        },
        " ": {
          enabled: true,
        },
      }),
    ).toEqual([
      {
        key: "workflow",
        label: "Workflow",
        description: "Runs workflow",
        enabled: true,
        selectedByDefault: false,
      },
      {
        key: "harness",
        label: "Harness",
        description: "",
        enabled: true,
        selectedByDefault: true,
      },
    ]);
  });

  it("persists selected keys for one authenticated user", () => {
    const hasStoredSelectedPlugins = { value: false };
    const selectedPlugins = { value: [" workflow ", "", "harness"] };

    persistSelectedPlugins({ userId: "xiayu", selectedPlugins, hasStoredSelectedPlugins });

    expect(hasStoredSelectedPlugins.value).toBe(true);
    expect(localStorage.getItem(`${SELECTED_PLUGINS_STORAGE_KEY}:xiayu`)).toBe(
      JSON.stringify([" workflow ", "", "harness"]),
    );
    expect(localStorage.getItem(`${SELECTED_PLUGINS_STORAGE_KEY}:admin`)).toBe(null);
  });

  it("initializes and persists an unstored selection from backend plugin defaults", () => {
    const selectedPlugins = { value: [] };
    const hasStoredSelectedPlugins = { value: false };
    const pluginOptions = [
      { key: "workflow", enabled: true, selectedByDefault: false },
      { key: "harness", enabled: true, selectedByDefault: true },
    ];

    syncSelectedPluginsWithConfig({
      pluginOptions,
      selectedPlugins,
      hasStoredSelectedPlugins,
      userId: "xiayu",
    });

    expect(selectedPlugins.value).toEqual(["harness"]);
    expect(hasStoredSelectedPlugins.value).toBe(true);
    expect(localStorage.getItem(selectedPluginsStorageKey("xiayu"))).toBe(
      JSON.stringify(["harness"]),
    );
  });

  it("persists an explicit empty default so later backend changes do not select a plugin", () => {
    const selectedPlugins = { value: [] };
    const hasStoredSelectedPlugins = { value: false };

    syncSelectedPluginsWithConfig({
      pluginOptions: [
        { key: "harness", enabled: true, selectedByDefault: false },
        { key: "workflow", enabled: true, selectedByDefault: false },
      ],
      selectedPlugins,
      hasStoredSelectedPlugins,
      userId: "xiayu",
    });

    expect(selectedPlugins.value).toEqual([]);
    expect(hasStoredSelectedPlugins.value).toBe(true);
    expect(localStorage.getItem(selectedPluginsStorageKey("xiayu"))).toBe("[]");

    syncSelectedPluginsWithConfig({
      pluginOptions: [{ key: "harness", enabled: true, selectedByDefault: true }],
      selectedPlugins,
      hasStoredSelectedPlugins,
      userId: "xiayu",
    });

    expect(selectedPlugins.value).toEqual([]);
  });

  it("keeps only explicitly selected plugins that remain available", () => {
    const selectedPlugins = { value: ["workflow", "disabled", "missing"] };
    const hasStoredSelectedPlugins = { value: true };
    const pluginOptions = [
      { key: "workflow", enabled: true, selectedByDefault: true },
      { key: "harness", enabled: true, selectedByDefault: true },
      { key: "disabled", enabled: false, selectedByDefault: true },
    ];

    syncSelectedPluginsWithConfig({
      pluginOptions,
      selectedPlugins,
      hasStoredSelectedPlugins,
      userId: "xiayu",
    });

    expect(selectedPlugins.value).toEqual(["workflow"]);
    expect(localStorage.getItem(selectedPluginsStorageKey("xiayu"))).toBe(
      JSON.stringify(["workflow"]),
    );
  });

  it("returns early before plugin config is available", () => {
    const selectedPlugins = { value: ["workflow"] };
    const hasStoredSelectedPlugins = { value: true };

    syncSelectedPluginsWithConfig({
      pluginOptions: [],
      selectedPlugins,
      hasStoredSelectedPlugins,
    });

    expect(selectedPlugins.value).toEqual(["workflow"]);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});
