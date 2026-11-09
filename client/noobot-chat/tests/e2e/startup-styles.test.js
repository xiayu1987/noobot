/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

test(
  "startup component styles preserve forms, select poppers and shared model drawers",
  {
    timeout: 60000,
  },
  async () => {
    const root = fileURLToPath(new URL("../../../startup", import.meta.url));
    const main = await readFile(`${root}/src/main.js`, "utf8");
    const imports = main.slice(0, main.indexOf("import App from"));
    const fullImports = imports
      .replace(/import "element-plus\/es\/components\/[^\"]+";\n/g, "")
      .replace(
        'import "@noobot/client-shared/theme";',
        'import "element-plus/dist/index.css";\nimport "@noobot/client-shared/theme";',
      );
    const server = await createServer({
      configFile: false,
      root,
      appType: "custom",
      plugins: [(await import("@vitejs/plugin-vue")).default()],
      server: { host: "127.0.0.1", port: 0 },
    });
    server.middlewares.use("/__styles", async (req, res) => {
      const html = await server.transformIndexHtml(
        "/__styles",
        `<!doctype html>
      <div id="app"></div><script type="module">
      ${req.url.includes("full") ? fullImports : imports}
      import { h } from 'vue';
      import ModelPicker from '@noobot/client-shared/ui/model-picker';
      import '/src/style.css';
      const app = createApp({ render: () => h('div', [
        h(ElAlert, { title: 'Alert', type: 'error', showIcon: true }),
        h(ElCard, {}, () => 'Log'),
        h(ElCheckboxGroup, { modelValue: ['a'] }, () => [
          h(ElCheckbox, { value: 'a' }, () => 'Dependency'),
          h(ElCheckbox, { value: 'b', disabled: true }, () => 'Disabled'),
        ]),
        h(ElForm, { labelPosition: 'top' }, () => [
          h(ElFormItem, { label: 'Name', error: 'Required' }, () => h(ElInput, { modelValue: 'User' })),
          h(ElFormItem, { label: 'Language' }, () => h(ElSelect, { modelValue: 'en', id: 'language' }, () => [
            h(ElOption, { value: 'en', label: 'English' }),
            h(ElOption, { value: 'zh', label: 'Chinese' }),
          ])),
        ]),
        h(ElButton, { type: 'primary' }, () => 'Continue'),
        h(ElButton, { disabled: true }, () => 'Disabled'),
        h(ElTag, {}, () => 'Status'),
        h(ElIcon, {}, () => h('svg', { viewBox: '0 0 24 24' })),
        h(ModelPicker, { translate: key => key, drawerSize: '80%' }),
      ]) });
      ${main.slice(main.indexOf("for (const component"), main.indexOf("app.mount"))}
      app.mount('#app');
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
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      async function snapshot() {
        await page.waitForFunction(
          () => !document.querySelector('[class*="-enter-"], [class*="-leave-"]'),
        );
        return page.locator('[class*="el-"]').evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element);
            return Object.fromEntries(
              [
                "display",
                "position",
                "width",
                "height",
                "padding",
                "margin",
                "border",
                "borderRadius",
                "backgroundColor",
                "color",
                "fontSize",
                "lineHeight",
                "boxShadow",
                "overflow",
                "zIndex",
                "opacity",
                "transform",
              ].map((property) => [property, style[property]]),
            );
          }),
        );
      }
      for (const width of [1200, 600]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ["light", "dark"]) {
          const samples = [];
          for (const mode of ["full", "components"]) {
            await page.goto(`${server.resolvedUrls.local[0]}__styles?${mode}`);
            await page.locator(".model-picker-trigger").waitFor();
            await page.evaluate(
              (value) => document.documentElement.setAttribute("data-theme", value),
              theme,
            );
            await page.addStyleTag({
              content:
                "*, *::before, *::after { transition: none !important; animation: none !important; }",
            });
            await page.mouse.move(0, 899);
            const states = [await snapshot()];
            await page.locator(".el-select__wrapper").click();
            await page.locator(".el-select-dropdown").waitFor({ state: "visible" });
            states.push(await snapshot());
            await page.getByRole("option", { name: "Chinese", exact: true }).click();
            await page.locator(".model-picker-trigger").click();
            await page.locator(".model-picker-drawer").waitFor({ state: "visible" });
            states.push(await snapshot());
            assert.equal(await page.locator(".model-picker-search .el-input__wrapper").count(), 1);
            await page.locator(".model-picker-default").click();
            await page.locator(".model-picker-drawer").waitFor({ state: "hidden" });
            samples.push(states);
          }
          assert.deepEqual(samples[1], samples[0], `${theme} ${width}px styles match full CSS`);
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);
