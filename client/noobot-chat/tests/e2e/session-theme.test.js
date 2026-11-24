/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createTestViteServer } from "./helpers/vite-server.js";

const fixture = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<div id="app"></div><script type="module">
  import { createApp, h, ref } from 'vue';
  import ElementPlus from 'element-plus';
  import 'element-plus/dist/index.css';
  import '/src/shared/styles/style.css';
  import { activateRuntimeParams, createDefaultRuntimeParamsDocument } from '@noobot/shared/runtime-params';
  import SessionListPanel from '/src/modules/session/components/SessionListPanel.vue';
  import QuarantinedSessionsPanel from '/src/modules/session/components/QuarantinedSessionsPanel.vue';
  import { createTurnRuntimeRegistryState } from '/src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js';
  activateRuntimeParams(createDefaultRuntimeParamsDocument());
  const collapsed = ref(false), active = ref('selected'), state = ref('list');
  window.setState = (value) => { state.value = value; };
  window.setCollapsed = (value) => { collapsed.value = value; };
  const fetcher = async () => {
    if (state.value === 'error') throw new Error('fixture load failure');
    return Response.json({ ok: true, sessions: state.value === 'empty' ? [] : [{
      id: 'quarantine-record', sessionId: 'quarantined-session', title: 'Quarantined session',
      status: 'unsupported-format', errorCode: 'UNSUPPORTED_SESSION_STORAGE',
      quarantinedAt: '2026-11-24T00:00:00.000Z', quarantinePath: 'quarantine/session',
    }] });
  };
  createApp({ setup: () => () => [
    h(SessionListPanel, {
      sessions: ['selected', 'other'].map(sessionId => ({ sessionId, title: sessionId })),
      activeSessionId: active.value, turnRuntimeRegistry: createTurnRuntimeRegistryState(),
      sending: false, collapsed: collapsed.value, isMobile: innerWidth < 640,
      'onSelect-session': value => { active.value = value; },
    }),
    h(QuarantinedSessionsPanel, {
      key: state.value, userId: 'fixture', fetcher, connected: true, active: true,
    }),
  ] }).use(ElementPlus).mount('#app');
</script>`;

test(
  "session selection and quarantine states follow both themes",
  { timeout: 60000 },
  async (t) => {
    const server = await createTestViteServer(t, {
      root: fileURLToPath(new URL("../..", import.meta.url)),
      appType: "custom",
      server: { host: "127.0.0.1", port: 0 },
    });
    server.middlewares.use("/__session-theme", async (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml("/__session-theme", fixture));
    });
    await server.listen();
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}__session-theme`);
    await page.locator(".quarantine-row").waitFor();
    await page.addStyleTag({ content: "* { transition: none !important; }" });
    const colors = {};
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      colors[theme] = [];
      for (const width of [390, 1200]) {
        await page.setViewportSize({ width, height: 900 });
        for (const collapsed of [false, true]) {
          await page.evaluate((value) => window.setCollapsed(value), collapsed);
          const selected = page.locator('.session-item[aria-current="true"]');
          const other = page.locator(".session-item:not([aria-current])");
          const appearance = (el) => {
            const style = getComputedStyle(el);
            const iconElement = el.querySelector(".session-icon-wrapper");
            const icon = iconElement ? getComputedStyle(iconElement) : null;
            const title = getComputedStyle(el.querySelector(".title"));
            return [
              style.backgroundColor,
              style.borderColor,
              icon?.backgroundColor,
              icon?.color,
              title.fontWeight,
            ];
          };
          await page.mouse.move(0, 0);
          assert.deepEqual(await selected.evaluate(appearance), await other.evaluate(appearance));
          const hasMarker = (el) => {
            const style = getComputedStyle(el, "::before");
            return style.content === '\"\"' && parseFloat(style.width) > 0;
          };
          assert.equal(await selected.evaluate(hasMarker), true);
          assert.equal(await other.evaluate(hasMarker), false);
          await selected.hover();
          const selectedHover = await selected.evaluate(appearance);
          await other.hover();
          assert.deepEqual(selectedHover, await other.evaluate(appearance));
          await other.click();
          assert.equal(
            await page.locator('[data-session-id="other"]').getAttribute("aria-current"),
            "true",
          );
          assert.equal(await page.locator('[data-session-id="other"]').evaluate(hasMarker), true);
          assert.equal(
            await page.locator('[data-session-id="selected"]').evaluate(hasMarker),
            false,
          );
          await page.locator('[data-session-id="selected"]').click();
        }
        for (const state of ["list", "empty", "error"]) {
          await page.evaluate((value) => window.setState(value), state);
          const selector = { list: ".quarantine-row", empty: ".el-empty", error: ".el-alert" }[
            state
          ];
          await page.locator(selector).waitFor();
          colors[theme].push(
            await page.locator(selector).evaluate((el) => {
              const style = getComputedStyle(el);
              return [
                style.backgroundColor,
                style.color,
                style.getPropertyValue("--el-empty-fill-color-9"),
              ];
            }),
          );
          assert.equal(
            await page
              .locator(".quarantine-panel")
              .evaluate((el) => el.scrollWidth <= el.clientWidth),
            true,
          );
        }
      }
    }
    for (let i = 0; i < colors.light.length; i++)
      assert.notDeepEqual(colors.light[i], colors.dark[i]);
    assert.deepEqual(errors, []);
  },
);
