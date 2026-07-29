/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { registerFrontendPlugin } from "../index.js";

describe("Harness frontend registration", () => {
  it("shows the model extension only while Harness is selected", () => {
    const contributions = [];
    registerFrontendPlugin({
      contributeExtension: (point, contribution) => contributions.push({ point, contribution }),
      extensionPoints: {
        MARKDOWN_COLLAPSE_MARKERS: "markdown-collapse-markers",
        COMPOSER_OPTIONS_MODEL: "composer-options-model",
        MESSAGE_CARD_PRE: "message-card-pre",
        MESSAGE_CARD_POST: "message-card-post",
      },
      services: {},
    });

    const modelExtension = contributions.find(({ point }) => point === "composer-options-model")?.contribution;
    expect(modelExtension).toBeDefined();

    const selectedPluginKeySet = new Set(["harness"]);
    expect(modelExtension.when({ selectedPluginKeySet })).toBe(true);

    selectedPluginKeySet.delete("harness");
    expect(modelExtension.when({ selectedPluginKeySet })).toBe(false);

    selectedPluginKeySet.add("harness");
    expect(modelExtension.when({ selectedPluginKeySet })).toBe(true);
    expect(modelExtension.when({})).toBe(false);
  });

  it("leaves canonical message assets at the host-owned render outlet", () => {
    const contributions = [];
    registerFrontendPlugin({
      contributeExtension: (point, contribution) => contributions.push({ point, contribution }),
      extensionPoints: {
        MARKDOWN_COLLAPSE_MARKERS: "markdown-collapse-markers",
        COMPOSER_OPTIONS_MODEL: "composer-options-model",
        MESSAGE_CARD_PRE: "message-card-pre",
        MESSAGE_CARD_POST: "message-card-post",
      },
      services: {},
    });

    expect(contributions.filter(({ point }) => point === "message-card-post")).toEqual([]);
    expect(contributions.some(({ contribution }) => contribution.suppressDefaultAssets === true)).toBe(false);
  });
});
