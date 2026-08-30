/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { devices } from "@playwright/test";
import { test, expect, installE2eModelPreferences } from "../fixtures/noobot.fixture.js";
import { connectThroughUi, readE2eCredentials } from "../fixtures/auth.fixture.js";
import {
  selectPlugins,
  sendMessage,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import { assertNoForbiddenErrors } from "../helpers/log-assertions.js";
import { waitForSessionExecutionEventTree } from "../helpers/persistence-audit.js";
import { waitForCommand } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

const animationId = "e2e.character.wave";

test("@full PBE-048 导入勾选 GLB 后工具生成权威动画并渲染唯一卡片", async ({
  noobot,
  protocolCapture,
  browser,
}, testInfo) => {
  test.setTimeout(420000);
  const { page } = noobot;
  await selectPlugins(page, ["character"]);

  await page.getByTestId("right-feature-panel-toggle").click();
  const featurePanel = page.getByTestId("right-feature-panel");
  await expect(featurePanel).toBeVisible();
  await expect(featurePanel).not.toHaveClass(/is-collapsed/);
  await page.getByTestId("character-load-sample").click();
  await expect(page.locator(".character-animation-assets__preview-title")).toContainText(
    "RobotExpressive.glb",
  );

  await page.locator(".composer-icon-btn").first().click();
  const selected = page.locator(
    '[data-asset-id="sample.three.robot-expressive"] [data-testid="character-select-asset"]',
  );
  await expect(selected).toBeChecked();
  await page.locator(".more-collapse-btn").click();

  await sendMessage(
    page,
    uniquePrompt(
      testInfo,
      `Call character_animation_generate exactly once. Use animationId ${animationId}. Animate sample.three.robot-expressive at initialPosition [0,0,0] for 2 seconds, loop false, with native clip Wave from start 0 for duration 2. After success reply exactly CASE048-OK.`,
    ),
  );
  const command = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForNaturalCompletion({
    page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: command.identity.turnScopeId,
    timeoutMs: 420000,
  });

  const records = await waitForSessionExecutionEventTree(
    noobot.userId,
    noobot.sessionId,
    (events) =>
      events.some(
        (event) =>
          event.event === "tool_call_end" &&
          event.turnScopeId === command.identity.turnScopeId &&
          event.data?.tool === "character_animation_generate" &&
          event.data?.success === true,
      ) &&
      events.some(
        (event) =>
          event.event === "authority_event_committed" &&
          event.data?.envelope?.protocol?.family === "plugin.artifact" &&
          event.data?.envelope?.payload?.pluginId === "character" &&
          event.data?.envelope?.payload?.data?.protocol?.animationId === animationId,
      ),
    { timeoutMs: 120000 },
  );
  const toolEnd = records.find(
    (event) =>
      event.event === "tool_call_end" &&
      event.turnScopeId === command.identity.turnScopeId &&
      event.data?.tool === "character_animation_generate",
  );
  expect(JSON.parse(String(toolEnd.data.result))).toMatchObject({
    ok: true,
    animationId,
    characterAssetIds: ["sample.three.robot-expressive"],
  });
  const authority = records.find(
    (event) =>
      event.event === "authority_event_committed" &&
      event.data?.envelope?.payload?.data?.protocol?.animationId === animationId,
  );
  expect(authority.data.envelope.payload.data.protocol.characters).toEqual([
    {
      assetId: "sample.three.robot-expressive",
      initialPosition: [0, 0, 0],
      segments: [{ type: "native_clip", start: 0, duration: 2, clip: "Wave" }],
    },
  ]);

  const artifactPanel = page.getByTestId("session-artifact-panel");
  await expect(artifactPanel).toBeVisible();
  await expect(artifactPanel).not.toHaveClass(/is-collapsed/);
  const artifactPanelBox = await artifactPanel.boundingBox();
  expect(artifactPanelBox?.width || 0).toBeGreaterThanOrEqual(480);
  const featurePanelBox = await featurePanel.boundingBox();
  const artifactRight = (artifactPanelBox?.x || 0) + (artifactPanelBox?.width || 0);
  expect(artifactRight).toBeLessThanOrEqual((featurePanelBox?.x || 0) - 8);
  await expect(featurePanel.locator(`[data-animation-id="${animationId}"]`)).toHaveCount(0);
  const card = artifactPanel.locator(`[data-animation-id="${animationId}"]`);
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  await expect(card.locator("header span")).toHaveText(/1\s*·\s*1\s+(?:个角色|character\(s\))/);
  const canvas = card.locator("canvas");
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox?.height || 0).toBeGreaterThanOrEqual(440);
  await expect
    .poll(async () => canvas.evaluate((node) => ({ width: node.width, height: node.height })))
    .toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
    });
  expect(await canvas.evaluate((node) => node.width * node.height)).toBeGreaterThan(0);

  // A genuinely independent mobile browser has no localStorage or IndexedDB
  // from the importing desktop. It must restore the GLB from the authenticated
  // workspace asset referenced by the Session authority event.
  const mobileContext = await browser.newContext({
    ...devices["iPhone 13"],
    launchOptions: { chromiumSandbox: false },
  });
  await installE2eModelPreferences(mobileContext);
  const mobilePage = await mobileContext.newPage();
  protocolCapture.bindPage(mobilePage);
  try {
    await mobilePage.goto(`/?session=${encodeURIComponent(noobot.sessionId)}`);
    expect(
      await mobilePage.evaluate(async () =>
        (await indexedDB.databases()).some((database) =>
          String(database.name || "").startsWith("noobot-character-assets"),
        ),
      ),
    ).toBe(false);
    const assetDownloads = [];
    mobilePage.on("response", (response) => {
      if (
        response.request().method() === "GET" &&
        /\/api\/internal\/character\/assets\/sample\.three\.robot-expressive\/[a-f0-9]{64}$/.test(
          new URL(response.url()).pathname,
        )
      ) {
        assetDownloads.push(response.status());
      }
    });
    await mobilePage.locator(".chat-header .mobile-menu-btn:visible").first().click();
    await connectThroughUi(mobilePage, readE2eCredentials());
    const mobileFeatureTrigger = mobilePage.getByTestId("mobile-feature-panel-trigger");
    await expect(mobileFeatureTrigger).toBeVisible();
    const mobileArtifact = mobilePage.getByTestId("session-artifact-panel");
    await expect(mobileArtifact).toBeVisible();
    const mobileCard = mobileArtifact.locator(`[data-animation-id="${animationId}"]`);
    await expect(mobileCard).toBeVisible();
    expect(assetDownloads).toEqual([200]);
    const mobileCanvas = mobileCard.locator("canvas");
    await expect(mobileCanvas).toBeVisible();
    const mobileCanvasBox = await mobileCanvas.boundingBox();
    expect(mobileCanvasBox?.width || 0).toBeGreaterThan(250);
    expect(mobileCanvasBox?.height || 0).toBeGreaterThanOrEqual(440);
    await expect
      .poll(async () =>
        mobileCanvas.evaluate((node) => {
          const context = node.getContext("webgl2") || node.getContext("webgl");
          if (!context) return false;
          const pixels = new Uint8Array(4);
          const background = [10, 17, 32];
          for (let x = 0; x < node.width; x += Math.max(1, Math.floor(node.width / 10))) {
            for (let y = 0; y < node.height; y += Math.max(1, Math.floor(node.height / 10))) {
              context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixels);
              if (
                Math.abs(pixels[0] - background[0]) > 8 ||
                Math.abs(pixels[1] - background[1]) > 8 ||
                Math.abs(pixels[2] - background[2]) > 8
              )
                return true;
            }
          }
          return false;
        }),
      )
      .toBe(true);
    const mobileArtifactBox = await mobileArtifact.boundingBox();
    const mobileFeatureButtonBox = await mobileFeatureTrigger.boundingBox();
    expect(mobileArtifactBox?.y || 0).toBeGreaterThanOrEqual(
      (mobileFeatureButtonBox?.y || 0) + (mobileFeatureButtonBox?.height || 0) + 8,
    );
    expect(
      await mobilePage.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open("noobot-character-assets-v2", 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const count = db.transaction("glb").objectStore("glb").count();
              count.onerror = () => reject(count.error);
              count.onsuccess = () => {
                db.close();
                resolve(count.result);
              };
            };
          }),
      ),
    ).toBe(1);
  } finally {
    await mobileContext.close();
  }

  await page.reload();
  await expect(page.getByTestId("session-artifact-panel")).toBeVisible();
  await expect(
    page.getByTestId("session-artifact-panel").locator(`[data-animation-id="${animationId}"]`),
  ).toHaveCount(1);
  await expect(
    page
      .getByTestId("session-artifact-panel")
      .locator(`[data-animation-id="${animationId}"] canvas`),
  ).toBeVisible();
  const artifactPanelAfterReload = page.getByTestId("session-artifact-panel");
  const chatNavigatorPanel = page.locator(".chat-message-nav-panel");
  const connectorPanel = page.locator(".connector-overview-panel").nth(0);
  const rightToolPanels = page.locator(".right-tool-panels");

  // Collapsing every right-side tool still leaves a reserved icon rail in the
  // message layout, so the session artifact cannot cover those controls.
  await page.getByTestId("right-chat-navigator-panel-toggle").click();
  await expect(chatNavigatorPanel).toHaveClass(/is-collapsed/);
  await expect(connectorPanel).toHaveClass(/is-collapsed/);
  await expect(featurePanel).toHaveClass(/is-collapsed/);
  const collapsedArtifactBox = await artifactPanelAfterReload.boundingBox();
  const collapsedNavigatorBox = await chatNavigatorPanel.boundingBox();
  const collapsedToolBox = await rightToolPanels.boundingBox();
  const collapsedToolLeft = collapsedToolBox?.x ?? Number.POSITIVE_INFINITY;
  expect((collapsedArtifactBox?.x || 0) + (collapsedArtifactBox?.width || 0)).toBeLessThanOrEqual(
    collapsedToolLeft - 8,
  );

  await page.getByTestId("session-artifact-panel-toggle").click();
  await expect(artifactPanelAfterReload).toHaveClass(/is-collapsed/);
  const collapsedArtifactIconBox = await artifactPanelAfterReload.boundingBox();
  expect(
    (collapsedArtifactIconBox?.x || 0) + (collapsedArtifactIconBox?.width || 0),
  ).toBeLessThanOrEqual(collapsedToolLeft - 8);

  // Re-open the character tool while the artifact stays collapsed. The same
  // reserved message column must keep both surfaces side by side.
  await page.getByTestId("right-feature-panel-toggle").click();
  await expect(featurePanel).not.toHaveClass(/is-collapsed/);
  await expect(chatNavigatorPanel).toHaveClass(/is-collapsed/);
  const featureOpenBox = await featurePanel.boundingBox();
  const artifactCollapsedBox = await artifactPanelAfterReload.boundingBox();
  expect((artifactCollapsedBox?.x || 0) + (artifactCollapsedBox?.width || 0)).toBeLessThanOrEqual(
    (featureOpenBox?.x || 0) - 8,
  );
  await page.waitForTimeout(250);
  const collapsedBox = await chatNavigatorPanel.boundingBox();
  expect(collapsedBox?.width).toBeLessThanOrEqual(60);
  expect(collapsedBox?.height).toBeLessThanOrEqual(60);
  assertNoForbiddenErrors(protocolCapture.console);
});
