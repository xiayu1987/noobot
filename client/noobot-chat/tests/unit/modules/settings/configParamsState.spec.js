/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  assertConfigParamListMatchesCatalog,
  configParamsFromCatalog,
  normalizeConfigParamList,
} from "../../../../src/modules/settings/state/configParamsState.js";

describe("config params catalog state", () => {
  it("projects only catalog-owned keys and keeps their persisted values", () => {
    expect(configParamsFromCatalog({
      catalog: [{ key: "REGION" }, { key: "API_KEY" }],
      values: { API_KEY: "secret", UNUSED_KEY: "ignored" },
    })).toEqual([
      { key: "API_KEY", value: "secret" },
      { key: "REGION", value: "" },
    ]);
  });

  it("rejects JSON editor keys outside the authoritative catalog", () => {
    try {
      assertConfigParamListMatchesCatalog(
        [{ key: "UNUSED_KEY", value: "value" }],
        [{ key: "API_KEY" }],
      );
      throw new Error("expected an unknown config param error");
    } catch (error) {
      expect(error).toMatchObject({
        code: "UNKNOWN_CONFIG_PARAM_KEY",
        key: "UNUSED_KEY",
      });
    }
    expect(assertConfigParamListMatchesCatalog(
      normalizeConfigParamList([{ key: "API_KEY", value: " value " }]),
      [{ key: "API_KEY" }],
    )).toBe(true);
  });
});
