/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../src/extensions/create-plugin-context.js";

describe("plugin context", () => {
  it("isolates reads and merges patches inside the plugin namespace", () => {
    let root = {
      harness: { enabled: true, nested: { keep: true } },
      workflow: { semanticModel: "m1" },
    };
    const updateConfig = vi.fn((next) => {
      root = next;
    });
    const context = createPluginContext({
      pluginId: "harness",
      getConfig: () => root,
      updateConfig,
    });

    expect(context.config.get()).toEqual({ enabled: true, nested: { keep: true } });
    context.config.patch({ enabled: false, model: "m2" });

    expect(root).toEqual({
      harness: { enabled: false, nested: { keep: true }, model: "m2" },
      workflow: { semanticModel: "m1" },
    });
    expect(updateConfig).toHaveBeenCalledTimes(1);
  });

  it("requires a namespace and both storage dependencies", () => {
    expect(() => createPluginContext()).toThrow(TypeError);
    expect(() => createPluginContext({})).toThrow("plugin context id is required");
    expect(() => createPluginContext({ pluginId: "workflow" })).toThrow(
      "requires function dependencies: getConfig, updateConfig",
    );
    expect(() => createPluginContext({ pluginId: "workflow", getConfig: () => ({}) })).toThrow(
      "requires function dependencies: updateConfig",
    );
    expect(() => createPluginContext({ pluginId: "workflow", updateConfig: vi.fn() })).toThrow(
      "requires function dependencies: getConfig",
    );
  });

  it("creates an absent namespace without changing other plugins", () => {
    let root = { harness: { enabled: true } };
    const context = createPluginContext({
      pluginId: "workflow",
      getConfig: () => root,
      updateConfig: (next) => {
        root = next;
      },
    });
    expect(context.config.get()).toEqual({});
    context.config.patch({ semanticModel: "m1" });
    expect(context.config.get()).toEqual({ semanticModel: "m1" });
    expect(root.harness).toEqual({ enabled: true });
  });

  it.each([undefined, null, [], "invalid", 42])("rejects an invalid root %j", (root) => {
    const updateConfig = vi.fn();
    const context = createPluginContext({
      pluginId: "workflow",
      getConfig: () => root,
      updateConfig,
    });
    expect(() => context.config.get()).toThrow("plugin config root must be an object");
    expect(() => context.config.patch({ semanticModel: "m1" })).toThrow(
      "plugin config root must be an object",
    );
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it.each([undefined, null, [], "invalid", 42])("rejects an invalid namespace %j", (value) => {
    const updateConfig = vi.fn();
    const context = createPluginContext({
      pluginId: "workflow",
      getConfig: () => ({ workflow: value }),
      updateConfig,
    });
    expect(() => context.config.get()).toThrow("plugin config workflow must be an object");
    expect(() => context.config.patch({ semanticModel: "m1" })).toThrow(
      "plugin config workflow must be an object",
    );
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it.each([undefined, null, [], "invalid", 42])("rejects an invalid patch %j", (patch) => {
    const updateConfig = vi.fn();
    const context = createPluginContext({
      pluginId: "workflow",
      getConfig: () => ({}),
      updateConfig,
    });
    expect(() => context.config.patch(patch)).toThrow("plugin config patch must be an object");
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("propagates storage read and write failures", () => {
    const readError = new Error("storage read failed");
    const readContext = createPluginContext({
      pluginId: "workflow",
      getConfig: () => {
        throw readError;
      },
      updateConfig: vi.fn(),
    });
    expect(() => readContext.config.get()).toThrow(readError);
    expect(() => readContext.config.patch({})).toThrow(readError);

    const writeError = new Error("storage write failed");
    const writeContext = createPluginContext({
      pluginId: "workflow",
      getConfig: () => ({}),
      updateConfig: () => {
        throw writeError;
      },
    });
    expect(() => writeContext.config.patch({})).toThrow(writeError);
  });
});
