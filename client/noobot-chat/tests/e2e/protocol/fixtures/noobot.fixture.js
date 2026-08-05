/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import { artifactTest } from "./artifacts.fixture.js";
import { connectThroughUi, readE2eCredentials } from "./auth.fixture.js";
import { createSessionThroughUi } from "./session.fixture.js";

export const test = artifactTest.extend({
  noobot: async ({ page }, use) => {
    const credentials = readE2eCredentials();
    await page.goto("/");
    await connectThroughUi(page, credentials);
    const sessionId = await createSessionThroughUi(page);
    await use(Object.freeze({ page, sessionId, userId: credentials.userId }));
  },
});

export { expect };
