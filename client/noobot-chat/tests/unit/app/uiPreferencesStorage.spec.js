import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  UI_PREFERENCE_STORAGE_KEYS,
  loadUiPreferences,
  persistBotScenarioPreference,
  persistPluginModelConfigPreference,
  persistPluginModelConfigPreferenceByScenario,
  persistSelectedModelPreference,
  persistMemoryModelPreference,
  normalizeAvailableBotScenarios,
  readPluginModelConfigPreference,
  readSelectedModelPreference,
  readStorageValue,
  resolveBotScenarioWithConfig,
  syncBotScenarioWithConfig,
  updateAllowUserInteractionPreference,
  updateBotScenarioPreference,
  updateSafeConfirmPreference,
  updatePluginModelConfigPreference,
  updateStreamOutputPreference,
  writeStorageValue,
} from "../../../src/app/storage/uiPreferencesStorage";

describe("ui preferences storage", () => {
  const storage = new Map();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key) => (storage.has(key) ? storage.get(key) : null)),
      setItem: vi.fn((key, value) => storage.set(key, String(value))),
    });
  });

  it("loads defaults and stored primitive preferences", () => {
    expect(loadUiPreferences()).toEqual({
      userId: "user-001",
      allowUserInteraction: true,
      safeConfirm: true,
      streamOutput: true,
      botScenario: "",
      selectedModel: "",
      selectedModelByScenario: {},
      memoryModel: "",
      pluginModelConfig: {},
    });

    storage.set(UI_PREFERENCE_STORAGE_KEYS.userId, "admin");
    storage.set(UI_PREFERENCE_STORAGE_KEYS.allowUserInteraction, "false");
    storage.set(UI_PREFERENCE_STORAGE_KEYS.safeConfirm, "false");
    storage.set(UI_PREFERENCE_STORAGE_KEYS.streamOutput, "false");
    storage.set(UI_PREFERENCE_STORAGE_KEYS.botScenario, " workflow ");

    expect(loadUiPreferences()).toEqual({
      userId: "admin",
      allowUserInteraction: false,
      safeConfirm: false,
      streamOutput: false,
      botScenario: "workflow",
      selectedModel: "",
      selectedModelByScenario: {},
      memoryModel: "",
      pluginModelConfig: {},
    });
  });

  it("swallows storage read and write failures", () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => {
        throw new Error("read failed");
      }),
      setItem: vi.fn(() => {
        throw new Error("write failed");
      }),
    });

    expect(readStorageValue("x", "fallback")).toBe("fallback");
    expect(writeStorageValue("x", "value")).toBe(false);
    expect(loadUiPreferences().userId).toBe("user-001");
  });

  it("normalizes available bot scenarios from config definitions", () => {
    expect(
      normalizeAvailableBotScenarios({
        workflow: { name: " Workflow ", description: " Run workflow " },
        " ": { name: "ignored" },
      }),
    ).toEqual([
      {
        key: "workflow",
        label: "Workflow",
        description: "Run workflow",
        model: "",
        defaultModel: undefined,
        defaultModelAlias: "",
        enabledModels: [],
      },
    ]);
    expect(normalizeAvailableBotScenarios(null)).toEqual([]);
  });

  it("resolves bot scenario with saved, current, default, and empty-config branches", () => {
    const availableBotScenarios = [{ key: "workflow" }, { key: "harness" }];

    expect(resolveBotScenarioWithConfig({
      configuredDefaultScenario: "workflow",
      currentScenario: "harness",
      savedScenario: " workflow ",
      availableBotScenarios,
    })).toEqual({ value: "workflow", persist: false });

    expect(resolveBotScenarioWithConfig({
      configuredDefaultScenario: "workflow",
      currentScenario: "harness",
      savedScenario: "missing",
      availableBotScenarios,
    })).toEqual({ value: "harness", persist: false });

    expect(resolveBotScenarioWithConfig({
      configuredDefaultScenario: "workflow",
      currentScenario: "missing",
      savedScenario: "",
      availableBotScenarios,
    })).toEqual({ value: "workflow", persist: true });

    expect(resolveBotScenarioWithConfig({
      configuredDefaultScenario: "default-only",
      currentScenario: "",
      savedScenario: "saved-only",
      availableBotScenarios: [],
    })).toEqual({ value: "saved-only", persist: false });
  });

  it("syncs bot scenario refs and only persists fallback selections", () => {
    const preferenceRef = { value: "missing" };

    syncBotScenarioWithConfig({
      configuredDefaultScenario: "workflow",
      availableBotScenarios: [{ key: "workflow" }],
      preferenceRef,
    });

    expect(preferenceRef.value).toBe("workflow");
    expect(localStorage.getItem(UI_PREFERENCE_STORAGE_KEYS.botScenario)).toBe("workflow");
  });

  it("updates boolean preferences and persists string booleans", () => {
    const allowUserInteraction = { value: true };
    const safeConfirm = { value: true };
    const streamOutput = { value: true };

    updateAllowUserInteractionPreference({ preferenceRef: allowUserInteraction, value: 0 });
    updateSafeConfirmPreference({ preferenceRef: safeConfirm, value: 0 });
    updateStreamOutputPreference({ preferenceRef: streamOutput, value: false });

    expect(allowUserInteraction.value).toBe(false);
    expect(safeConfirm.value).toBe(false);
    expect(streamOutput.value).toBe(false);
    expect(localStorage.getItem(UI_PREFERENCE_STORAGE_KEYS.allowUserInteraction)).toBe("false");
    expect(localStorage.getItem(UI_PREFERENCE_STORAGE_KEYS.safeConfirm)).toBe("false");
    expect(localStorage.getItem(UI_PREFERENCE_STORAGE_KEYS.streamOutput)).toBe("false");
  });

  it("updates bot scenario preference only when the scenario is available", () => {
    const preferenceRef = { value: "" };

    expect(updateBotScenarioPreference({
      preferenceRef,
      value: " workflow ",
      availableBotScenarios: [{ key: "workflow" }],
    })).toBe("workflow");
    expect(preferenceRef.value).toBe("workflow");
    expect(localStorage.getItem(UI_PREFERENCE_STORAGE_KEYS.botScenario)).toBe("workflow");

    expect(updateBotScenarioPreference({
      preferenceRef,
      value: "missing",
      availableBotScenarios: [{ key: "workflow" }],
    })).toBe("");
    expect(preferenceRef.value).toBe("");
    expect(localStorage.getItem(UI_PREFERENCE_STORAGE_KEYS.botScenario)).toBe("");
  });

  it("stores selectedModel by scenario", () => {
    persistSelectedModelPreference("main-programming", "programming");
    persistSelectedModelPreference("main-writing", "writing");

    expect(readSelectedModelPreference("programming")).toBe("main-programming");
    expect(readSelectedModelPreference("writing")).toBe("main-writing");
  });

  it("stores harness and workflow plugin model config by scenario without cross-use", () => {
    persistPluginModelConfigPreferenceByScenario(
      {
        harness: { stepModels: { planning: "harness-plan-a", execution: "harness-exec-a" } },
        workflow: { semanticModel: "workflow-a" },
      },
      "programming",
    );
    persistPluginModelConfigPreferenceByScenario(
      {
        harness: { stepModels: { planning: "harness-plan-b" } },
        workflow: { semanticModel: "workflow-b" },
      },
      "writing",
    );

    expect(readPluginModelConfigPreference("programming")).toEqual({
      harness: { stepModels: { planning: "harness-plan-a", execution: "harness-exec-a" } },
      workflow: { semanticModel: "workflow-a" },
    });
    expect(readPluginModelConfigPreference("writing")).toEqual({
      harness: { stepModels: { planning: "harness-plan-b" } },
      workflow: { semanticModel: "workflow-b" },
    });
  });

  it("preserves harness capability enabled false through normalization and scenario storage", () => {
    persistPluginModelConfigPreferenceByScenario(
      {
        harness: {
          stepModels: { planning: "harness-plan-a" },
          capabilityProfile: {
            planning: { enabled: false },
            guidance: { enabled: false },
            acceptance: { enabled: false },
          },
        },
      },
      "programming",
    );

    expect(readPluginModelConfigPreference("programming")).toEqual({
      harness: {
        stepModels: { planning: "harness-plan-a" },
        capabilityProfile: {
          planning: { enabled: false },
          guidance: { enabled: false },
          acceptance: { enabled: false },
        },
      },
    });

    persistBotScenarioPreference("programming");
    expect(loadUiPreferences().pluginModelConfig.harness.capabilityProfile).toEqual({
      planning: { enabled: false },
      guidance: { enabled: false },
      acceptance: { enabled: false },
    });
  });

  it("falls back to legacy global pluginModelConfig when scenario preference is absent", () => {
    persistPluginModelConfigPreference({
      harness: { stepModels: { planning: "legacy-harness" } },
      workflow: { semanticModel: "legacy-workflow" },
    });

    expect(readPluginModelConfigPreference("programming")).toEqual({
      harness: { stepModels: { planning: "legacy-harness" } },
      workflow: { semanticModel: "legacy-workflow" },
    });

    persistPluginModelConfigPreferenceByScenario(
      { workflow: { semanticModel: "scenario-workflow" } },
      "programming",
    );

    expect(readPluginModelConfigPreference("programming")).toEqual({
      workflow: { semanticModel: "scenario-workflow" },
    });
    expect(readPluginModelConfigPreference("writing")).toEqual({
      harness: { stepModels: { planning: "legacy-harness" } },
      workflow: { semanticModel: "legacy-workflow" },
    });
  });

  it("loadUiPreferences restores selectedModel and pluginModelConfig for current scenario", () => {
    persistBotScenarioPreference("programming");
    persistSelectedModelPreference("main-programming", "programming");
    persistSelectedModelPreference("main-writing", "writing");
    persistPluginModelConfigPreferenceByScenario(
      {
        harness: { stepModels: { planning: "harness-programming" } },
        workflow: { semanticModel: "workflow-programming" },
      },
      "programming",
    );
    persistPluginModelConfigPreferenceByScenario(
      {
        harness: { stepModels: { planning: "harness-writing" } },
        workflow: { semanticModel: "workflow-writing" },
      },
      "writing",
    );

    const preferences = loadUiPreferences();

    expect(preferences.selectedModel).toBe("main-programming");
    expect(preferences.pluginModelConfig).toEqual({
      harness: { stepModels: { planning: "harness-programming" } },
      workflow: { semanticModel: "workflow-programming" },
    });
  });

  it("updates plugin model config by current scenario", () => {
    const preferenceRef = { value: {} };

    updatePluginModelConfigPreference({
      preferenceRef,
      scenarioKey: "programming",
      value: {
        harness: { stepModels: { planning: "harness-programming" } },
        workflow: { semanticModel: "workflow-programming" },
      },
    });
    updatePluginModelConfigPreference({
      preferenceRef,
      scenarioKey: "writing",
      value: {
        harness: { stepModels: { planning: "harness-writing" } },
        workflow: { semanticModel: "workflow-writing" },
      },
    });

    expect(readPluginModelConfigPreference("programming")).toEqual({
      harness: { stepModels: { planning: "harness-programming" } },
      workflow: { semanticModel: "workflow-programming" },
    });
    expect(readPluginModelConfigPreference("writing")).toEqual({
      harness: { stepModels: { planning: "harness-writing" } },
      workflow: { semanticModel: "workflow-writing" },
    });
  });

});


it("stores memoryModel by scenario", () => {
  persistMemoryModelPreference("memory-programming", "programming");
  localStorage.setItem("noobot_bot_scenario", "programming");
  expect(loadUiPreferences().memoryModel).toBe("memory-programming");
});
