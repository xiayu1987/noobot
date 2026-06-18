import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION,
  MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION_STORAGE_KEY,
  clampMobileChatNavigatorTriggerPosition,
  loadMobileChatNavigatorTriggerPosition,
  persistMobileChatNavigatorTriggerPosition,
} from "../../../src/app/mobileChatNavigatorTriggerPosition";

describe("mobile chat navigator trigger position", () => {
  const storage = new Map();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      clear: vi.fn(() => storage.clear()),
      getItem: vi.fn((key) => (storage.has(key) ? storage.get(key) : null)),
      setItem: vi.fn((key, value) => storage.set(key, String(value))),
    });
    vi.stubGlobal("innerWidth", 360);
    vi.stubGlobal("innerHeight", 640);
  });

  it("loads the default safe-area-aware position when storage is empty or invalid", () => {
    expect(loadMobileChatNavigatorTriggerPosition()).toEqual(
      DEFAULT_MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION,
    );

    localStorage.setItem(MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION_STORAGE_KEY, "not-json");

    expect(loadMobileChatNavigatorTriggerPosition()).toEqual(
      DEFAULT_MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION,
    );
  });

  it("loads persisted absolute coordinates only when both axes are finite", () => {
    localStorage.setItem(
      MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION_STORAGE_KEY,
      JSON.stringify({ left: 24, top: 128 }),
    );

    expect(loadMobileChatNavigatorTriggerPosition()).toEqual({ left: 24, top: 128 });

    localStorage.setItem(
      MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION_STORAGE_KEY,
      JSON.stringify({ left: 24, top: "bad" }),
    );

    expect(loadMobileChatNavigatorTriggerPosition()).toEqual(
      DEFAULT_MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION,
    );
  });

  it("clamps absolute coordinates inside the viewport with trigger size and edge gap", () => {
    expect(clampMobileChatNavigatorTriggerPosition(-20, 900)).toEqual({
      left: 8,
      top: 588,
    });

    expect(clampMobileChatNavigatorTriggerPosition(120, 180)).toEqual({
      left: 120,
      top: 180,
    });
  });

  it("persists rounded absolute coordinates and ignores storage failures", () => {
    persistMobileChatNavigatorTriggerPosition({ left: 20.6, top: 40.2 });

    expect(localStorage.getItem(MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION_STORAGE_KEY)).toBe(
      JSON.stringify({ left: 21, top: 40 }),
    );

    const setItemSpy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => persistMobileChatNavigatorTriggerPosition({ left: 1, top: 2 })).not.toThrow();

    setItemSpy.mockRestore();
  });
});
