/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from "vitest";
import {
  resolveConfigFieldLabel,
  resolveConfigNodeHint,
  resolveConfigPathLabels,
} from "../../../../src/modules/settings/state/configLabels.js";

const dictionary = {
  "configFields.providers": "模型提供方",
  "configFields.model": "模型名称",
};

function translate(key) {
  return dictionary[key] ?? key;
}

describe("configLabels", () => {
  it("resolves known field keys to localised labels", () => {
    expect(resolveConfigFieldLabel(translate, "providers")).toBe("模型提供方");
    expect(resolveConfigFieldLabel(translate, "model")).toBe("模型名称");
  });

  it("falls back to the raw key when no translation exists", () => {
    expect(resolveConfigFieldLabel(translate, "unmapped_field")).toBe("unmapped_field");
  });

  it("renders numeric array keys as one-based positions", () => {
    expect(resolveConfigFieldLabel(translate, 0)).toBe("#1");
    expect(resolveConfigFieldLabel(translate, "2")).toBe("#3");
  });

  it("treats blank keys as absent rather than numeric", () => {
    expect(resolveConfigFieldLabel(translate, "")).toBe("");
    expect(resolveConfigFieldLabel(translate, null)).toBe("");
    expect(resolveConfigFieldLabel(translate, "  ")).toBe("  ");
  });

  it("exposes the raw key as a hint only when a label replaced it", () => {
    expect(resolveConfigNodeHint(translate, "providers")).toBe("providers");
    expect(resolveConfigNodeHint(translate, "unmapped_field")).toBe("");
    expect(resolveConfigNodeHint(translate, "")).toBe("");
  });

  it("maps a nav trail to breadcrumb labels", () => {
    const trail = [{ key: "providers" }, { key: "p1" }, { key: "model" }];
    expect(resolveConfigPathLabels(translate, trail)).toEqual(["模型提供方", "p1", "模型名称"]);
    expect(resolveConfigPathLabels(translate)).toEqual([]);
  });
});
