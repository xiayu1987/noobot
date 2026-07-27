/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../src/extensions/create-plugin-context.js";

describe("plugin context", () => {
  it("isolates reads and merges patches inside the plugin namespace", () => {
    let root = { harness: { enabled: true, nested: { keep: true } }, workflow: { semanticModel: "m1" } };
    const updateConfig = vi.fn((next) => { root = next; });
    const context = createPluginContext({ pluginId: "harness", getConfig: () => root, updateConfig });

    expect(context.config.get()).toEqual({ enabled: true, nested: { keep: true } });
    context.config.patch({ enabled: false, model: "m2" });

    expect(root).toEqual({
      harness: { enabled: false, nested: { keep: true }, model: "m2" },
      workflow: { semanticModel: "m1" },
    });
    expect(updateConfig).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty namespace and tolerates unavailable storage", () => {
    expect(() => createPluginContext()).toThrow("plugin context id is required");
    const context = createPluginContext({ pluginId: "workflow" });
    expect(context.config.get()).toEqual({});
    expect(() => context.config.patch({ semanticModel: "m1" })).not.toThrow();
  });
});
