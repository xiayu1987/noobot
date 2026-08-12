/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { sendAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-040 agent config protocol is exposed through the canonical connect response", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  const payload = noobot.connectConfig;

  expect(payload).toMatchObject({ ok: true, userId: noobot.userId });
  expect(payload.scenarios?.default).toBeTruthy();
  expect(payload.scenarios?.definitions?.programming?.tools).toEqual(
    expect.arrayContaining(["read_file", "write_file", "search", "patch_file"]),
  );
  expect(Array.isArray(payload.enabledModels)).toBe(true);
  expect(
    payload.defaultModelAlias || payload.defaultModel?.alias || payload.defaultModel?.value,
  ).toBeTruthy();

  await sendAndStop({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "connect response config audit"),
  });
});
