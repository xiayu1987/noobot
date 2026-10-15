/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { buildMessageModelRunFacet } from "../../../../../src/modules/chat/model/messageModelFacets.js";
import { buildModelRunLabel } from "../../../../../src/modules/chat/model/conversationFoldingIdentity.js";

describe("message model name", () => {
  it("reads modelName as the only model name field", () => {
    expect(buildMessageModelRunFacet({ modelName: "m-1", model: "alias" }).modelName).toBe("m-1");
    expect(buildMessageModelRunFacet({ model: "alias" }).modelName).toBe("");
  });

  it("builds the run label from modelAlias and modelName only", () => {
    expect(buildModelRunLabel({ modelAlias: "fast", modelName: "m-1" })).toBe("fast (m-1)");
    expect(buildModelRunLabel({ model: "alias" })).toBe("");
  });
});
