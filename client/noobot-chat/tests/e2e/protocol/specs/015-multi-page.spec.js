/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { connectThroughUi, readE2eCredentials } from "../fixtures/auth.fixture.js";
import {
  selectPlugins,
  sendMessage,
  stopActiveTurn,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import { waitForCommand, waitForLifecycle } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

test("@full PBE-015 双标签页生命周期一致性", async ({
  noobot,
  protocolCapture,
  browser,
}, testInfo) => {
  await sendMessage(noobot.page, uniquePrompt(testInfo, "multi-page session provision"));
  const provision = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    provision.identity.turnScopeId,
  );
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: provision.identity.turnScopeId,
  });

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  protocolCapture.bindPage(secondPage);
  try {
    await secondPage.goto(`/?session=${encodeURIComponent(noobot.sessionId)}`);
    await connectThroughUi(secondPage, readE2eCredentials());
    await expect(secondPage.locator(".session-item.active")).toHaveAttribute(
      "data-session-id",
      noobot.sessionId,
    );
    await expect(secondPage.locator(".stop-float-btn")).toBeHidden();

    const livePrompt = uniquePrompt(testInfo, "multi-page active turn answer briefly");
    const assistantCountBefore = await secondPage.locator(".base-message-shell.assistant").count();
    await sendMessage(noobot.page, livePrompt);
    const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send", 1);
    await waitForLifecycle(
      protocolCapture,
      noobot.sessionId,
      "turn.processing_started",
      0,
      send.identity.turnScopeId,
    );
    await expect(
      secondPage.locator(".base-message-shell.user").filter({ hasText: livePrompt }),
    ).toBeVisible();
    await expect(secondPage.locator(".base-message-shell.assistant")).toHaveCount(
      assistantCountBefore + 1,
    );
    await expect(secondPage.locator(".stop-float-btn")).toBeVisible();
    await waitForNaturalCompletion({
      page: noobot.page,
      capture: protocolCapture,
      sessionId: noobot.sessionId,
      turnScopeId: send.identity.turnScopeId,
    });
    await expect(
      secondPage
        .locator(".base-message-shell.assistant")
        .nth(assistantCountBefore)
        .locator(".base-markdown-content"),
    ).toContainText(/\S+/);
    await expect(secondPage.locator(".stop-float-btn")).toBeHidden();
    await expect(noobot.page.locator(".stop-float-btn")).toBeHidden();
  } finally {
    await secondContext.close();
  }
});

test("@full PBE-046 双标签页 Workflow 消息与卡片一致性", async ({
  noobot,
  protocolCapture,
  browser,
}, testInfo) => {
  test.setTimeout(600000);
  await sendMessage(noobot.page, uniquePrompt(testInfo, "multi-page workflow provision"));
  const provision = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    provision.identity.turnScopeId,
  );
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: provision.identity.turnScopeId,
    timeoutMs: 240000,
  });

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  protocolCapture.bindPage(secondPage);
  try {
    await secondPage.goto(`/?session=${encodeURIComponent(noobot.sessionId)}`);
    await connectThroughUi(secondPage, readE2eCredentials());
    await expect(secondPage.locator(".session-item.active")).toHaveAttribute(
      "data-session-id",
      noobot.sessionId,
    );
    await selectPlugins(noobot.page, ["workflow", "harness"]);
    const workflowPrompt = uniquePrompt(
      testInfo,
      "create exactly one workflow child named sync-card that answers 19 + 23, then execute it immediately",
    );
    const assistantCountBefore = await secondPage.locator(".base-message-shell.assistant").count();
    await sendMessage(noobot.page, workflowPrompt);
    const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send", 1);
    await waitForLifecycle(
      protocolCapture,
      noobot.sessionId,
      "turn.processing_started",
      0,
      send.identity.turnScopeId,
    );

    await expect(
      secondPage.locator(".base-message-shell.user").filter({ hasText: workflowPrompt }),
    ).toBeVisible();
    await expect(secondPage.locator(".base-message-shell.assistant")).toHaveCount(
      assistantCountBefore + 1,
    );
    await expect(noobot.page.locator(".workflow-card").last()).toBeVisible({ timeout: 240000 });
    await expect(secondPage.locator(".workflow-card").last()).toBeVisible({ timeout: 240000 });
    await expect(secondPage.locator(".workflow-preview-toggle").last()).toBeVisible();
    await expect(secondPage.locator(".workflow-card-preview-shell").last()).toBeHidden();
    await expect(secondPage.locator(".stop-float-btn")).toBeVisible();

    await stopActiveTurn(secondPage);
    await waitForLifecycle(
      protocolCapture,
      noobot.sessionId,
      "turn.stop_completed",
      0,
      send.identity.turnScopeId,
    );
    await expect(noobot.page.locator(".stop-float-btn")).toBeHidden();
    await expect(secondPage.locator(".stop-float-btn")).toBeHidden();
  } finally {
    await secondContext.close();
  }
});
