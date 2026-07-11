/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { applyDesktopPathEnvironment, CLIENT_PATH_PLATFORMS } from "../../shared/path-resolver.js";

applyDesktopPathEnvironment({ entryUrl: import.meta.url, platform: CLIENT_PATH_PLATFORMS.MACOS, iconName: "noobot.svg" });

await import("../../shared/electron/main.js");
