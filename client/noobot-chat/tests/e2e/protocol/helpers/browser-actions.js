/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import { waitForTurnTerminal } from "./scenario-assertions.js";

export async function sendMessage(page, message) {
  await page.locator(".chat-input textarea").fill(message);
  await page.locator(".send-btn").click();
}

export async function stopActiveTurn(page) {
  const stopButton = page.locator(".stop-float-btn");
  await expect(stopButton).toBeVisible();
  await stopButton.click();
  await expect(stopButton).toBeHidden();
}

export async function addAttachment(page, file) {
  const more = page.locator(".composer-icon-btn").first();
  await more.click();
  const input = page.locator(".native-file-input");
  await input.setInputFiles(file);
  await expect(page.locator(".attachment-name")).toContainText(file.name);
  await page.locator(".more-collapse-btn").click();
  await expect(page.locator(".more-panel-overlay")).toBeHidden();
}

export async function selectPlugins(page, pluginKeys = []) {
  const panel = page.locator(".more-panel");
  const overlay = page.locator(".more-panel-overlay");
  if (!await overlay.isVisible()) await page.locator(".composer-icon-btn").first().click();
  const buttons = page.locator(".plugin-option-button");
  for (let index = 0; index < await buttons.count(); index += 1) {
    const button = buttons.nth(index);
    const key = String(await button.getAttribute("title") || await button.textContent() || "").trim().toLowerCase();
    const shouldSelect = pluginKeys.some((item) => key.includes(item.toLowerCase()));
    const selected = await button.getAttribute("type") === "primary" || await button.evaluate((node) => node.classList.contains("el-button--primary"));
    if (selected !== shouldSelect) await button.click();
  }
  await page.locator(".more-collapse-btn").click();
  await expect(page.locator(".more-panel-overlay")).toBeHidden();
}

export async function setHarnessCapability(page, label, enabled) {
  const panel = page.locator(".more-panel");
  const overlay = page.locator(".more-panel-overlay");
  if (!await overlay.isVisible()) await page.locator(".composer-icon-btn").first().click();
  const field = panel.locator(".plugin-model-field").filter({
    has: page.locator(".plugin-model-label").getByText(label, { exact: true }),
  });
  const target = field.locator(".plugin-capability-toggle .el-radio-button").nth(enabled ? 0 : 1);
  await target.click();
  await expect(target).toHaveClass(/is-active/);
  await page.locator(".more-collapse-btn").click();
  await expect(page.locator(".more-panel-overlay")).toBeHidden();
}

export async function setHarnessGuidanceAnalysisIntensity(page, value) {
  const panel = page.locator(".more-panel");
  const overlay = page.locator(".more-panel-overlay");
  if (!await overlay.isVisible()) await page.locator(".composer-icon-btn").first().click();
  const control = panel.locator(".plugin-guidance-analysis-control");
  await expect(control).toBeVisible();
  const slider = control.locator(".el-slider__button-wrapper[role='slider']");
  const display = control.locator("strong");
  let current = Number(await display.textContent());
  if (current === value) {
    const key = value > 1 ? "ArrowLeft" : "ArrowRight";
    current += value > 1 ? -1 : 1;
    await slider.press(key);
    await expect(display).toHaveText(String(current));
  }
  while (current !== value) {
    const step = current < value ? 1 : -1;
    await slider.press(step > 0 ? "ArrowRight" : "ArrowLeft");
    current += step;
    await expect(display).toHaveText(String(current));
  }
  await page.locator(".more-collapse-btn").click();
  await expect(page.locator(".more-panel-overlay")).toBeHidden();
}

