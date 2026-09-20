/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from "vitest";
import { CONFIG_ITEM_TYPE, CONFIG_NODE_ACCESS } from "@noobot/agent-config-protocol";
import {
  assertConfigDocument,
  buildConfigDocumentForSave,
  parseConfigDocument,
  pruneConfigDocument,
  serializeConfigDocument,
} from "../../../../src/modules/settings/state/configDocumentState.js";
import {
  USER_CONFIG_SECTIONS,
  CONFIG_FORM_NODE_KIND,
} from "../../../../src/modules/settings/state/configStructureContract.js";

describe("configStructureContract", () => {
  it("projects the user-scope config sections from the protocol contract", () => {
    const keys = USER_CONFIG_SECTIONS.map((section) => section.key);
    expect(keys).toContain("providers");
    expect(keys).toContain("tools");
    expect(keys).toContain("scenarios");
    expect(keys).toContain("plugins");
    expect(keys).toContain("mcp_servers");
    expect(keys).toContain("preferences");
    expect(keys).not.toContain("super_admin");
    expect(keys).not.toContain("workspace_root");
    expect(keys).not.toContain("streaming");
  });

  it("exposes configurable cache policy while hiding system provider declarations", () => {
    const providers = USER_CONFIG_SECTIONS.find((section) => section.key === "providers");
    const entryKeys = providers.entry.children.map((child) => child.key);
    expect(entryKeys).not.toContain("extra_body");
    expect(entryKeys).not.toContain("use_responses_api");
    expect(entryKeys).toContain("prompt_cache_fields");
    expect(entryKeys).not.toContain("prompt_cache_key");
    expect(entryKeys).not.toContain("prompt_cache_options");
    expect(entryKeys).not.toContain("prompt_cache_retention");
    expect(entryKeys).not.toContain("cache_control");
    expect(entryKeys).not.toContain("capabilities");
    expect(entryKeys).not.toContain("multimodal_parsing");
    expect(entryKeys).not.toContain("multimodal_generation");
    expect(entryKeys).not.toContain("reasoning_effort_options");
    expect(entryKeys).not.toContain("reasoning_effort_parameter");
  });

  it("hides builtin sections from the user form", () => {
    const keys = USER_CONFIG_SECTIONS.map((section) => section.key);
    expect(keys).not.toContain("context");
    expect(keys).not.toContain("session");
  });

  it("descends into the delegated model provider contract", () => {
    const providers = USER_CONFIG_SECTIONS.find((section) => section.key === "providers");
    expect(providers.kind).toBe(CONFIG_FORM_NODE_KIND.COLLECTION);
    expect(providers.entry).toMatchObject({
      itemType: CONFIG_ITEM_TYPE.EXPLICIT,
      access: CONFIG_NODE_ACCESS.USER,
    });
    const entryKeys = providers.entry.children.map((child) => child.key);
    expect(entryKeys).toContain("model");
    expect(entryKeys).toContain("api_key");
    expect(entryKeys).toContain("reasoning_effort");
    expect(entryKeys).toContain("tool_reasoning_effort");
    expect(providers.entry.children.find((child) => child.key === "model")).toMatchObject({
      required: true,
      itemType: CONFIG_ITEM_TYPE.EXPLICIT,
      access: CONFIG_NODE_ACCESS.USER,
    });
    expect(
      providers.entry.children.find((child) => child.key === "reasoning_effort"),
    ).toMatchObject({
      kind: CONFIG_FORM_NODE_KIND.STRING,
      optionsField: "reasoning_effort_options",
    });
  });
});

