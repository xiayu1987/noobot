/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { clientFilePath as path } from "../../path-resolver.js";
import { createDesktopWindowManager } from "../../electron/runtime/window.js";

const appUrl = "http://127.0.0.1:23456/";

function createHarness(t, platform) {
  const originalIcon = process.env.NOOBOT_DESKTOP_TRAY_ICON;
  process.env.NOOBOT_DESKTOP_TRAY_ICON = "test-icon.png";
  t.after(() => {
    if (originalIcon === undefined) delete process.env.NOOBOT_DESKTOP_TRAY_ICON;
    else process.env.NOOBOT_DESKTOP_TRAY_ICON = originalIcon;
  });
  const externalUrls = [];
  const logs = [];
  const menus = [];
  let contextMenu;
  let reloads = 0;
  const webContents = new EventEmitter();
  webContents.isDestroyed = () => false;
  webContents.reload = () => reloads++;
  webContents.setWindowOpenHandler = (handler) => {
    webContents.openWindow = handler;
  };
  const shell = { openExternal: async (url) => externalUrls.push(url) };
  const Menu = {
    setApplicationMenu: (menu) => menus.push(menu),
    buildFromTemplate: (template) => ({
      template,
      popup: () => {
        contextMenu = template;
      },
    }),
  };
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = webContents;
      this.loadedUrls = [];
    }
    isDestroyed() {
      return false;
    }
    async loadFile(file) {
      this.startupFile = file;
    }
    async loadURL(url) {
      this.loadedUrls.push(url);
    }
  }
  class Tray extends EventEmitter {
    setToolTip() {}
    setContextMenu() {}
  }
  const manager = createDesktopWindowManager({
    app: { isPackaged: false },
    dirname: path.resolve("test-desktop-runtime"),
    agentProxyOrigin: appUrl,
    defaultClientUrl: appUrl,
    platform,
    electron: { BrowserWindow, Tray, Menu, shell },
    appendDesktopLog: (line) => logs.push(line),
  });
  const window = manager.createWindow();
  function navigate(url, { eventName = "will-navigate", isMainFrame = true } = {}) {
    const event = {
      url,
      isMainFrame,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    webContents.emit(eventName, event);
    return event.prevented;
  }
  function input(properties) {
    const event = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    webContents.emit("before-input-event", event, { type: "keyDown", key: "r", ...properties });
    return event.prevented;
  }
  return {
    manager,
    window,
    webContents,
    shell,
    externalUrls,
    logs,
    menus,
    navigate,
    input,
    getReloads: () => reloads,
    contextMenu: (params = {}) => {
      webContents.emit("context-menu", {}, params);
      return contextMenu;
    },
  };
}

for (const platform of ["win32", "darwin"]) {
  test(`${platform}: startup and application documents stay inside the window`, async (t) => {
    const h = createHarness(t, platform);
    const startupUrl = pathToFileURL(h.window.startupFile).href;
    assert.equal(h.navigate(`${startupUrl}#setup`), false);
    assert.equal(h.navigate("file:///other-page.html"), true);
    assert.equal(h.navigate(appUrl), true, "renderer cannot select the app entry");
    assert.equal(h.contextMenu()[0].enabled, false);
    await h.manager.loadNoobotUrl(appUrl);
    assert.deepEqual(h.window.loadedUrls, [appUrl]);
    assert.equal(h.navigate(appUrl), false);
    assert.equal(h.navigate(`${appUrl}?session=123#message`), false);
    assert.equal(h.navigate(startupUrl), true);
    assert.equal(h.navigate(appUrl, { eventName: "will-redirect" }), false);
  });

  test(`${platform}: links and redirects cannot replace Noobot, including same-origin pages`, async (t) => {
    const h = createHarness(t, platform);
    await h.manager.loadNoobotUrl(appUrl);
    const targets = [
      "https://example.com/article",
      `${appUrl}ide/`,
      "http://127.0.0.1:23457/",
      "mailto:help@example.com",
    ];
    for (const eventName of ["will-navigate", "will-redirect"]) {
      for (const url of targets) assert.equal(h.navigate(url, { eventName }), true);
    }
    assert.deepEqual(h.externalUrls, [...targets, ...targets]);
    assert.deepEqual(h.window.loadedUrls, [appUrl]);
    assert.equal(
      h.navigate("https://example.com/embedded", {
        eventName: "will-redirect",
        isMainFrame: false,
      }),
      false,
    );
    assert.equal(h.externalUrls.length, targets.length * 2);
  });

  test(`${platform}: new windows use the browser, unsupported URLs never launch host handlers`, async (t) => {
    const h = createHarness(t, platform);
    await h.manager.loadNoobotUrl(appUrl);
    const url = `${appUrl}ide/`;
    assert.deepEqual(h.webContents.openWindow({ url }), { action: "deny" });
    assert.deepEqual(h.externalUrls, [url]);
    for (const target of [
      "about:blank",
      "file:///secret.txt",
      "javascript:alert(1)",
      "data:text/html,hello",
      "custom-app://run",
      "invalid URL",
    ]) {
      assert.deepEqual(h.webContents.openWindow({ url: target }), { action: "deny" });
      assert.equal(h.navigate(target), true);
    }
    assert.deepEqual(h.externalUrls, [url]);
    h.shell.openExternal = async () => {
      throw new Error("browser unavailable");
    };
    assert.equal(h.navigate("https://example.com/fail"), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(h.logs.some((line) => line.includes("browser unavailable")));
    assert.deepEqual(h.window.loadedUrls, [appUrl]);
  });

  test(`${platform}: right-click offers return, reload and native editing`, async (t) => {
    const h = createHarness(t, platform);
    await h.manager.loadNoobotUrl(`${appUrl}?workspace=owner`);
    const menu = h.contextMenu({ isEditable: true });
    assert.deepEqual(
      menu.filter((item) => item.role).map((item) => item.role),
      ["undo", "redo", "cut", "copy", "paste", "selectAll"],
    );
    await menu.find((item) => item.enabled === true).click();
    assert.deepEqual(h.window.loadedUrls, [
      `${appUrl}?workspace=owner`,
      `${appUrl}?workspace=owner`,
    ]);
    menu.find((item) => item.accelerator === "CmdOrCtrl+R").click();
    assert.equal(h.getReloads(), 1);
  });

  test(`${platform}: menu policy preserves platform editing and refresh shortcuts`, (t) => {
    const h = createHarness(t, platform);
    if (platform === "win32") assert.deepEqual(h.menus, [null]);
    else
      assert.deepEqual(
        h.menus[0].template.map((item) => item.role),
        ["appMenu", "editMenu", "windowMenu"],
      );
    const modifier = platform === "win32" ? { control: true } : { meta: true };
    assert.equal(h.input(modifier), true);
    assert.equal(h.input({ key: "F5" }), true);
    assert.equal(h.input({ key: "r" }), false);
    assert.equal(h.input({ ...modifier, type: "keyUp" }), false);
    assert.equal(h.input({ ...modifier, alt: true }), false);
    assert.equal(h.input({ ...modifier, key: "c" }), false);
    assert.equal(h.getReloads(), 2);
  });
}
