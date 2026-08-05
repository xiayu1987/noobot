/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { assertNoForbiddenErrors } from "../helpers/log-assertions.js";
import { findProtocolObjects } from "../helpers/websocket-capture.js";

test("@smoke PBE-001 连接并创建独立 Session", async ({ noobot, protocolCapture }) => {
  expect(noobot.sessionId).toBeTruthy();
  const received = findProtocolObjects(protocolCapture.websocketReceived);
  expect(received.some(({ event }) => event === "transport_ready")).toBe(true);
  assertNoForbiddenErrors(protocolCapture.console);
});
