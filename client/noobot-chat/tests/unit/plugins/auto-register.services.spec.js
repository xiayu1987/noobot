/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ contexts: [] }));

vi.mock("../../../src/plugins/generated/external-entries.js", () => ({
  externalFrontendPluginEntries: [
    {
      pluginId: "security-boundary-test",
      name: "security-boundary-test",
      apiVersion: "1",
      authenticatedRoutePatterns: ["/api/internal/test/:id"],
      module: {
        registerFrontendPlugin(context) {
          captured.contexts.push(context);
        },
      },
    },
  ],
}));

vi.mock("../../../src/extensions/extension-registry.js", () => ({
  contributeExtension: vi.fn(),
  removePluginExtensions: vi.fn(),
}));

vi.mock("../../../src/services/authenticatedHttpService.js", () => ({
  createScopedAuthenticatedHttpService: vi.fn(() => Object.freeze({ get: vi.fn() })),
}));

import { registerExternalFrontendPlugins } from "../../../src/plugins/auto-register.js";

describe("external frontend plugin service boundary", () => {
  beforeEach(() => {
    captured.contexts.length = 0;
  });

  it("does not expose the host attachment service to plugins", async () => {
    await registerExternalFrontendPlugins();

    expect(captured.contexts).toHaveLength(1);
    const services = captured.contexts[0]?.services;
    expect(Object.keys(services)).toEqual(["authenticatedRequest"]);
    expect(services.attachments).toBeUndefined();
    expect(Object.isFrozen(services)).toBe(true);
  });
});
