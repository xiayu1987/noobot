/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFileSync } from "node:fs";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appShellSource = readFileSync(
  path.resolve(__dirname, "../../../src/app/shell/AppShell.vue"),
  "utf8",
);

describe("AppShell unmount", () => {
  it("disposes both websocket clients directly when the shell unmounts", () => {
    const start = appShellSource.indexOf("function onAppUnmounted()");
    const end = appShellSource.indexOf("onMounted(onAppMounted)");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const unmountBody = appShellSource.slice(start, end);

    expect(unmountBody).toContain("chatWebSocketClient.dispose();");
    expect(unmountBody).toContain("sessionLogWebSocketClient.dispose();");
    expect(unmountBody).not.toContain("?.dispose");
    expect(appShellSource).toContain("onBeforeUnmount(onAppUnmounted)");
  });
});
