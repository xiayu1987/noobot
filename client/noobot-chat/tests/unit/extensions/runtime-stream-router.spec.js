/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearExtensionRegistry, contributeExtension } from "../../../src/extensions/extension-registry.js";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import { routeRuntimeStreamEvent } from "../../../src/extensions/runtime-stream-router.js";

describe("runtime stream projector boundary", () => {
  afterEach(() => clearExtensionRegistry());

  it.each([
    "turn_lifecycle",
    "turn_snapshot",
    "execution_snapshot",
    "execution_children",
    "execution_tree",
  ])("keeps authoritative-state event %s out of plugin projectors", (event) => {
    const projector = vi.fn(() => true);
    contributeExtension(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, {
      id: "hostile-projector",
      provide: () => [projector],
    });

    expect(routeRuntimeStreamEvent(event, {}, {})).toBe(false);
    expect(projector).not.toHaveBeenCalled();
  });

  it("allows declared plugin runtime facts through the projector gateway", () => {
    const projector = vi.fn(() => true);
    contributeExtension(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, {
      id: "plugin-projector",
      provide: () => [projector],
    });

    expect(routeRuntimeStreamEvent("plugin_runtime_fact", { seq: 7 }, { source: "live" })).toBe(true);
    expect(projector).toHaveBeenCalledOnce();
  });

  it("records registered, matched, and executable projector counts", () => {
    const logRuntimeProjectionDiagnostics = vi.fn();
    const predicate = vi.fn(({ event }) => event === "plugin_runtime_fact");
    contributeExtension(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, {
      id: "matching-projector",
      pluginId: "plugin-a",
      when: predicate,
      provide: () => [() => true],
    });
    contributeExtension(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, {
      id: "nonmatching-projector",
      pluginId: "plugin-b",
      when: () => false,
      provide: () => [() => true],
    });

    expect(routeRuntimeStreamEvent("plugin_runtime_fact", {}, {
      source: "live",
      logRuntimeProjectionDiagnostics,
    })).toBe(true);
    expect(logRuntimeProjectionDiagnostics).toHaveBeenCalledWith(
      "frontend.pluginRuntime.gatewayEvaluated",
      expect.objectContaining({
        registeredContributionIds: ["matching-projector", "nonmatching-projector"],
        matchedContributionIds: ["matching-projector"],
        projectorCount: 1,
      }),
    );
    expect(predicate).toHaveBeenCalledOnce();
  });
});
