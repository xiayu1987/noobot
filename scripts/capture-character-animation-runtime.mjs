/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(repositoryRoot, "docs/assets/noobot-character-animation-runtime.gif");
const frameRoot = path.join(repositoryRoot, "test-results/character-animation-runtime-frames");
const baseUrl = String(process.env.NOOBOT_E2E_BASE_URL || "http://127.0.0.1:10060").replace(
  /\/$/,
  "",
);
const userId = String(process.env.NOOBOT_E2E_USER_ID || "").trim();
const connectCode = String(process.env.NOOBOT_E2E_CONNECT_CODE || "").trim();
const modelAlias = String(process.env.NOOBOT_E2E_MODEL_ALIAS || "gpt_5_4").trim();
if (!userId || !connectCode) {
  throw new Error("NOOBOT_E2E_USER_ID and NOOBOT_E2E_CONNECT_CODE are required");
}

await rm(frameRoot, { recursive: true, force: true });
await mkdir(frameRoot, { recursive: true });
const browser = await chromium.launch({ headless: true, chromiumSandbox: false });
let frameIndex = 0;
async function capture(page) {
  await page.screenshot({
    path: path.join(frameRoot, `frame-${String(frameIndex++).padStart(4, "0")}.png`),
  });
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(
    ({ alias, configuredUserId }) => {
      localStorage.setItem("noobot_locale", "en-US");
      const scenarios = { full: alias, programming: alias, text: alias };
      localStorage.setItem("noobot_selected_model", alias);
      localStorage.setItem("noobot_selected_model_by_scenario", JSON.stringify(scenarios));
      localStorage.setItem(
        "noobot_selected_model_selection_by_scenario_v2",
        JSON.stringify(
          Object.fromEntries(
            Object.entries(scenarios).map(([key, value]) => [key, { value, source: "user" }]),
          ),
        ),
      );
      localStorage.setItem(`noobot_selected_plugins:${encodeURIComponent(configuredUserId)}`, "[]");
    },
    { alias: modelAlias, configuredUserId: userId },
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[runtime-capture] pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[runtime-capture] ${message.text()}`);
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator(".custom-input input").first().fill(userId);
  await page.locator(".connect-input input").fill(connectCode);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/internal/connect") && response.request().method() === "POST",
    ),
    page.locator(".connect-btn").click(),
  ]);
  await page.locator(".status-btn.connected").waitFor({ state: "visible", timeout: 30000 });
  await page.locator(".new-chat-btn").click();
  await page.locator(".composer-icon-btn").first().click();
  const pluginButton = page
    .locator(".plugin-option-button")
    .filter({ hasText: /角色|character/i })
    .first();
  await pluginButton.click();
  await page.locator(".more-panel-overlay:visible .more-collapse-btn").click();
  await page.locator(".more-panel-overlay").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: /角色功能|character/i }).click();
  await page.getByTestId("character-load-sample").click();
  await page.locator(".composer-icon-btn").first().click();
  const asset = page.locator(
    '[data-asset-id="sample.three.robot-expressive"] [data-testid="character-select-asset"]',
  );
  if (!(await asset.isChecked())) await asset.check();
  await page.locator(".more-panel-overlay:visible .more-collapse-btn").click();
  await page.locator(".more-panel-overlay").waitFor({ state: "hidden" });
  await capture(page);

  const animationId = `readme.character.runtime.${Date.now()}`;
  await page
    .locator(".chat-input textarea")
    .fill(
      `Call character_animation_generate exactly once. Use animationId ${animationId}. Create one continuous 10 second, loop false timeline for sample.three.robot-expressive at initialPosition [0,0,0] with these native clips in order: Idle start 0 duration 1, Wave start 1 duration 2, Jump start 3 duration 1.5, Walk start 4.5 duration 4, Idle start 8.5 duration 1.5. After success reply exactly README-CHARACTER-ANIMATION-OK.`,
    );
  await page.locator(".send-btn").click();
  const artifactCanvas = page
    .getByTestId("session-artifact-panel")
    .locator(`[data-animation-id="${animationId}"] canvas`);
  const generationDeadline = Date.now() + 180000;
  while (
    Date.now() < generationDeadline &&
    !(await artifactCanvas.isVisible().catch(() => false))
  ) {
    await capture(page);
    // Keep the real request visible without letting provider latency dominate the GIF.
    await page.waitForTimeout(1000);
  }
  await artifactCanvas.waitFor({ state: "visible", timeout: 30000 });
  const statusRow = page.locator(".message-status-steps").last();
  await statusRow.waitFor({ state: "visible", timeout: 30000 });
  // Capture the actual Three.js playback at 15 FPS for a fluid 10-second timeline.
  for (let index = 0; index < 180; index += 1) {
    await capture(page);
    await page.waitForTimeout(67);
  }
  await statusRow.waitFor({ state: "visible", timeout: 180000 });
  await page.waitForFunction(
    (node) => !node.classList.contains("is-running"),
    await statusRow.elementHandle(),
    { timeout: 180000 },
  );
  await page.locator(".message-status-steps .el-step__head.is-success").last().waitFor({
    state: "visible",
    timeout: 30000,
  });
  await page.waitForTimeout(1000);
  await capture(page);
  // Remove the recording session through the same authenticated UI action used by users.
  await page.locator(".session-item.active .session-delete-btn").click();
  await page.waitForTimeout(500);
  await context.close();
} finally {
  await browser.close();
}

await execFileAsync("ffmpeg", [
  "-y",
  "-framerate",
  "15",
  "-i",
  path.join(frameRoot, "frame-%04d.png"),
  "-vf",
  "fps=15,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a",
  "-loop",
  "0",
  outputPath,
]);
await rm(frameRoot, { recursive: true, force: true });
console.log(`generated ${outputPath} from ${frameIndex} real Noobot screenshots`);
