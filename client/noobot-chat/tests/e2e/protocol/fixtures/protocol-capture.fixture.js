/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test as base } from "./native-desktop.fixture.js";
import { sanitizeUrl } from "@noobot/sanitize";
import { createCapturedFrameLog } from "../helpers/websocket-capture.js";

export const captureTest = base.extend({
  protocolCapture: async ({ page, context }, use) => {
    const received = createCapturedFrameLog();
    const boundPages = new WeakSet();
    const removeListeners = [];
    const listen = (target, event, handler) => {
      target.on(event, handler);
      removeListeners.push(() => target.off(event, handler));
    };
    const evidence = {
      console: [],
      httpRequests: [],
      httpResponses: [],
      websockets: [],
      websocketSent: [],
      websocketReceived: received.records,
    };
    const bindPage = (target) => {
      if (boundPages.has(target)) return;
      boundPages.add(target);
      listen(target, "console", (message) =>
        evidence.console.push({ type: message.type(), text: message.text() }),
      );
      listen(target, "request", (request) =>
        evidence.httpRequests.push({
          atMs: performance.now(),
          method: request.method(),
          url: sanitizeUrl(request.url()),
          resourceType: request.resourceType(),
          ...(/replace-turn/i.test(request.url()) ? { postData: request.postData() } : {}),
        }),
      );
      listen(target, "response", async (response) => {
        const record = {
          atMs: performance.now(),
          status: response.status(),
          url: sanitizeUrl(response.url()),
        };
        if (/replace-turn/i.test(response.url()) && response.status() >= 400) {
          record.body = await response.text().catch(() => "");
        }
        evidence.httpResponses.push(record);
      });
      listen(target, "websocket", (socket) => {
        const url = sanitizeUrl(socket.url());
        evidence.websockets.push({ url });
        const captureFrame = ({ payload }) =>
          Object.freeze({ atMs: performance.now(), url, payload });
        listen(socket, "framesent", (frame) => evidence.websocketSent.push(captureFrame(frame)));
        listen(socket, "framereceived", (frame) => received.append(captureFrame(frame)));
      });
    };
    Object.defineProperty(evidence, "bindPage", { value: bindPage, enumerable: false });
    Object.defineProperty(evidence, "waitForReceivedFrame", { value: received.waitForMatch });
    bindPage(page);
    listen(context, "page", bindPage);
    try {
      await use(evidence);
    } finally {
      for (const remove of removeListeners) remove();
    }
  },
});
