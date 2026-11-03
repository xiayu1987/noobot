/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { activateRuntimeParams, createDefaultRuntimeParamsDocument } from "../runtime-params.js";

export const TEST_RUNTIME_OVERRIDES_ENV = "NOOBOT_TEST_RUNTIME_OVERRIDES";

function testRuntimeOverrides() {
  const encoded = process.env[TEST_RUNTIME_OVERRIDES_ENV];
  return encoded === undefined ? {} : JSON.parse(encoded);
}

activateRuntimeParams({
  ...createDefaultRuntimeParamsDocument(),
  overrides: testRuntimeOverrides(),
});
