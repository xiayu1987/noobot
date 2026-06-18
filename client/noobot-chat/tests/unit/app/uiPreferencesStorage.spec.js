import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  UI_PREFERENCE_STORAGE_KEYS,
  loadUiPreferences,
  normalizeAvailableBotScenarios,
  readStorageValue,
  resolveBotScenarioWithConfig,
  syncBotScenarioWithConfig,
  updateAllowUserInteractionPreference,
  updateBotScenarioPreference,
  updateForceToolPreference,
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
      forceTool: false,
      streamOutput: true,
      botScenario: "",
    });

    storage.set(UI_PREFERENCE_STORAGE_KEYS.userId, "admin");
    storage.set(UI_PREFERENCE_STORAGE_KEYS.allowUserInteraction, "false");
    storage.set(UI_PREFERENCE_STORAGE_KEYS.forceTool, "true");
    storage.set(UI_PREFERENCE_STORAGE_KEYS.streamOutput, "false");
    storage.set(UI_PREFERENCE_STORAGE_KEYS.botScenario, " workflow ");

    expect(loadUiPreferences()).toEqual({
      userId: "admin",
      allowUserInteraction: false,
      forceTool: true,
      streamOutput: false,
      botScenario: "workflow",
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
    const forceTool = { value: false };
    const streamOutput = { value: true };

    updateAllowUserInteractionPreference({ preferenceRef: allowUserInteraction, value: 0 });
    updateForceToolPreference({ preferenceRef: forceTool, value: 1 });
    updateStreamOutputPreference({ preferenceRef: streamOutput, value: false });

    expect(allowUserInteraction.value).toBe(false);
    expect(forceTool.value).toBe(true);
    expect(streamOutput.value).toBe(false);
    expect(localStorage.getItem(UI_PREFERENCE_STORAGE_KEYS.allowUserInteraction)).toBe("false");
    expect(localStorage.getItem(UI_PREFERENCE_STORAGE_KEYS.forceTool)).toBe("true");
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
});
