/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { chromium } from "@playwright/test";

test(
  "HTML preview renders resources in an opaque sandbox and keeps source readable",
  { timeout: 60000 },
  async () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const runtime = fileURLToPath(new URL("../../../../shared/runtime-params.js", import.meta.url));
    const server = await createServer({
      configFile: false,
      appType: "custom",
      root,
      plugins: [vue()],
      server: { host: "127.0.0.1", port: 0 },
    });
    server.middlewares.use("/__preview", async (req, res) => {
      const html = await server.transformIndexHtml(
        "/__preview",
        `<!doctype html><style>
      #app { height: 420px; display: flex; flex-direction: column; }
      #app > .workspace-editor { flex: 1; min-height: 0; }
      </style><div id="app"></div><script type="module">
      import { createApp, h, reactive, nextTick } from 'vue';
      import Preview from '/src/shared/ui/BasePreviewContent.vue';
      import Editor from '/src/modules/settings/components/WorkspaceEditorPanel.vue';
      import MutationFile from '/src/modules/chat/components/thinking/MutationFileContent.vue';
      import MutationPreview from '/src/modules/chat/components/thinking/FileMutationPreview.vue';
      import ElementPlus from 'element-plus';
      import 'element-plus/dist/index.css';
      import '/src/shared/styles/components/workspace-panel.css';
      import '/src/shared/styles/components/preview.css';
      import { activateRuntimeParams, createDefaultRuntimeParamsDocument } from '/@fs/${runtime}';
      activateRuntimeParams(createDefaultRuntimeParamsDocument());
      window.emptyFrames = [];
      window.mountMutation = (content = '<h1>Written snapshot</h1>', fileName = 'written.html', inline = false) => {
        const mutation = { mutationId: 'written-file', fileName, locator: {view: 'workspace', path: fileName}, additions: 1, deletions: 0 };
        window.previewApp = createApp({ render: () => h(inline ? MutationPreview : MutationFile, {
          ...(inline ? { mutations: [mutation] } : { mutation }),
          userId: 'admin', sessionId: 'session', translate: (key) => key,
          service: { getFile: async () => ({ content, size: new TextEncoder().encode(content).length, isText: true }) },
        }) });
        window.previewApp.use(ElementPlus);
        window.previewApp.mount('#app');
      };
      new MutationObserver(() => {
        for (const frame of document.querySelectorAll('iframe'))
          if (!frame.getAttribute('srcdoc')) window.emptyFrames.push(frame.outerHTML);
      }).observe(document.querySelector('#app'), { childList: true, subtree: true, attributes: true });
      window.mountPreview = (content, workspace = false) => {
        window.previewState = reactive({
          descriptor: { name: 'page.html', type: 'html', language: 'plaintext' },
          textContent: content, loading: false, active: true,
        });
        window.updatePreview = async (value) => {
          Object.assign(window.previewState, value);
          await nextTick();
        };
        const resolveResource = async (path) => {
          window.resourceReads = (window.resourceReads || 0) + 1;
          if (path === 'print.css') return new Blob(['main { display: none }'], { type: 'text/css' });
          if (path === 'screen.css') return new Blob(['main { color: rgb(12, 34, 56) }'], { type: 'text/css' });
          if (path === 'query.css') return new Blob(['main { background-color: rgb(45, 67, 89) }'], { type: 'text/css' });
          if (path === 'site.css') return new Blob(['h1 { color: rgb(12, 34, 56); } #background { width: 20px; height: 20px; background-image: url("pixel.svg"); }'], { type: 'text/css' });
          if (path === 'pixel.svg') return new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>'], { type: 'image/svg+xml' });
          throw new Error('unexpected resource');
        };
        window.previewApp = createApp({ render: () => workspace ? h(Editor, {
          activePath: window.previewState.descriptor.name,
          content: window.previewState.textContent,
          previewDescriptor: window.previewState.descriptor,
          loadingFile: window.previewState.loading,
          isTextFile: !window.previewState.loading,
          translate: (key) => key, resolveResource,
        }) : h(Preview, { ...window.previewState, resolveResource }) });
        window.previewApp.use(ElementPlus);
        window.previewApp.mount('#app');
      };
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
      page.on("pageerror", (error) => console.error("Preview page error:", error));
      page.on("console", (message) => {
        if (message.type() === "error") console.error("Preview console:", message.text());
      });
      const base = `http://127.0.0.1:${server.httpServer.address().port}`;
      await page.goto(`${base}/__preview`);
      await page.waitForFunction(() => typeof window.mountPreview === "function");
      await page.evaluate(() =>
        window.mountPreview(
          `<link rel="StyleSheet" media="print" href="print.css"><link rel="stylesheet" media="screen" href="screen.css"><link rel="stylesheet" media="screen and (min-width: 600px)" href="query.css"><link rel="alternate stylesheet" title="Other" href="print.css"><main style="--label: {foo: bar; baz: qux}; --image: url('pixel.svg'); background-image:var(--image); broken">Required body content</main>`,
        ),
      );
      const conditions = page.frameLocator("iframe").locator("main");
      await conditions.waitFor();
      const computed = () =>
        conditions.evaluate((node) => ({
          display: getComputedStyle(node).display,
          color: getComputedStyle(node).color,
          background: getComputedStyle(node).backgroundColor,
          custom: getComputedStyle(node).getPropertyValue("--label").trim(),
          image: getComputedStyle(node).backgroundImage,
        }));
      const screen = await computed();
      assert.notEqual(screen.display, "none");
      assert.equal(screen.color, "rgb(12, 34, 56)");
      assert.equal(screen.background, "rgb(45, 67, 89)");
      assert.equal(screen.custom, "{foo: bar; baz: qux}");
      assert.ok(screen.image.includes("data:image/svg+xml;base64,"));
      await page.emulateMedia({ media: "print" });
      assert.equal((await computed()).display, "none");
      await page.emulateMedia({ media: "screen" });
      await page.setViewportSize({ width: 390, height: 800 });
      assert.equal((await computed()).background, "rgba(0, 0, 0, 0)");
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.evaluate(() => window.previewApp.unmount());
      const content =
        `<style>@import "https://external.invalid/import.css"; #css-string::before { content: '@import'; }</style><div id="css-string" style="--label: '@import'; color: rgb(123, 45, 67)">Required body content</div>` +
        '<link rel="stylesheet" href="site.css"><h1>Preview</h1><img id="relative" src="pixel.svg"><div id="background"></div><img id="blocked" src="https://external.invalid/pixel.png"><script>parent.compromised=true; fetch("/escape")</script><img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E" onload="parent.compromised=true"><a href="https://external.invalid" target="_top">escape</a><form action="/escape"><button>send</button></form>';
      const escapes = [];
      page.on("request", (request) => {
        if (request.url().includes("/escape") || request.url().includes("external.invalid"))
          escapes.push(request.url());
      });
      await page.evaluate((source) => window.mountPreview(source), content);
      const frame = page.frameLocator("iframe");
      await frame.locator("h1").waitFor();
      assert.equal(
        await frame.locator("h1").evaluate((node) => getComputedStyle(node).color),
        "rgb(12, 34, 56)",
      );
      await frame.locator("#relative").evaluate((image) => image.decode());
      assert.equal(await frame.locator("#relative").evaluate((image) => image.naturalWidth), 2);
      const background = await frame.locator("#background").evaluate(async (node) => {
        const source = getComputedStyle(node).backgroundImage.slice(5, -2);
        const image = new Image();
        image.src = source;
        await image.decode();
        return image.naturalWidth;
      });
      assert.equal(background, 2);
      assert.equal(await frame.locator("#css-string").textContent(), "Required body content");
      assert.equal(
        await frame.locator("#css-string").evaluate((node) => getComputedStyle(node).color),
        "rgb(123, 45, 67)",
      );
      assert.equal(
        await frame
          .locator("#css-string")
          .evaluate((node) => getComputedStyle(node, "::before").content),
        '"@import"',
      );
      assert.equal(await frame.locator('[data-preview-resource-status="rejected"]').count(), 2);
      assert.equal(await page.locator("iframe").getAttribute("sandbox"), "");
      assert.equal(await page.evaluate(() => window.compromised), undefined);
      assert.equal(await frame.locator("script,form,[onload],a[href]").count(), 0);
      assert.equal(
        await frame.locator("h1").evaluate(() => {
          try {
            return parent.document.body.innerHTML;
          } catch (error) {
            return error.name;
          }
        }),
        "SecurityError",
      );
      await frame.locator("a").click();
      assert.equal(page.url(), `${base}/__preview`);
      assert.deepEqual(escapes, []);
      await page.getByRole("tab").nth(1).click();
      assert.equal(await page.locator("pre").textContent(), content);
      assert.equal(await page.locator("iframe").count(), 0);
      const initialReads = await page.evaluate(() => window.resourceReads);
      for (let iteration = 0; iteration < 3; iteration += 1) {
        await page.getByRole("tab").nth(0).click();
        await frame.locator("h1").waitFor();
        assert.equal(await frame.locator("h1").textContent(), "Preview");
        await page.getByRole("tab").nth(1).click();
        assert.equal(await page.locator("pre").textContent(), content);
      }
      assert.equal(await page.evaluate(() => window.resourceReads), initialReads);
      await page.getByRole("tab").nth(0).click();
      for (let iteration = 0; iteration < 3; iteration += 1) {
        await page.evaluate(() => window.updatePreview({ loading: true, textContent: "" }));
        await page.evaluate(
          (textContent) =>
            window.updatePreview({
              loading: false,
              textContent,
              descriptor: { name: "page.html", type: "html", language: "plaintext" },
            }),
          content,
        );
        await frame.locator("h1").waitFor();
        await page.evaluate(() => window.updatePreview({ active: false }));
        await page.evaluate(() => window.updatePreview({ active: true }));
        await frame.locator("h1").waitFor();
      }
      await page.evaluate((source) => {
        window.previewApp.unmount();
        window.mountPreview(source, true);
      }, content);
      await frame.locator("h1").waitFor();
      for (let iteration = 0; iteration < 3; iteration += 1) {
        await page.evaluate(() => window.updatePreview({ loading: true, textContent: "" }));
        await page.evaluate(
          (textContent) =>
            window.updatePreview({
              loading: false,
              textContent,
              descriptor: { name: "page.html", type: "html", language: "plaintext" },
            }),
          content,
        );
        await frame.locator("h1").waitFor();
        await page.getByRole("tab").nth(1).click();
        await page.locator("textarea").waitFor();
        await page.getByRole("tab").nth(0).click();
        await frame.locator("h1").waitFor();
      }
      assert.deepEqual(await page.evaluate(() => window.emptyFrames), []);
      const longContent =
        '<h1>Long page</h1><div style="height: 3000px">End</div>' + "\n".repeat(300);
      await page.evaluate((textContent) => window.updatePreview({ textContent }), longContent);
      await frame.locator("h1").waitFor();
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        assert.equal(
          await page
            .locator(".preview-body")
            .evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
          true,
        );
        assert.equal(
          await page
            .locator(".editor-body")
            .evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
          true,
        );
        assert.equal(
          await frame.locator("html").evaluate((node) => node.scrollHeight > node.clientHeight),
          true,
        );
        await page.getByRole("tab").nth(1).click();
        assert.equal(
          await page.locator("textarea").evaluate((node) => node.scrollHeight > node.clientHeight),
          true,
        );
        assert.equal(
          await page
            .locator(".preview-page")
            .evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
          true,
        );
        assert.equal(
          await page
            .locator(".preview-body")
            .evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
          true,
        );
        await page.getByRole("tab").nth(0).click();
        await frame.locator("h1").waitFor();
      }
      const samples = 8000 * 30;
      const wav = Buffer.alloc(44 + samples * 2);
      wav.write("RIFF", 0);
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24);
      wav.writeUInt32LE(16000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(samples * 2, 40);
      await page.evaluate(async (base64) => {
        window.previewApp.unmount();
        window.mountPreview("");
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: "audio/wav" });
        window.audioUrls = [URL.createObjectURL(blob), URL.createObjectURL(blob)];
        await window.updatePreview({
          descriptor: { name: "sound.wav", type: "audio", language: "plaintext" },
          url: window.audioUrls[0],
        });
      }, wav.toString("base64"));
      await page.waitForFunction(() => document.querySelector("audio")?.readyState >= 1);
      await page.locator("audio").evaluate(async (audio) => {
        audio.currentTime = 5;
        await audio.play();
      });
      await page.evaluate(() => window.updatePreview({ url: window.audioUrls[1] }));
      await page.waitForFunction(() => {
        const audio = document.querySelector("audio");
        return audio.currentSrc === window.audioUrls[1] && audio.currentTime >= 5 && !audio.paused;
      });
      await page.locator("audio").evaluate((audio) => {
        audio.pause();
        audio.currentTime = 10;
      });
      await page.evaluate(() => window.updatePreview({ url: window.audioUrls[0] }));
      await page.waitForFunction(() => {
        const audio = document.querySelector("audio");
        return audio.currentSrc === window.audioUrls[0] && audio.currentTime >= 10 && audio.paused;
      });
      await page.evaluate(() => {
        window.previewApp.unmount();
        window.audioUrls.forEach((url) => URL.revokeObjectURL(url));
      });
      for (let opening = 0; opening < 2; opening += 1) {
        await page.evaluate(() => window.mountMutation());
        await page.frameLocator("iframe").locator("h1").waitFor();
        assert.equal(
          await page.frameLocator("iframe").locator("h1").textContent(),
          "Written snapshot",
        );
        await page.getByRole("tab").nth(1).click();
        assert.match(await page.locator(".preview-text").textContent(), /Written snapshot/);
        await page.getByRole("tab").nth(0).click();
        await page.frameLocator("iframe").locator("h1").waitFor();
        await page.evaluate(() => window.previewApp.unmount());
      }
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(() =>
          window.mountMutation(
            "<h1>Long snapshot</h1>\n" + "<p>line</p>\n".repeat(1000),
            "long.html",
            true,
          ),
        );
        await page.frameLocator("iframe").locator("h1").waitFor();
        assert.ok(await page.locator("iframe").evaluate((node) => node.clientHeight > 220));
        for (let change = 0; change < 3; change += 1) {
          await page.locator(".preview-tabs button").nth(1).click();
          assert.ok(
            await page
              .locator(".preview-page")
              .evaluate((node) => node.scrollHeight > node.clientHeight),
          );
          for (const selector of [
            "#app",
            ".file-mutation-preview",
            ".el-tabs__content",
            ".preview-body",
          ]) {
            assert.ok(
              await page
                .locator(selector)
                .evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
              selector + " must not scroll",
            );
          }
          await page.locator(".preview-tabs button").nth(0).click();
          await page.frameLocator("iframe").locator("h1").waitFor();
          assert.ok(
            await page
              .frameLocator("iframe")
              .locator("html")
              .evaluate((node) => node.scrollHeight > node.clientHeight),
          );
        }
        await page
          .getByRole("tab", { name: "message.mutationPreviewMetadata", exact: true })
          .click();
        await page.getByRole("tab", { name: "message.mutationPreviewFile", exact: true }).click();
        await page.frameLocator("iframe").locator("h1").waitFor();
        await page.evaluate(() => window.previewApp.unmount());
      }
      await page.evaluate(() =>
        window.mountMutation(
          '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="red"/></svg>',
          "icon.svg",
          true,
        ),
      );
      await page.locator(".preview-image").evaluate((image) => image.decode());
      assert.equal(
        await page.locator(".preview-image").evaluate((image) => image.naturalWidth),
        12,
      );
      await page.evaluate(() => {
        window.previewApp.unmount();
        window.copyWrites = {};
        document.execCommand = () => {
          const event = new Event("copy", { cancelable: true });
          event.clipboardData = {
            setData: (type, value) => {
              window.copyWrites[type] = value;
            },
          };
          document.dispatchEvent(event);
          return true;
        };
        window.mountMutation("# Copied snapshot", "copy.md", true);
      });
      await page.locator(".preview-markdown h1").waitFor();
      await page.locator(".noobot-copy-button").nth(0).click();
      assert.equal(await page.evaluate(() => window.copyWrites["text/plain"]), "# Copied snapshot");
      assert.match(await page.evaluate(() => window.copyWrites["text/html"]), /<h1/);
      await page.locator(".noobot-copy-button").nth(1).click();
      assert.equal(await page.evaluate(() => window.copyWrites["text/plain"]), "# Copied snapshot");
      await page.evaluate(() => window.previewApp.unmount());
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);
