/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test as base, _electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { withNativeDesktop } from "../helpers/native-desktop.js";

const executablePath = process.env.NOOBOT_E2E_DESKTOP_EXECUTABLE;

export const test = executablePath
  ? base.extend({
      desktopApp: [
        async ({}, use) => withNativeDesktop(process.env.NOOBOT_E2E_DESKTOP_USER_DATA_DIR, use),
        { scope: "worker" },
      ],
      context: async ({ desktopApp }, use, testInfo) => {
        const context = desktopApp.context();
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        try {
          await use(context);
        } finally {
          if (testInfo.status === testInfo.expectedStatus) {
            await context.tracing.stop();
          } else {
            const tracePath = testInfo.outputPath("native-desktop-trace.zip");
            await context.tracing.stop({ path: tracePath });
            await testInfo.attach("native-desktop-trace", {
              path: tracePath,
              contentType: "application/zip",
            });
          }
        }
      },
      openClient: async ({ desktopApp }, use) => {
        const clients = new Set();
        try {
          await use(async () => {
            const profile = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-peer-"));
            let peer;
            try {
              await fs.mkdir(path.join(profile, "config"));
              await fs.copyFile(
                path.join(
                  process.env.NOOBOT_E2E_DESKTOP_USER_DATA_DIR,
                  "config/global.config.json",
                ),
                path.join(profile, "config/global.config.json"),
              );
              peer = await _electron.launch({
                executablePath,
                args: [`--user-data-dir=${profile}`],
                timeout: 60000,
              });
              const page = await peer.firstWindow();
              await page.getByRole("button", { name: /^(跳过|Skip)$/ }).click();
              await page.waitForURL(`${process.env.NOOBOT_E2E_BASE_URL}/**`, { timeout: 60000 });
              expect(await page.evaluate(() => navigator.userAgent)).toContain("Electron/");
              expect(peer.process().pid).not.toBe(desktopApp.process().pid);
              const client = {
                page,
                context: peer.context(),
                async close() {
                  if (!clients.delete(client)) return;
                  await peer.close();
                  await fs.rm(profile, { recursive: true, force: true });
                },
              };
              clients.add(client);
              return client;
            } catch (error) {
              if (peer) await peer.close();
              await fs.rm(profile, { recursive: true, force: true });
              throw error;
            }
          });
        } finally {
          for (const client of clients) await client.close();
        }
      },
      reopenClientWindow: async ({ desktopApp }, use) => {
        await use(async (page) => {
          const window = await desktopApp.browserWindow(page);
          const id = await window.evaluate((window) => {
            const id = window.id;
            window.close();
            return id;
          });
          expect(await window.evaluate((window) => window.isDestroyed())).toBe(false);
          expect(await window.evaluate((window) => window.isVisible())).toBe(false);
          await desktopApp.evaluate(({ app }) => app.emit("activate"));
          expect(await window.evaluate((window) => window.id)).toBe(id);
          expect(await window.evaluate((window) => window.isVisible())).toBe(true);
          await window.dispose();
          return page;
        });
      },
      page: async ({ context, baseURL }, use) => {
        const origin = new URL(baseURL).origin;
        const pages = context.pages().filter((page) => new URL(page.url()).origin === origin);
        expect(pages, "native desktop must expose one chat window").toHaveLength(1);
        const [page] = pages;
        expect(await page.evaluate(() => navigator.userAgent)).toContain("Electron/");
        await page.evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });
        await use(page);
      },
    })
  : base.extend({
      openClient: async ({ browser, baseURL }, use) => {
        const clients = new Set();
        try {
          await use(async () => {
            const peer = await browser.browserType().launch({ chromiumSandbox: false });
            const context = await peer.newContext({ baseURL });
            const client = {
              context,
              page: await context.newPage(),
              async close() {
                if (clients.delete(client)) await peer.close();
              },
            };
            clients.add(client);
            return client;
          });
        } finally {
          for (const client of clients) await client.close();
        }
      },
      reopenClientWindow: async ({ context }, use) => {
        await use(async (page) => {
          await page.close();
          return context.newPage();
        });
      },
    });
