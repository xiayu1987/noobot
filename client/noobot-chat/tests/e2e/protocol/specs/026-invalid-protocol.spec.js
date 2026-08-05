/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { findProtocolObjects, waitForCaptured } from "../helpers/websocket-capture.js";

test("@full PBE-026 非法和旧协议拒绝", async ({ noobot, protocolCapture }) => {
  const transportReady = findProtocolObjects(protocolCapture.websocketReceived)
    .find(({ event }) => event === "transport_ready");
  const socketUrl = transportReady?.frame?.url;
  expect(socketUrl, "connected product WebSocket URL is required").toBeTruthy();
  const invalidFrames = [
    { action: "continue", sessionId: noobot.sessionId },
    { protocolVersion: 2, commandType: "turn.send", commandId: "invalid:unknown", identity: { sessionId: noobot.sessionId, turnScopeId: "client-turn:invalid" }, unknown: true },
    { protocolVersion: 2, commandType: "turn.continue", commandId: "invalid:continue", identity: { sessionId: noobot.sessionId, turnScopeId: "client-turn:invalid-continue" } },
    { protocolVersion: 2, commandType: "turn.stop", commandId: "invalid:stop", identity: { sessionId: noobot.sessionId, turnScopeId: "client-turn:invalid-stop" }, concurrency: { expectedTurnRevision: 0 }, stop: {} },
  ];
  const results = await noobot.page.evaluate(async ({ url, frames }) => {
    const socket = new WebSocket(url);
    const received = [];
    socket.addEventListener("message", (event) => received.push(String(event.data)));
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    frames.forEach((frame) => socket.send(JSON.stringify(frame)));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    socket.close();
    return received;
  }, { url: socketUrl, frames: invalidFrames });
  await waitForCaptured(() => results.length > 0 && results);
  const evidence = results.join("\n");
  expect(evidence).toMatch(/error|invalid|reject|unsupported/i);
  expect(evidence).not.toMatch(/turn\.action_accepted|turn\.processing_started/);
});
