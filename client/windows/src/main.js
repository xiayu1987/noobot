/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
process.env.NOOBOT_DESKTOP_PROJECT_DIR ||= path.resolve(__dirname, "..", "..");
process.env.NOOBOT_DESKTOP_REPO_ROOT ||= path.resolve(__dirname, "..", "..", "..", "..");
process.env.NOOBOT_DESKTOP_WINDOW_ICON ||= path.join(__dirname, "..", "..", "assets", "noobot.ico");

await import("../../shared/electron/main.js");
