/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { applyDesktopPathEnvironment, CLIENT_PATH_PLATFORMS } from "@noobot/client-shared/path-resolver";

applyDesktopPathEnvironment({ entryUrl: import.meta.url, platform: CLIENT_PATH_PLATFORMS.WINDOWS, iconName: "noobot.ico" });

await import("@noobot/client-shared/electron-main");
