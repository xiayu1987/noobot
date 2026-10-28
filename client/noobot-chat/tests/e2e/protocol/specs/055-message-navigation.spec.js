/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { sendMessage, waitForNaturalCompletion } from "../helpers/browser-actions.js";
import { cycleOffline, reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import { commandsForSession, waitForCommand } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

const ANCHOR_TOP_OFFSET_PX = 16;
const ANCHOR_TOP_TOLERANCE_PX = 2;
const TURN_COUNT = 3;

function anchorIdFragment(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function navigatorItemForTurn(page, turnScopeId) {
  return page.locator(`[data-chat-message-nav-id*="--${anchorIdFragment(turnScopeId)}-"]`).first();
}

async function turnAnchorId(page, turnScopeId) {
  const item = navigatorItemForTurn(page, turnScopeId);
  await expect(item).toHaveCount(1);
  return item.getAttribute("data-chat-message-nav-id");
}

function anchorOffsetFromListTop(page, anchorId) {
  return page.evaluate((id) => {
    const wrap = document.querySelector(".msg-list .el-scrollbar__wrap");
    if (!wrap) throw new Error("message list scroll wrap missing");
    const anchor = wrap.querySelector(`[data-chat-message-anchor="${CSS.escape(id)}"]`);
    if (!anchor) return null;
    return anchor.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
  }, anchorId);
}

async function expectAnchorAtListTop(page, anchorId) {
  await expect
    .poll(async () => {
      const offset = await anchorOffsetFromListTop(page, anchorId);
      return offset === null ? null : Math.abs(offset - ANCHOR_TOP_OFFSET_PX);
    })
    .toBeLessThanOrEqual(ANCHOR_TOP_TOLERANCE_PX);
}

function routedTurn(page) {
  return new URL(page.url()).searchParams.get("turn");
}

async function sendLongTurn({ page, capture, sessionId, testInfo, index }) {
  const after = commandsForSession(capture, sessionId).filter(
    (command) => command.commandType === "turn.send",
  ).length;
  await sendMessage(
    page,
    uniquePrompt(
      testInfo,
      `navigation turn ${index}: reply with exactly 80 numbered lines, each line "line N", and do not use tools`,
    ),
  );
  const send = await waitForCommand(capture, sessionId, "turn.send", after);
  await waitForNaturalCompletion({
    page,
    capture,
    sessionId,
    turnScopeId: send.identity.turnScopeId,
  });
  return send.identity.turnScopeId;
}

test("@core PBE-056 刷新、重连与点击导航按 URL turn、最新轮次精确落位", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  const { page, sessionId } = noobot;
  const turnScopeIds = [];
  for (let index = 1; index <= TURN_COUNT; index += 1) {
    turnScopeIds.push(
      await sendLongTurn({ page, capture: protocolCapture, sessionId, testInfo, index }),
    );
  }
  const [firstTurn, secondTurn, lastTurn] = turnScopeIds;

  const scrollRatio = await page
    .locator(".msg-list .el-scrollbar__wrap")
    .evaluate((wrap) => wrap.scrollHeight / wrap.clientHeight);
  expect(scrollRatio).toBeGreaterThan(TURN_COUNT);

  expect(routedTurn(page)).toBeNull();
  await reloadAndWaitForReconnect(page, protocolCapture);
  await expectAnchorAtListTop(page, await turnAnchorId(page, lastTurn));
  expect(routedTurn(page)).toBeNull();

  const firstAnchorId = await turnAnchorId(page, firstTurn);
  await navigatorItemForTurn(page, firstTurn).click();
  await expect.poll(() => routedTurn(page)).toBe(firstTurn);
  await expectAnchorAtListTop(page, firstAnchorId);

  await reloadAndWaitForReconnect(page, protocolCapture);
  expect(routedTurn(page)).toBe(firstTurn);
  await expectAnchorAtListTop(page, await turnAnchorId(page, firstTurn));

  await cycleOffline(page, protocolCapture);
  expect(routedTurn(page)).toBe(firstTurn);
  await expectAnchorAtListTop(page, await turnAnchorId(page, firstTurn));

  await page.evaluate((turnScopeId) => {
    const url = new URL(location.href);
    url.searchParams.set("turn", turnScopeId);
    history.replaceState(history.state, "", url);
  }, secondTurn);
  await reloadAndWaitForReconnect(page, protocolCapture);
  await expectAnchorAtListTop(page, await turnAnchorId(page, secondTurn));
  expect(routedTurn(page)).toBe(secondTurn);
});
