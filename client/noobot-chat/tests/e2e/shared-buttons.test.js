/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createTestViteServer } from "./helpers/vite-server.js";
import vue from "@vitejs/plugin-vue";
import { chromium } from "@playwright/test";

test(
  "shared buttons preserve variants and states across clients, themes and viewports",
  { timeout: 60000 },
  async (t) => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const startupStyle = fileURLToPath(new URL("../../../startup/src/style.css", import.meta.url));
    const server = await createTestViteServer(t, {
      configFile: false,
      appType: "custom",
      root,
      resolve: { alias: { "fixture-startup-style": startupStyle } },
      server: { host: "127.0.0.1", port: 0 },
    });
    server.middlewares.use("/__buttons", async (req, res) => {
      const chat = req.url.includes("chat");
      const html = await server.transformIndexHtml(
        "/__buttons",
        `<!doctype html>
      <div id="app"></div><script type="module">
      import { createApp, h } from 'vue';
      import { ElButton } from 'element-plus';
      import 'element-plus/dist/index.css';
      ${
        chat
          ? "import '/src/shared/styles/style.css';"
          : `
      import '@noobot/client-shared/styles/theme.css';
      import '@noobot/client-shared/styles/element-plus.css';
      import 'fixture-startup-style';`
      }
      createApp({ render: () => h('div', [
        ...[
          ['default', {}], ['primary', {type: 'primary'}],
          ['disabled', {type: 'primary', disabled: true}],
          ['plain', {type: 'primary', plain: true}],
          ['text', {type: 'primary', text: true}],
          ['link', {type: 'primary', link: true}],
          ['icon', {class: 'noobot-icon-button'}],
        ].map(([id, props]) => h(ElButton, {id, ...props}, () => id)),
      ]) }).mount('#app');
      </script>`,
      );
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      for (const width of [1200, 600]) {
        await page.setViewportSize({ width, height: 800 });
        for (const theme of ["dark", "light"]) {
          const clients = [];
          for (const client of ["startup", "chat"]) {
            await page.goto(`${server.resolvedUrls.local[0]}__buttons?${client}`);
            await page.waitForSelector("#primary.el-button");
            await page.evaluate(
              (value) => document.documentElement.setAttribute("data-theme", value),
              theme,
            );
            await page.mouse.move(0, 700);
            await page.waitForTimeout(250);
            clients.push(
              await page.evaluate(() => {
                const result = {};
                for (const id of [
                  "default",
                  "primary",
                  "disabled",
                  "plain",
                  "text",
                  "link",
                  "icon",
                ]) {
                  const style = getComputedStyle(document.getElementById(id));
                  result[id] = {
                    background: style.backgroundColor,
                    color: style.color,
                    radius: style.borderRadius,
                    minHeight: style.minHeight,
                    padding: style.padding,
                    aspectRatio: style.aspectRatio,
                  };
                }
                return result;
              }),
            );
            const styles = clients.at(-1);
            assert.equal(styles.default.minHeight, width > 768 ? "30px" : "34px");
            assert.notEqual(
              styles.disabled.background,
              styles.primary.background,
              `${client} disabled state`,
            );
            for (const variant of ["plain", "text", "link"]) {
              assert.notEqual(
                styles[variant].background,
                styles.primary.background,
                `${client} ${variant} state`,
              );
            }
            assert.equal(styles.icon.radius, "50%");
            assert.equal(styles.icon.padding, "0px");
            assert.equal(styles.icon.aspectRatio, "1 / 1");
            await page.locator("#primary").hover();
            await page.waitForTimeout(250);
            const hover = await page
              .locator("#primary")
              .evaluate((element) => getComputedStyle(element).backgroundColor);
            assert.notEqual(hover, styles.primary.background, `${client} hover state`);
          }
          assert.deepEqual(clients[0], clients[1], `${theme} ${width}px shared contract`);
        }
      }
    } finally {
      await browser?.close();
    }
  },
);

test(
  "thinking detail pagination keeps both icon buttons inside the drawer",
  { timeout: 60000 },
  async (t) => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const server = await createTestViteServer(t, {
      configFile: false,
      appType: "custom",
      root,
      plugins: [vue()],
      server: { host: "127.0.0.1", port: 0 },
    });
    server.middlewares.use("/__thinking-pagination", async (_req, res) => {
      const html = await server.transformIndexHtml(
        "/__thinking-pagination",
        `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
      <div id="app"></div><script type="module">
      import { createApp, h, ref } from 'vue';
      import { ElButton, ElDrawer, ElTabs, ElTabPane } from 'element-plus';
      import 'element-plus/dist/index.css';
      import '/src/shared/styles/style.css';
      import ThinkingPanelDetails from '/src/modules/chat/components/thinking/ThinkingPanelDetails.vue';
      import { useMobileViewport } from '/src/shared/composables/useMobileViewport.js';
      import { activateRuntimeParams, createDefaultRuntimeParamsDocument } from '@noobot/shared/runtime-params';
      import { translateMessageKey } from '/src/shared/i18n/messageCatalog.js';
      activateRuntimeParams(createDefaultRuntimeParamsDocument());
      const translate = (key, values) => translateMessageKey('en-US', key, values);
      const noop = () => {};
      const app = createApp({ setup() {
        const { drawerSize } = useMobileViewport();
        const lastPage = ref(false);
        return () => h(ElDrawer, { modelValue: true, size: drawerSize.value, class: 'noobot-side-drawer' }, () =>
          h(ThinkingPanelDetails, {
            messageItem: {}, translate, getTreePrefix: noop, getDetailKey: noop,
            isExpanded: () => false, toggleExpanded: noop,
            page: lastPage.value
              ? { after: 999999999, count: 1, messageCount: 1000000000, nextCursor: null }
              : { after: 999999998, count: 1, messageCount: 1000000000, nextCursor: {} },
            onNextPage: () => { lastPage.value = true; },
            onRestartPages: () => { lastPage.value = false; },
          }),
        );
      } });
      app.component('ElButton', ElButton).component('ElTabs', ElTabs).component('ElTabPane', ElTabPane);
      app.mount('#app');
      </script>`,
      );
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch();
      const page = await browser.newPage({ isMobile: true, hasTouch: true });
      for (const width of [320, 390, 1200]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`${server.resolvedUrls.local[0]}__thinking-pagination`);
        const refresh = page.getByRole("button", { name: "Refresh", exact: true });
        const nextPage = page.getByRole("button", { name: "Next page", exact: true });
        const drawerBody = page.locator(".el-drawer__body");
        await nextPage.click({ trial: true });
        const bounds = await drawerBody.boundingBox();
        for (const button of [refresh, nextPage]) {
          assert.equal(await button.textContent(), "");
          assert.equal(await button.locator("svg").count(), 1);
          const box = await button.boundingBox();
          assert.ok(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width);
          assert.ok(box.x >= 0 && box.x + box.width <= width);
        }
        await nextPage.click();
        assert.ok(await nextPage.isDisabled());
        await refresh.click();
        assert.ok(await nextPage.isEnabled());
      }
    } finally {
      await browser?.close();
    }
  },
);
