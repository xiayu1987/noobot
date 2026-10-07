/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { activate } from "../index.js";

describe("Harness frontend registration", () => {
  it("shows the model extension only while Harness is selected", async () => {
    const contributions = [];
    await activate({
      contributeExtension: (point, contribution) => contributions.push({ point, contribution }),
      extensionPoints: {
        MARKDOWN_COLLAPSE_MARKERS: "markdown-collapse-markers",
        COMPOSER_OPTIONS_MODEL: "composer-options-model",
        MESSAGE_CARD_PRE: "message-card-pre",
        MESSAGE_CARD_POST: "message-card-post",
      },
      services: {},
    });

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
    const contributions = [];
    await activate({
      contributeExtension: (point, contribution) => contributions.push({ point, contribution }),
      extensionPoints: {
        MARKDOWN_COLLAPSE_MARKERS: "markdown-collapse-markers",
        COMPOSER_OPTIONS_MODEL: "composer-options-model",
        MESSAGE_CARD_PRE: "message-card-pre",
        MESSAGE_CARD_POST: "message-card-post",
      },
      services: {},
    });

    expect(contributions.filter(({ point }) => point === "message-card-pre")).toEqual([]);
    expect(contributions.filter(({ point }) => point === "message-card-post")).toEqual([]);
    expect(
      contributions.some(({ contribution }) => contribution.suppressDefaultAssets === true),
    ).toBe(false);
  });

  it("contributes the guidance analysis section from the activity timeline", async () => {
    const contributions = [];
    await activate({
      contributeExtension: (point, contribution) => contributions.push({ point, contribution }),
      extensionPoints: {
        MARKDOWN_COLLAPSE_MARKERS: "markdown-collapse-markers",
        COMPOSER_OPTIONS_MODEL: "composer-options-model",
        THINKING_PANEL_SECTION: "thinking-panel-section",
      },
      services: {},
    });

    expect(contributions.every(({ point }) => typeof point === "string" && point)).toBe(true);
    const section = contributions.find(
      ({ point }) => point === "thinking-panel-section",
    )?.contribution;
    expect(section?.id).toBe("harness-guidance-analysis");

    const guidance = (eventId, text) => ({ eventId, activityKind: "guidance_analysis", text });
    const activityTimeline = [
      guidance("g-1", "first"),
      { eventId: "host-1", activityKind: "", text: "host" },
      guidance("g-2", "second"),
    ];
    expect(section.when({ activityTimeline })).toBe(true);
    expect(section.when({ activityTimeline: [{ eventId: "host-1", text: "host" }] })).toBe(false);
    expect(section.when({})).toBe(false);
    expect(section.resolveProps({ activityTimeline, variant: "panel" })).toEqual({
      guidanceAnalyses: [activityTimeline[2]],
      variant: "panel",
    });
    expect(section.resolveProps({ activityTimeline, variant: "details" })).toEqual({
      guidanceAnalyses: [activityTimeline[0], activityTimeline[2]],
      variant: "details",
    });
  });
});
