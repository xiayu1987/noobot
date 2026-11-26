/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { _electron } from "@playwright/test";

export async function withNativeDesktop(profile, use) {
  const desktop = await _electron.launch({
    executablePath: process.env.NOOBOT_E2E_DESKTOP_EXECUTABLE,
    args: [`--user-data-dir=${profile}`],
    timeout: 60000,
  });
  try {
    const page = await desktop.firstWindow();
    await page.getByRole("button", { name: /^(跳过|Skip)$/ }).click();
    await page.waitForURL(`${process.env.NOOBOT_E2E_BASE_URL}/**`, { timeout: 60000 });
    return await use(desktop);
  } finally {
    await desktop.close();
  }
}
