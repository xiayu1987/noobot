/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { editLatestUserMessage, stopActiveTurn } from "../helpers/browser-actions.js";
import { findReplaceTurnExchanges } from "../helpers/http-capture.js";
import { readSessionFact } from "../helpers/persistence-audit.js";
import { waitForCommand, waitForLifecycle } from "../helpers/scenario-assertions.js";
import { sendAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-042 停止后不刷新立即编辑重发", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  const { send } = await sendAndStop({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "stop before same-page edit resend"),
  });

  await expect
    .poll(
      async () => (await readSessionFact(noobot.userId, noobot.sessionId)).aggregateVersion,
      { timeout: 15000 },
    )
    .toBeGreaterThan(send.concurrency.expectedAggregateVersion);
  const stoppedSession = await readSessionFact(noobot.userId, noobot.sessionId);
  const stoppedAggregateVersion = Number(stoppedSession.aggregateVersion);
  expect(Number.isSafeInteger(stoppedAggregateVersion)).toBe(true);
  expect(stoppedAggregateVersion).toBeGreaterThan(send.concurrency.expectedAggregateVersion);

  await editLatestUserMessage(
    noobot.page,
    uniquePrompt(testInfo, "same-page replacement without refresh"),
  );

  await expect.poll(() => findReplaceTurnExchanges(protocolCapture).length).toBe(1);
  const [replacementExchange] = findReplaceTurnExchanges(protocolCapture);
  const replacementRequest = JSON.parse(replacementExchange.request.postData);
  expect(replacementRequest.expectedAggregateVersion).toBe(stoppedAggregateVersion);
  await expect
    .poll(() => findReplaceTurnExchanges(protocolCapture).at(-1)?.responses.at(-1)?.status || 0)
    .toBe(200);

  const resend = await waitForCommand(protocolCapture, noobot.sessionId, "turn.resend");
  const processing = await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    resend.identity.turnScopeId,
  );
  expect(processing.dialogProcessId).toBe(resend.identity.dialogProcessId);
  await stopActiveTurn(noobot.page);
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.stop_completed",
    0,
    resend.identity.turnScopeId,
  );
});