export async function setHarnessRuntimeThresholds(page, thresholds = {}) {
  const panel = page.locator(".more-panel");
  const overlay = page.locator(".more-panel-overlay");
  if (!await overlay.isVisible()) await page.locator(".composer-icon-btn").first().click();
  await expect(panel.locator("[data-threshold-key], .plugin-turn-threshold-control")).toHaveCount(0);
  const normalized = Object.fromEntries(
    Object.entries(thresholds)
      .map(([key, value]) => [key, Number(value)])
      .filter(([, value]) => Number.isInteger(value) && value > 0),
  );
  await panel.locator(".composer-options").evaluate((_element, runtimeThresholds) => {
    const rootVNode = document.querySelector("#app")?._vnode;
    const visited = new Set();
    let layoutComponent = null;
    const visit = (vnode, depth = 0) => {
      if (!vnode || typeof vnode !== "object" || visited.has(vnode) || depth > 40) return;
      visited.add(vnode);
      if (Array.isArray(vnode)) {
        vnode.forEach((child) => visit(child, depth));
        return;
      }
      const component = vnode.component;
      if (component) {
        const name = String(component.type?.__name || component.type?.name || "");
        if (name === "AppShellLayout") {
          layoutComponent = component;
          return;
        }
        visit(component.subTree, depth + 1);
      }
      if (Array.isArray(vnode.children)) {
        vnode.children.forEach((child) => visit(child, depth + 1));
      }
    };
    visit(rootVNode);
    const updatePluginModelConfig = layoutComponent?.vnode?.props?.["onUpdate:pluginModelConfig"];
    if (typeof updatePluginModelConfig !== "function") {
      throw new Error("AppShellLayout plugin-model-config event boundary is unavailable");
    }
    const currentConfig = layoutComponent.props?.pluginModelConfig || {};
    const currentHarness = currentConfig.harness || {};
    const nextHarness = {
      ...currentHarness,
      ...(runtimeThresholds.summaryTurns
        ? {
            guidance: {
              ...(currentHarness.guidance || {}),
              summary: {
                ...(currentHarness.guidance?.summary || {}),
                turnsThreshold: runtimeThresholds.summaryTurns,
              },
            },
          }
        : {}),
      ...(runtimeThresholds.planUpdateTurns
        ? {
            planning: {
              ...(currentHarness.planning || {}),
              planUpdate: {
                ...(currentHarness.planning?.planUpdate || {}),
                triggerTurnsThreshold: runtimeThresholds.planUpdateTurns,
              },
            },
          }
        : {}),
      ...(runtimeThresholds.phaseAcceptanceTurns
        ? {
            acceptance: {
              ...(currentHarness.acceptance || {}),
              phase: {
                ...(currentHarness.acceptance?.phase || {}),
                triggerTurnsThreshold: runtimeThresholds.phaseAcceptanceTurns,
              },
            },
          }
        : {}),
    };
    updatePluginModelConfig({ ...currentConfig, harness: nextHarness });
  }, normalized);
  await page.locator(".more-collapse-btn").click();
  await expect(page.locator(".more-panel-overlay")).toBeHidden();
}

export async function setRunSummaryPolicy(page, policy = {}) {
  const panel = page.locator(".more-panel");
  const overlay = page.locator(".more-panel-overlay");
  if (!await overlay.isVisible()) await page.locator(".composer-icon-btn").first().click();
  await expect(panel.locator("[data-summary-policy-key]")).toHaveCount(0);
  const normalizedPolicy = Object.fromEntries(
    Object.entries(policy)
      .map(([key, value]) => [key, Number(value)])
      .filter(([, value]) => Number.isInteger(value) && value > 0),
  );
  await panel.locator(".composer-options").evaluate((_element, nextPolicy) => {
    const rootVNode = document.querySelector("#app")?._vnode;
    const visited = new Set();
    let updateSummaryPolicy = null;
    const visit = (vnode, depth = 0) => {
      if (!vnode || typeof vnode !== "object" || visited.has(vnode) || depth > 40) return;
      visited.add(vnode);
      if (Array.isArray(vnode)) {
        vnode.forEach((child) => visit(child, depth));
        return;
      }
      const component = vnode.component;
      if (component) {
        const name = String(component.type?.__name || component.type?.name || "");
        if (name === "AppShellLayout") {
          updateSummaryPolicy = component.vnode?.props?.["onUpdate:summaryPolicy"] || null;
          return;
        }
        visit(component.subTree, depth + 1);
      }
      if (Array.isArray(vnode.children)) {
        vnode.children.forEach((child) => visit(child, depth + 1));
      }
    };
    visit(rootVNode);
    if (typeof updateSummaryPolicy !== "function") {
      throw new Error("AppShellLayout summary-policy event boundary is unavailable");
    }
    updateSummaryPolicy(nextPolicy);
  }, normalizedPolicy);
  await page.locator(".more-collapse-btn").click();
  await expect(page.locator(".more-panel-overlay")).toBeHidden();
}

export async function setMainSummaryTurnsThreshold(page, value) {
  await setRunSummaryPolicy(page, { phaseSummaryLoopTurns: value });
}

export async function waitForNaturalCompletion({
  page,
  capture,
  sessionId,
  turnScopeId,
  timeoutMs = 120_000,
}) {
  await expect(page.locator(".stop-float-btn")).toBeVisible();
  const terminal = await waitForTurnTerminal(capture, sessionId, turnScopeId, { timeoutMs });
  expect(terminal.eventType, JSON.stringify(terminal.failure || {})).toBe("turn.completed");
  await expect(page.locator(".stop-float-btn")).toBeHidden({ timeout: timeoutMs });
  return terminal;
}

export async function editLatestUserMessage(page, content, { attachment = null, removeAttachments = false } = {}) {
  const editButton = page.locator(".monotonic-chip-btn.is-primary").last();
  await editButton.click();
  const card = page.locator(".monotonic-edit-card").last();
  await card.locator(".monotonic-edit-textarea textarea").fill(content);
  if (removeAttachments) {
    while (await card.locator(".monotonic-attachment-remove").count()) {
      await card.locator(".monotonic-attachment-remove").first().click();
    }
  }
  if (attachment) await card.locator(".monotonic-file-input").setInputFiles(attachment);
  await card.locator(".monotonic-footer-btn.el-button--primary").click();
}

export function fixedAttachment(name = "protocol-e2e.txt") {
  const body = `noobot-protocol-e2e:${name}:v1\n`;
  return { name, mimeType: "text/plain", buffer: Buffer.from(body, "utf8"), body };
}
