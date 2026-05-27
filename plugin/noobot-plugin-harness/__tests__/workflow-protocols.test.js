/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAcceptancePatchProtocolText,
  buildPlanningRefinementPatchProtocolText,
  buildPlanningRevisionPatchProtocolText,
  buildSummaryPatchProtocolText,
} from "../src/capabilities/handlers/shared/workflow-protocols.js";

test("workflow protocols are split and reusable by flow", () => {
  assert.match(String(buildPlanningRevisionPatchProtocolText("zh-CN")), /ADD \[新整数ID\]/);
  assert.match(String(buildPlanningRefinementPatchProtocolText("zh-CN")), /禁止输出 1\.1\.1/);
  assert.match(String(buildSummaryPatchProtocolText("zh-CN")), /summary_patch_v1/);
  assert.match(
    String(buildAcceptancePatchProtocolText({ locale: "zh-CN", mode: "final" })),
    /验收 ID\+PATCH 协议：acceptance_patch_v1 \/ 总体验收/,
  );
  assert.match(
    String(buildAcceptancePatchProtocolText({ locale: "zh-CN", mode: "phase" })),
    /验收 ID\+PATCH 协议：acceptance_patch_v1 \/ 阶段验收/,
  );
});

