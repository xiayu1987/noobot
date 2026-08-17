/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ contexts: [], manifest: Object.freeze({
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
}) }));

vi.mock("../../../src/plugins/generated/external-entries.js", () => ({
  externalFrontendPluginEntries: [{
    pluginId: captured.manifest.id,
    name: captured.manifest.name,
    version: captured.manifest.version,
    manifest: captured.manifest,
    module: {
      activate(context) {
        captured.contexts.push(context);
        return { protocolVersion: 2, pluginId: captured.manifest.id, surface: "frontend" };
      },
    },
  }],
}));

vi.mock("../../../src/extensions/extension-registry.js", () => ({
  listExtensionContributions: vi.fn(() => []),
  createExtensionRegistryGeneration: vi.fn(() => ({
    replacePlugin: vi.fn(() => []),
    removePlugin: vi.fn(),
    createGeneration: vi.fn(),
  })),
  publishExtensionRegistryGeneration: vi.fn(() => []),
}));

vi.mock("../../../src/infrastructure/http/authenticatedHttpService.js", () => ({
  createScopedAuthenticatedHttpService: vi.fn(() => Object.freeze({ get: vi.fn() })),
}));

import { registerExternalFrontendPlugins } from "../../../src/plugins/auto-register.js";

describe("external frontend plugin service boundary", () => {
  beforeEach(() => { captured.contexts.length = 0; });

  it("exposes only the declared browser host ports", async () => {
    await registerExternalFrontendPlugins();
    expect(captured.contexts).toHaveLength(1);
    const services = captured.contexts[0].services;
    expect(Object.keys(services)).toEqual(["authenticatedRequest"]);
    expect(services.attachments).toBeUndefined();
    expect(Object.isFrozen(services)).toBe(true);
    expect(captured.contexts[0].pluginMeta.protocolVersion).toBe(2);
  });
});
