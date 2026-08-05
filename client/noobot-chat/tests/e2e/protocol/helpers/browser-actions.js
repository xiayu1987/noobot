/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";

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
  if (!await panel.isVisible()) await page.locator(".composer-icon-btn").first().click();
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

export async function waitForNaturalCompletion(page) {
  await expect(page.locator(".stop-float-btn")).toBeVisible();
  await expect(page.locator(".stop-float-btn")).toBeHidden({ timeout: 120_000 });
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
