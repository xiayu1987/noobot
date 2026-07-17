/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ON_PLUGINS_STORAGE_KEY,
  SELECTED_PLUGINS_STORAGE_KEY,
  getDefaultOnPluginKeys,
  hasStoredSelectedPluginKeys,
  loadSelectedPluginKeys,
  normalizeAvailablePlugins,
  persistDefaultOnPluginKeys,
  persistSelectedPlugins,
  safeParseStringArray,
  syncSelectedPluginsWithConfig,
} from "../../../src/app/state/pluginSelectionState";

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
    expect(hasStoredSelectedPluginKeys()).toBe(false);
    expect(loadSelectedPluginKeys()).toEqual([]);

    localStorage.setItem(SELECTED_PLUGINS_STORAGE_KEY, '["workflow"," ","harness"]');

    expect(hasStoredSelectedPluginKeys()).toBe(true);
    expect(loadSelectedPluginKeys()).toEqual(["workflow", "harness"]);
  });

  it("normalizes enabled plugin definitions for composer options", () => {
    expect(
      normalizeAvailablePlugins({
        workflow: {
          label: " Workflow ",
          description: " Runs workflow ",
          enabled: true,
          mode: " ON ",
        },
        harness: {
          name: "Harness",
          enabled: true,
          mode: "off",
        },
        disabled: {
          label: "Disabled",
          enabled: false,
          mode: "on",
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
        mode: "on",
      },
      {
        key: "harness",
        label: "Harness",
        description: "",
        enabled: true,
        mode: "off",
      },
    ]);
  });

  it("persists selected keys and unique default-on plugin keys", () => {
    const hasStoredSelectedPlugins = { value: false };
    const selectedPlugins = { value: [" workflow ", "", "harness"] };

    persistSelectedPlugins({ selectedPlugins, hasStoredSelectedPlugins });
    persistDefaultOnPluginKeys(["workflow", " workflow ", "", "harness"]);

    expect(hasStoredSelectedPlugins.value).toBe(true);
    expect(localStorage.getItem(SELECTED_PLUGINS_STORAGE_KEY)).toBe(
      JSON.stringify([" workflow ", "", "harness"]),
    );
    expect(localStorage.getItem(DEFAULT_ON_PLUGINS_STORAGE_KEY)).toBe(
      JSON.stringify(["workflow", "harness"]),
    );
  });

  it("syncs unstored selections to default-on plugins without persisting selected plugins", () => {
    const selectedPlugins = { value: [] };
    const hasStoredSelectedPlugins = { value: false };
    const pluginOptions = [
      { key: "workflow", enabled: true, mode: "on" },
      { key: "harness", enabled: true, mode: "off" },
    ];

    syncSelectedPluginsWithConfig({ pluginOptions, selectedPlugins, hasStoredSelectedPlugins });

    expect(selectedPlugins.value).toEqual(["workflow"]);
    expect(localStorage.getItem(DEFAULT_ON_PLUGINS_STORAGE_KEY)).toBe(JSON.stringify(["workflow"]));
    expect(localStorage.getItem(SELECTED_PLUGINS_STORAGE_KEY)).toBe(null);
  });

  it("keeps valid stored selections and adds newly default-on plugins", () => {
    localStorage.setItem(DEFAULT_ON_PLUGINS_STORAGE_KEY, JSON.stringify(["workflow"]));
    const selectedPlugins = { value: ["workflow", "disabled", "missing"] };
    const hasStoredSelectedPlugins = { value: true };
    const pluginOptions = [
      { key: "workflow", enabled: true, mode: "on" },
      { key: "harness", enabled: true, mode: "on" },
      { key: "disabled", enabled: false, mode: "on" },
    ];

    syncSelectedPluginsWithConfig({ pluginOptions, selectedPlugins, hasStoredSelectedPlugins });

    expect(getDefaultOnPluginKeys(pluginOptions)).toEqual(["workflow", "harness"]);
    expect(selectedPlugins.value).toEqual(["workflow", "harness"]);
    expect(localStorage.getItem(DEFAULT_ON_PLUGINS_STORAGE_KEY)).toBe(
      JSON.stringify(["workflow", "harness"]),
    );
    expect(localStorage.getItem(SELECTED_PLUGINS_STORAGE_KEY)).toBe(
      JSON.stringify(["workflow", "harness"]),
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
