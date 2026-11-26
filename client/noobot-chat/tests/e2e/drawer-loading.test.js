/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { chromium } from "@playwright/test";
import { createTestViteServer } from "./helpers/vite-server.js";

test(
  "drawers share an inset loading state on desktop and mobile",
  { timeout: 60000 },
  async (t) => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const server = await createTestViteServer(t, {
      configFile: false,
      appType: "custom",
      root,
      resolve: {
        alias: {
          "fixture-runtime-params": fileURLToPath(
            new URL("../../../../shared/runtime-params.js", import.meta.url),
          ),
          "fixture-workflow-drawer": fileURLToPath(
            new URL(
              "../../../../plugin/noobot-plugin-workflow/frontend/components/workflow-message-card/WorkflowNodeSessionDrawer.vue",
              import.meta.url,
            ),
          ),
        },
      },
      plugins: [vue()],
      server: { host: "127.0.0.1", port: 0 },
    });
    server.middlewares.use("/__drawers", async (_req, res) => {
      const html = await server.transformIndexHtml(
        "/__drawers",
        `<!doctype html>
      <div id="app"></div><script type="module">
      import { createApp, h, reactive } from 'vue';
      import { createPinia } from 'pinia';
      import ElementPlus, { ElDrawer } from 'element-plus';
      import 'element-plus/dist/index.css';
      import '/src/shared/styles/style.css';
      import Drawer from '/src/shared/ui/BaseFilePreviewDrawer.vue';
      import Preview from '/src/shared/ui/BasePreviewContent.vue';
      import Message from '/src/modules/chat/components/message/SharedChatMessageItem.vue';
      import Editor from '/src/modules/settings/components/WorkspaceEditorPanel.vue';
      import Layout from '/src/modules/settings/components/SettingsWorkspaceLayout.vue';
      import Report from '/src/modules/chat/components/thinking/ExecutionReportDrawer.vue';
      import Connectors from '/src/modules/connectors/components/ConnectorManager.vue';
      import Workflow from 'fixture-workflow-drawer';
      import { configureAuthenticatedFetcher } from '/src/infrastructure/http/authenticatedHttpService.js';
      import { activateRuntimeParams, createDefaultRuntimeParamsDocument } from 'fixture-runtime-params';
      activateRuntimeParams(createDefaultRuntimeParamsDocument());
      const translate = key => key;
      const content = '<h1>Loaded preview</h1>';
      const descriptor = { name: 'file.html', type: 'html', language: 'plaintext' };
      const messageItem = {
        role: 'assistant', presentationMessageId: 'loading-message', sessionId: 'loading-session',
        toolTimeline: [{ key: 'call:patch', toolCallId: 'patch', tool: 'patch_file', status: 'completed', success: true,
          resultEvent: { eventId: 'patch-result', summary: 'patch', mutationRefs: [{ mutationId: 'patch-1', revision: 1,
            locator: { view: 'workspace', path: 'file.html' }, fileName: 'file.html', snapshot: 'available' }] } }],
      };
      window.mountDrawer = kind => {
        window.drawerApp?.unmount();
        const state = reactive({ loading: true });
        const gate = Promise.withResolvers();
        window.finishLoading = () => { state.loading = false; gate.resolve(); };
        const fetcher = async (url, options = {}) => {
          if (kind !== 'connector-add' || options.method === 'POST') await gate.promise;
          return Response.json({ ok: true, catalog: [], connectors: [], connection: { connected: true },
            diff: { lines: [{ type: 'added', newLine: 1, text: 'Loaded difference' }] } });
        };
        configureAuthenticatedFetcher(fetcher);
        const wrap = body => h(Drawer, { modelValue: true, title: kind }, () => body);
        const settingsWrap = body => h(ElDrawer, { modelValue: true, title: kind, size: innerWidth <= 768 ? '100%' : '72%',
          class: 'workspace-drawer noobot-side-drawer', appendToBody: true }, () => body);
        window.drawerApp = createApp({ render: () => {
          if (kind === 'mutation-diff') return h(Message, { messageItem, allMessages: [messageItem], userId: 'test',
            renderMarkdown: value => value, formatTime: translate, formatFileSize: translate,
            isImageMime: () => false, stopExecution: async () => true, fetchExecutionReport: async () => null });
          if (kind === 'report') return h(Report, { visible: true, messageItem, translate,
            fetchExecutionReport: async () => { await gate.promise; return null; } });
          if (kind === 'workflow') return h(Workflow, { viewerVisible: true, viewerLoading: state.loading,
            translate, executionDirectory: [], stopExecution: async () => true, fetchExecutionReport: async () => null,
            logWorkflowDiagnostics: () => {}, renderMarkdown: translate, formatTime: translate, formatFileSize: translate,
            isImageMime: () => false, resolveStateBoxLabel: translate, resolveStepLabel: translate,
            resolveStatusClass: translate, resolveStatusLabel: translate, stepHasSession: () => false });
          if (kind.startsWith('connector-')) {
            const manager = h(Connectors, { userId: 'test', connected: true, fetcher,
              drawerSize: innerWidth <= 768 ? '100%' : '72%' });
            return kind === 'connector-add' ? manager : settingsWrap(manager);
          }
          if (kind === 'settings') return settingsWrap(h(Layout, { loading: state.loading }, () =>
            h('div', { style: 'min-height: 280px' }, 'Loaded settings')));
          if (kind === 'workspace-preview') return settingsWrap(h(Layout, {}, () => h(Editor, {
            activePath: 'file.html', content, previewDescriptor: descriptor, loadingFile: state.loading,
            isTextFile: !state.loading, translate, resolveResource: async () => new Blob() })));
          return wrap(h(Preview, { descriptor, loading: kind === 'preview' && state.loading,
            textContent: kind === 'rendering' ? '<link rel="stylesheet" href="slow.css">' + content : content,
            resolveResource: async () => { await gate.promise; return new Blob(['h1 { color: red }'], { type: 'text/css' }); } }));
        } });
        window.drawerApp.use(createPinia());
        window.drawerApp.use(ElementPlus);
        window.drawerApp.mount('#app');
      };
      </script>`,
      );
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    });
    const browser = await chromium.launch({ headless: true });
    try {
      await server.listen();
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const base = `http://127.0.0.1:${server.httpServer.address().port}`;
      const cases = [
        "preview",
        "rendering",
        "mutation-diff",
        "workspace-preview",
        "settings",
        "report",
        "workflow",
        "connector-list",
        "connector-add",
      ];
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        for (const kind of cases) {
          await page.goto(`${base}/__drawers`);
          await page.waitForFunction(() => typeof window.mountDrawer === "function");
          await page.evaluate((value) => window.mountDrawer(value), kind);
          if (kind === "mutation-diff") await page.locator(".mutation-file-item").click();
          if (kind === "connector-add") {
            await page.locator(".manager-actions button").last().click();
            await page.locator(".connector-add-drawer .el-drawer__footer button").last().click();
          }
          const drawer = page.locator(".el-drawer:visible").last();
          const loading = drawer.locator(".noobot-loading-state");
          await loading.waitFor({ state: "visible" });
          await page.waitForFunction(
            () => !document.querySelector('[class*="-enter-"], [class*="-leave-"]'),
          );
          assert.equal(await loading.count(), 1, `${kind} has one loading state at ${width}px`);
          assert.equal(await drawer.locator(".el-loading-mask").count(), 0);
          const bounds = await loading.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const body = node.closest(".el-drawer__body").getBoundingClientRect();
            const skeleton = node.querySelector(".el-skeleton").getBoundingClientRect();
            const items = [...node.querySelectorAll(".el-skeleton__item")].map((item) =>
              item.getBoundingClientRect(),
            );
            return {
              gap: Math.min(
                skeleton.left - rect.left,
                rect.right - skeleton.right,
                skeleton.top - rect.top,
              ),
              bodyGap: Math.min(
                skeleton.left - body.left,
                body.right - skeleton.right,
                skeleton.top - body.top,
              ),
              width: skeleton.width,
              overflow: getComputedStyle(node).overflow,
              contained: items.every(
                (item) =>
                  item.left >= rect.left &&
                  item.right <= rect.right + 1 &&
                  item.bottom <= rect.bottom + 1,
              ),
              horizontalOverflow: node.scrollWidth > node.clientWidth + 1,
              label: node.getAttribute("aria-label"),
            };
          });
          assert.ok(
            bounds.gap >= 10,
            `${kind} loading padding at ${width}px: ${JSON.stringify(bounds)}`,
          );
          assert.ok(bounds.bodyGap >= 10, `${kind} drawer padding at ${width}px`);
          assert.ok(bounds.width <= 512.5, `${kind} skeleton has a maximum width`);
          assert.equal(bounds.overflow, "hidden");
          assert.equal(bounds.contained, true, `${kind} skeleton fits its host`);
          assert.equal(bounds.horizontalOverflow, false);
          assert.ok(bounds.label);
          const item = loading.locator(".el-skeleton__item").first();
          assert.notEqual(
            await item.evaluate((node) => getComputedStyle(node).animationName),
            "none",
          );
          await page.emulateMedia({ reducedMotion: "reduce" });
          assert.equal(await item.evaluate((node) => getComputedStyle(node).animationName), "none");
          await page.emulateMedia({ reducedMotion: "no-preference" });
          await page.evaluate(() => window.finishLoading());
          await loading.waitFor({ state: "hidden" });
          if (["preview", "rendering", "workspace-preview"].includes(kind)) {
            await drawer.frameLocator("iframe").locator("h1").waitFor();
          } else if (kind === "mutation-diff") {
            await drawer.locator(".mutation-diff-split").waitFor();
            assert.match(await drawer.textContent(), /Loaded difference/);
          } else if (kind === "connector-add") {
            await drawer.waitFor({ state: "hidden" });
          }
          assert.equal(await page.locator(".noobot-loading-state:visible").count(), 0);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
