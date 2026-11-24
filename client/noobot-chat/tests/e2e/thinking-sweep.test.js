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
  import { createApp, h, reactive, ref } from 'vue';
  import ElementPlus from 'element-plus';
  import 'element-plus/dist/index.css';
  import '/src/shared/styles/style.css';
  import { activateRuntimeParams, createDefaultRuntimeParamsDocument } from '@noobot/shared/runtime-params';
  import MessageStatusRow from '/src/modules/chat/components/message/MessageStatusRow.vue';
  import ThinkingPanelRealtime from '/src/modules/chat/components/thinking/ThinkingPanelRealtime.vue';
  import SessionListPanel from '/src/modules/session/components/SessionListPanel.vue';
  import { SESSION_RUN_EVENT } from '/src/modules/chat/runtime/run-state-machine/constants.js';
  import {
    applyTurnRuntimeEvent, createTurnRuntimeRegistryState, removeSessionRuntime,
  } from '/src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js';

  activateRuntimeParams(createDefaultRuntimeParamsDocument());
  const noop = () => '';
  const state = ref('sending');
  const mobileViewport = window.matchMedia('(max-width: 639px)');
  const isMobile = ref(mobileViewport.matches);
  mobileViewport.addEventListener('change', ({ matches }) => { isMobile.value = matches; });
  const registry = reactive(createTurnRuntimeRegistryState());
  const runningSessionId = 'running-session';
  const idleSessionId = 'idle-session';
  const sessions = [
    { sessionId: runningSessionId, title: 'Running session' },
    { sessionId: idleSessionId, title: 'Idle session' },
  ];
  applyTurnRuntimeEvent(registry, {
    type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
    timestamp: Date.now(),
    sessionId: runningSessionId,
    turnScopeId: 'client-turn:sidebar-sweep',
  });
  window.finish = () => {
    state.value = 'completed';
    removeSessionRuntime(registry, runningSessionId);
  };
  createApp({ setup: () => () => [
    h(SessionListPanel, {
      sessions, activeSessionId: idleSessionId, turnRuntimeRegistry: registry,
      sending: false, collapsed: false, isMobile: isMobile.value,
    }),
    h(MessageStatusRow, { statusStepState: state.value }),
    h(ThinkingPanelRealtime, {
      messageItem: {}, isRunning: state.value !== 'completed', openNames: ['thinking-panel'],
      translate: (key) => key, fetchExecutionReport: noop, getDetailKey: noop,
      isExpanded: () => false, toggleExpanded: noop, thinkingDetailLabel: 'Thinking details',
      thinkingDurationLabel: '00:15', thinkingModelLoopRound: 2,
      latestModelAnalysisLog: { text: 'Thinking through the details.' },
    }),
  ] }).use(ElementPlus).mount('#app');
</script>`;

function readSweep(element, timeMs) {
  const animation = element
    .getAnimations()
    .find((item) => item.animationName === "noobot-thinking-text-sweep");
  if (!animation) return null;
  animation.pause();
  const { duration, iterations } = animation.effect.getTiming();
  animation.currentTime = timeMs;
  return { duration, iterations };
}

function readTextSweep(element) {
  const style = getComputedStyle(element);
  return {
    clip: style.backgroundClip,
    image: style.backgroundImage,
    width: style.backgroundSize,
    position: parseFloat(style.backgroundPositionX),
  };
}

test(
  "running session titles, elapsed time and status labels share the sweep and pause",
  { timeout: 60000 },
  async (t) => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const server = await createTestViteServer(t, {
      root,
      appType: "custom",
      server: { host: "127.0.0.1", port: 0 },
    });
    server.middlewares.use("/__thinking-sweep", async (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml("/__thinking-sweep", fixture));
    });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch();
      const page = await browser.newPage({ reducedMotion: "no-preference" });
      await page.goto(new URL("__thinking-sweep", server.resolvedUrls.local[0]).href);
      const status = page.locator(".message-status-steps");
      const labels = status.locator(".message-status-steps__title");
      const panel = page.locator(".thinking-realtime-shell");
      const elapsed = panel.locator(".thinking-elapsed .noobot-thinking-sweep-text");
      const analysis = panel.locator(".base-note-block__content");
      const runningTitle = page.locator('[data-session-id="running-session"] .title');
      const idleTitle = page.locator('[data-session-id="idle-session"] .title');
      const sweepSources = [status, panel, runningTitle];
      await analysis.waitFor({ timeout: 5000 });
      await runningTitle.waitFor({ timeout: 5000 });
      assert.equal(await labels.count(), 4);

      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        for (const theme of ["light", "dark"]) {
          await page.evaluate((value) => {
            document.documentElement.dataset.theme = value;
          }, theme);
          for (const source of sweepSources) {
            assert.deepEqual(await source.evaluate(readSweep, 237.5), {
              duration: 2950,
              iterations: Infinity,
            });
          }
          const sweptLabels = [elapsed, runningTitle, ...(await labels.all())];
          for (const label of sweptLabels) {
            const first = await label.evaluate(readTextSweep);
            assert.equal(first.clip, "text, text");
            assert.match(first.image, /linear-gradient\(104deg,.*49%.*58%/);
            assert.match(first.width, /40%.*192px|192px.*40%/);
            assert.equal(first.position, -10);
          }

          for (const source of sweepSources) await source.evaluate(readSweep, 712.5);
          for (const label of sweptLabels) {
            assert.equal((await label.evaluate(readTextSweep)).position, 110);
          }
          for (const timeMs of [950, 2949]) {
            for (const source of sweepSources) await source.evaluate(readSweep, timeMs);
            for (const label of sweptLabels) {
              assert.equal((await label.evaluate(readTextSweep)).position, 170);
            }
          }
          for (const source of sweepSources) await source.evaluate(readSweep, 2950);
          for (const label of sweptLabels) {
            assert.equal((await label.evaluate(readTextSweep)).position, -70);
          }
          for (const element of [
            analysis,
            idleTitle,
            panel.locator(".thinking-loop-round"),
            panel.locator(".thinking-detail-action-button"),
            status.locator(".message-status-steps__dot").first(),
          ]) {
            assert.equal((await element.evaluate(readTextSweep)).clip, "border-box");
          }

          await page.emulateMedia({ reducedMotion: "reduce" });
          assert.equal(await status.evaluate(readSweep, 475), null);
          assert.equal(await panel.evaluate(readSweep, 475), null);
          assert.equal(await runningTitle.evaluate(readSweep, 475), null);
          assert.equal((await elapsed.evaluate(readTextSweep)).clip, "border-box");
          await page.emulateMedia({ reducedMotion: "no-preference" });
        }
      }

      await page.evaluate(() => window.finish());
      assert.equal(await status.evaluate(readSweep, 475), null);
      assert.equal(await panel.evaluate(readSweep, 475), null);
      assert.equal(await runningTitle.evaluate(readSweep, 475), null);
      assert.equal(await labels.first().evaluate(readSweep, 475), null);
      assert.deepEqual(await labels.last().evaluate(readSweep, 475), {
        duration: 950,
        iterations: 1,
      });
      assert.equal((await labels.last().evaluate(readTextSweep)).position, 50);
    } finally {
      await browser?.close();
    }
  },
);
