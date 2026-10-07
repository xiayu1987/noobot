/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { activate } from "../index.js";

const EXTENSION_POINTS = Object.freeze({
  MARKDOWN_COLLAPSE_MARKERS: "markdown-collapse-markers",
  COMPOSER_OPTIONS_MODEL: "composer-options-model",
  MESSAGE_CARD_PRE: "message-card-pre",
  MESSAGE_CARD_POST: "message-card-post",
  THINKING_CONTENT_ITEM: "thinking-content-item",
});

async function collectContributions() {
  const contributions = [];
  await activate({
    contributeExtension: (point, contribution) => contributions.push({ point, contribution }),
    extensionPoints: EXTENSION_POINTS,
    services: {},
  });
  return contributions;
}

describe("Harness frontend registration", () => {
  it("shows the model extension only while Harness is selected", async () => {
    const contributions = await collectContributions();
    const modelExtension = contributions.find(
      ({ point }) => point === "composer-options-model",
    )?.contribution;
    expect(modelExtension).toBeDefined();

    const selectedPluginKeySet = new Set(["harness"]);
    expect(modelExtension.when({ selectedPluginKeySet })).toBe(true);

    selectedPluginKeySet.delete("harness");
    expect(modelExtension.when({ selectedPluginKeySet })).toBe(false);

    selectedPluginKeySet.add("harness");
    expect(modelExtension.when({ selectedPluginKeySet })).toBe(true);
    expect(modelExtension.when({})).toBe(false);
  });

  it("leaves the thinking panel and canonical message assets to the host", async () => {
    const contributions = await collectContributions();
    expect(contributions.filter(({ point }) => point === "message-card-pre")).toEqual([]);
    expect(contributions.filter(({ point }) => point === "message-card-post")).toEqual([]);
    expect(
      contributions.some(({ contribution }) => contribution.suppressDefaultAssets === true),
    ).toBe(false);
  });

  it("registers a guidance analysis renderer for thinking content items", async () => {
    const contributions = await collectContributions();
    expect(contributions.every(({ point }) => typeof point === "string" && point)).toBe(true);
    const item = contributions.find(({ point }) => point === "thinking-content-item")?.contribution;
    expect(item?.id).toBe("harness-guidance-analysis");
    expect(item.component).toBeUndefined();
    const renderers = item.provide();
    expect(renderers.map(({ activityKind }) => activityKind)).toEqual(["guidance_analysis"]);
    expect(renderers[0].label()).toBe("Guidance Analysis");
  });
});
