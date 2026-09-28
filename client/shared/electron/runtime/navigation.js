/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const externalProtocols = new Set(["https:", "http:", "mailto:", "tel:"]);

function documentAddress(url) {
  const address = new URL(url);
  address.hash = "";
  address.search = "";
  return address.href;
}

export function installDesktopNavigation({
  webContents,
  getDocumentUrl,
  openExternal,
  appendDesktopLog = () => {},
}) {
  async function openExternalLink(url) {
    try {
      const target = new URL(url);
      if (!externalProtocols.has(target.protocol)) return;
      await openExternal(target.href);
    } catch (error) {
      appendDesktopLog(`[main:navigation] open external failed: ${error.message}`);
    }
  }

  function handleNavigation(event) {
    if (!event.isMainFrame) return;
    try {
      if (documentAddress(event.url) === documentAddress(getDocumentUrl())) return;
    } catch (error) {
      appendDesktopLog(`[main:navigation] invalid navigation: ${error.message}`);
    }
    event.preventDefault();
    void openExternalLink(event.url);
  }

  webContents.on("will-navigate", handleNavigation);
  webContents.on("will-redirect", handleNavigation);
  webContents.setWindowOpenHandler(({ url }) => {
    void openExternalLink(url);
    return { action: "deny" };
  });
}
