/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearExtensionRegistry,
  contributeExtension,
  provideExtensionValues,
  resolveExtensionListeners,
  resolveExtensionPoint,
  resolveExtensionProps,
} from "../../../src/extensions/extension-registry.js";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";

const TEST_POINT = EXTENSION_POINTS.MESSAGE_CARD_PRE;

describe("extension registry contract", () => {
  beforeEach(() => clearExtensionRegistry());
  afterEach(() => vi.restoreAllMocks());

  it("registers, orders and rejects duplicate contribution ids", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(contributeExtension(TEST_POINT, { id: "second", priority: 20 })).toBe(true);
    expect(contributeExtension(TEST_POINT, { id: "first", priority: 10 })).toBe(true);
    expect(contributeExtension(TEST_POINT, { id: "first", priority: 1 })).toBe(false);
    expect(warning).toHaveBeenCalledWith(
      '[extension-registry] contribution "first" duplicated at "message.card.pre", skipped',
    );
    expect(resolveExtensionPoint(TEST_POINT).map(({ id }) => id)).toEqual(["first", "second"]);
    expect(() => contributeExtension("unknown.point", { id: "unknown" })).toThrow(
      "unknown extension point",
    );
  });

  it("keeps different message actions while arbitrating duplicate capabilities", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const point = EXTENSION_POINTS.MESSAGE_ACTION_AFTER_PRE_CARDS;
    contributeExtension(point, {
      id: "translate",
      priority: 5,
      exclusiveGroup: "message.action.translate",
    });
    contributeExtension(point, {
      id: "copy-fallback",
      priority: 100,
      exclusiveGroup: "message.action.copy",
    });
    contributeExtension(point, {
      id: "copy-preferred",
      priority: 10,
      exclusiveGroup: "message.action.copy",
    });
    expect(resolveExtensionPoint(point).map(({ id }) => id)).toEqual([
      "translate",
      "copy-preferred",
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("exclusive:message.action.copy"));
    warn.mockRestore();
  });

  it("keeps composable entries but arbitrates matching exclusive groups", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    contributeExtension(TEST_POINT, { id: "status", priority: 1 });
    contributeExtension(TEST_POINT, { id: "thinking-b", priority: 20, exclusiveGroup: "thinking" });
    contributeExtension(TEST_POINT, { id: "thinking-a", priority: 10, exclusiveGroup: "thinking" });
    expect(resolveExtensionPoint(TEST_POINT).map(({ id }) => id)).toEqual(["status", "thinking-a"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("exclusive:thinking"));
    warn.mockRestore();
  });

  it("excludes disabled contributions before arbitration", () => {
    const point = EXTENSION_POINTS.MESSAGE_ACTION_AFTER_PRE_CARDS;
    contributeExtension(point, { id: "disabled", priority: 1, enabled: false });
    contributeExtension(point, {
      id: "context-disabled",
      priority: 2,
      enabled: (context) => context.enabled,
    });
    contributeExtension(point, { id: "active", priority: 3 });
    expect(resolveExtensionPoint(point, { enabled: false }).map(({ id }) => id)).toEqual([
      "active",
    ]);
  });

  it("isolates predicates, props, listeners and data providers", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    contributeExtension(TEST_POINT, {
      id: "broken",
      when: () => {
        throw new Error("predicate");
      },
    });
    expect(resolveExtensionPoint(TEST_POINT)).toEqual([]);
    expect(
      resolveExtensionProps({
        id: "props",
        resolveProps: () => {
          throw new Error("props");
        },
      }),
    ).toEqual({});
    expect(
      resolveExtensionListeners({
        id: "listeners",
        resolveListeners: () => {
          throw new Error("listeners");
        },
      }),
    ).toEqual({});
    contributeExtension(EXTENSION_POINTS.COMPOSER_MODEL_OPTIONS, {
      id: "provider",
      provide: () => {
        throw new Error("provider");
      },
    });
    expect(provideExtensionValues(EXTENSION_POINTS.COMPOSER_MODEL_OPTIONS)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });
});
