/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_CAPABILITY_KIND } from "../capabilities/capability-kinds.js";
import { MODEL_OPERATION_KIND } from "./operation.js";
import { text } from "@noobot/shared/value";

export function normalizeModelCapabilities(input = {}) {
  return Object.freeze({
    streaming: input.streaming !== false,
    tools: input.tools !== false,
    vision: input.vision === true,
    reasoning: input.reasoning === true,
    web_search: input.web_search === true,
    image_generation: input.image_generation === true,
  });
}

export function supportsModelCapability(modelSpec = {}, capability = "") {
  const normalizedCapability = text(capability);
  if (!Object.values(MODEL_CAPABILITY_KIND).includes(normalizedCapability)) {
    throw new TypeError(`unsupported model capability: ${normalizedCapability || "missing"}`);
  }
  return normalizeModelCapabilities(modelSpec?.capabilities)[normalizedCapability] === true;
}

export function requireModelOperationCapability(modelSpec = {}, operationKind = "") {
  const normalizedOperationKind = text(operationKind);
  if (
    normalizedOperationKind === MODEL_OPERATION_KIND.WEB_SEARCH &&
    !supportsModelCapability(modelSpec, MODEL_CAPABILITY_KIND.WEB_SEARCH)
  ) {
    throw new TypeError(
      `model does not declare ${MODEL_CAPABILITY_KIND.WEB_SEARCH} capability: ${String(
        modelSpec?.alias || modelSpec?.model || "missing",
      ).trim()}`,
    );
  }
  return modelSpec;
}
