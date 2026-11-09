/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRenderer } from "vue";
import { probeHealth } from "../../shared/electron/runtime/health-probe.js";
import { createDesktopBootstrap } from "../../shared/electron/runtime/bootstrap.js";
import { useStartupBridge } from "../src/composables/useStartupBridge.js";

const renderer = createRenderer({
  createComment: () => ({}),
  insert() {},
  remove() {},
});

test("health failures reach startup messages and logs with their cause and reactive language", async () => {
  const originalWindow = globalThis.window;
  let receiveStatus;
  globalThis.window = {
    noobotDesktop: {
      onStartupStatus(callback) {
        receiveStatus = callback;
      },
    },
  };
  let bridge;
  const app = renderer.createApp({
    setup() {
      bridge = useStartupBridge();
      return () => null;
    },
  });
  try {
    app.mount({});
    const url = "http://127.0.0.1/health";
    for (const [fetchImpl, detail] of [
      [async () => Response.json({}), "HEALTH_INVALID_RESPONSE"],
      [async () => new Response("", { status: 401 }), "HEALTH_HTTP_ERROR: 401"],
      [async () => new Response("invalid JSON"), "JSON"],
      [
        async () => {
          throw new Error("unexpected failure");
        },
        "unexpected failure",
      ],
    ]) {
      const bootstrap = createDesktopBootstrap({
        ensureServiceStarted: () => probeHealth(url, fetchImpl),
        sendStatus: receiveStatus,
      });
      await bootstrap.openNoobot();
      assert.ok(bridge.message.value.includes(detail));
      assert.ok(bridge.message.value.includes(url));
      assert.match(bridge.message.value, /健康检查失败/);
      assert.ok(bridge.logText.value.includes(detail));
      bridge.updateSuperAdminForm({ language: "en-US" });
      assert.match(bridge.message.value, /Health check failed/);
      assert.ok(bridge.message.value.includes(detail));
      assert.match(bridge.logText.value, /Health check failed/);
      bridge.updateSuperAdminForm({ language: "zh-CN" });
    }
  } finally {
    app.unmount();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