describe("configDocumentState", () => {
  it("rejects non-object documents", () => {
    expect(() => parseConfigDocument("[]")).toThrowError(/must be an object/);
    expect(() => parseConfigDocument("{oops}")).toThrowError(/JSON parse error/);
  });

  it("drops sections outside the user contract before save", () => {
    const document = parseConfigDocument(
      JSON.stringify({ providers: { p1: { model: "m" } }, unknown_section: { keep: true } }),
    );
    const pruned = pruneConfigDocument(document);
    const saved = buildConfigDocumentForSave(pruned);
    expect(saved.unknown_section).toBeUndefined();
    expect(saved.providers.p1.model).toBe("m");
  });

  it("prunes empty values and empty containers the form materialized", () => {
    const pruned = pruneConfigDocument({
      providers: { p1: { model: "m", api_key: "" } },
      preferences: {},
      services: {},
    });
    expect(pruned.providers.p1).toEqual({ model: "m" });
    expect(pruned.preferences).toBeUndefined();
    expect(pruned.services).toBeUndefined();
  });

  it("reports missing required fields with the offending path", () => {
    let error;
    try {
      buildConfigDocumentForSave({ providers: { p1: { api_key: "k" } } });
    } catch (caught) {
      error = caught;
    }
    expect(error?.code).toBe("MISSING_CONFIG_FIELD");
    expect(error?.field).toBe("providers.p1.model");
  });

  it("rejects invalid collection entry keys", () => {
    let error;
    try {
      assertConfigDocument({ providers: { "bad key": { model: "m" } } });
    } catch (caught) {
      error = caught;
    }
    expect(error?.code).toBe("INVALID_CONFIG_ENTRY_KEY");
  });

  it("rejects empty values on non-empty string fields", () => {
    let error;
    try {
      assertConfigDocument({ scenarios: { default: "  " } });
    } catch (caught) {
      error = caught;
    }
    expect(error?.code).toBe("EMPTY_CONFIG_FIELD");
    expect(error?.field).toBe("scenarios.default");
  });

  it("serializes with a trailing newline", () => {
    expect(serializeConfigDocument({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});

describe("configDocumentState baseline-aware prune", () => {
  it("keeps baseline user values while removing internal and unsupported values", () => {
    const loaded = parseConfigDocument(
      JSON.stringify({
        providers: {
          p1: { model: "m", multimodal_parsing: { input_modalities: [] } },
        },
        services: {
          weather_service: {
            api_key: "",
            handler: "weather",
            endpoints: { current: { url: "/current" } },
          },
        },
        plugins: { character: { characterAssets: [] } },
      }),
    );
    const baseline = JSON.parse(JSON.stringify(loaded));
    const saved = buildConfigDocumentForSave(loaded, baseline);
    expect(saved).toEqual({
      providers: { p1: { model: "m" } },
      services: {
        weather_service: {
          api_key: "",
          handler: "weather",
          endpoints: { current: { url: "/current" } },
        },
      },
      plugins: { character: { characterAssets: [] } },
    });
  });

  it("removes internal provider declarations from the user document", () => {
    const loaded = parseConfigDocument(
      JSON.stringify({
        providers: {
          p1: {
            model: "m",
            reasoning_effort: "high",
            reasoning_effort_options: ["low", "high"],
            reasoning_effort_parameter: "reasoning_effort",
            use_responses_api: true,
            prompt_cache_fields: ["prompt_cache_key", "cache_control"],
            prompt_cache_key: "legacy-key",
            prompt_cache_options: { ttl: "30m" },
            cache_control: { type: "ephemeral" },
            capabilities: { reasoning: true, tools: true },
          },
        },
      }),
    );
    const saved = buildConfigDocumentForSave(loaded, JSON.parse(JSON.stringify(loaded)));
    expect(saved).toEqual({
      providers: {
        p1: {
          model: "m",
          reasoning_effort: "high",
          prompt_cache_fields: ["prompt_cache_key", "cache_control"],
        },
      },
    });
  });

  it("still drops empty keys the form materialized outside the baseline", () => {
    const baseline = { providers: { p1: { model: "m" } } };
    const edited = {
      providers: { p1: { model: "m", api_key: "" } },
      preferences: {},
    };
    const saved = buildConfigDocumentForSave(edited, baseline);
    expect(saved.providers.p1).toEqual({ model: "m" });
    expect(saved.preferences).toBeUndefined();
  });

  it("prunes empty values when no baseline is supplied", () => {
    const pruned = pruneConfigDocument({ providers: { p1: { model: "m", api_key: "" } } });
    expect(pruned.providers.p1).toEqual({ model: "m" });
  });
});
