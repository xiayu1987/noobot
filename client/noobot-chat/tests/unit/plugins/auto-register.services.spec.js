/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  contexts: [],
  activate: null,
  publish: vi.fn(() => []),
  manifest: Object.freeze({
  protocolVersion: 2,
  id: "security-boundary-test",
  name: "security-boundary-test",
  version: "1.0.0",
  entries: { frontend: "frontend.js" },
  contributes: { frontend: { extensions: [] } },
  requires: {
    ports: ["frontend.contribute", "authenticated_request"],
    permissions: ["http.authenticated"],
    authenticatedRoutes: ["/api/internal/test/:id"],
  },
  enabledByDefault: true,
  }),
}));

vi.mock("../../../src/plugins/generated/external-entries.js", () => ({
  externalFrontendPluginEntries: [{
    pluginId: captured.manifest.id,
    name: captured.manifest.name,
    version: captured.manifest.version,
    manifest: captured.manifest,
    module: {
      activate(context) {
        captured.contexts.push(context);
        if (typeof captured.activate === "function") return captured.activate(context);
        return { protocolVersion: 2, pluginId: captured.manifest.id, surface: "frontend" };
      },
    },
  }],
}));

vi.mock("../../../src/extensions/extension-registry.js", () => ({
  listExtensionContributions: vi.fn(() => []),
  createExtensionRegistryGeneration: vi.fn(() => {
    const generation = {
      replacePlugin: vi.fn(() => []),
      removePlugin: vi.fn(),
      createGeneration: vi.fn(),
    };
    generation.createGeneration.mockImplementation(() => generation);
    return generation;
  }),
  publishExtensionRegistryGeneration: captured.publish,
}));

vi.mock("../../../src/infrastructure/http/authenticatedHttpService.js", () => ({
  createScopedAuthenticatedHttpService: vi.fn(() => Object.freeze({ get: vi.fn() })),
}));

import {
  disposeExternalFrontendPlugins,
  registerExternalFrontendPlugins,
} from "../../../src/plugins/auto-register.js";

describe("external frontend plugin service boundary", () => {
  beforeEach(async () => {
    await disposeExternalFrontendPlugins();
    captured.contexts.length = 0;
    captured.activate = null;
    captured.publish.mockReset();
    captured.publish.mockReturnValue([]);
  });

  it("exposes only the declared browser host ports", async () => {
    await registerExternalFrontendPlugins();
    expect(captured.contexts).toHaveLength(1);
    const services = captured.contexts[0].services;
    expect(Object.keys(services)).toEqual(["authenticatedRequest"]);
    expect(services.attachments).toBeUndefined();
    expect(Object.isFrozen(services)).toBe(true);
    expect(captured.contexts[0].pluginMeta.protocolVersion).toBe(2);
  });

  it("disposes a candidate scope when registry publication fails", async () => {
    const dispose = vi.fn();
    captured.activate = () => ({
      protocolVersion: 2,
      pluginId: captured.manifest.id,
      surface: "frontend",
      dispose,
    });
    captured.publish.mockImplementationOnce(() => { throw new Error("publication failed"); });

    await expect(registerExternalFrontendPlugins()).rejects.toThrow("publication failed");
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("serializes frontend activation generations", async () => {
    let releaseFirst;
    let activations = 0;
    captured.activate = () => {
      activations += 1;
      if (activations === 1) {
        return new Promise((resolve) => {
          releaseFirst = () => resolve({
            protocolVersion: 2,
            pluginId: captured.manifest.id,
            surface: "frontend",
          });
        });
      }
      return {
        protocolVersion: 2,
        pluginId: captured.manifest.id,
        surface: "frontend",
      };
    };

    const first = registerExternalFrontendPlugins();
    const second = registerExternalFrontendPlugins();
    await vi.waitFor(() => expect(activations).toBe(1));
    releaseFirst();
    await first;
    await second;
    expect(activations).toBe(2);
  });

  it("keeps the active scope authoritative when empty-generation publication fails", async () => {
    const dispose = vi.fn();
    captured.activate = () => ({
      protocolVersion: 2,
      pluginId: captured.manifest.id,
      surface: "frontend",
      dispose,
    });
    await registerExternalFrontendPlugins();
    captured.publish.mockImplementationOnce(() => { throw new Error("empty publication failed"); });

    await expect(disposeExternalFrontendPlugins()).rejects.toThrow("empty publication failed");
    expect(dispose).not.toHaveBeenCalled();
    await disposeExternalFrontendPlugins();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
