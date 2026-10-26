/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { HOOK_RUNTIME_IDENTITY_FIELDS } from "@noobot/hook-protocol/runtime-identity";
import { AGENT_CONTEXT_IDENTITY_SHAPE } from "@noobot/context-protocol/agent-context/schema";

const ENVELOPE_IDENTITY_FIELDS = Object.freeze(Object.keys(AGENT_CONTEXT_IDENTITY_SHAPE));
const SHARED_IDENTITY_FIELDS = Object.freeze(
  ENVELOPE_IDENTITY_FIELDS.filter((field) => HOOK_RUNTIME_IDENTITY_FIELDS.includes(field)),
);
const ENVELOPE_ONLY_FIELDS = Object.freeze(
  ENVELOPE_IDENTITY_FIELDS.filter((field) => !SHARED_IDENTITY_FIELDS.includes(field)),
);
const RUN_CONFIG_IDENTITY_KEYS = Object.freeze(["executionId", "presentationMessageId"]);

function assertExactFields(value, fields, label) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const keys = Object.keys(value).sort().join(",");
  if (keys !== [...fields].sort().join(",")) {
    throw new TypeError(`${label} must have exactly: ${fields.join(", ")}`);
  }
}

export function createTestEnvelopeIdentity(runtimeIdentity, envelopeOnly) {
  assertExactFields(envelopeOnly, ENVELOPE_ONLY_FIELDS, "test envelope-only identity");
  return Object.freeze({
    ...Object.fromEntries(SHARED_IDENTITY_FIELDS.map((field) => [field, runtimeIdentity[field]])),
    ...envelopeOnly,
  });
}

export function deriveTestTurnIdentity(runtime, { runId, presentationMessageId }) {
  const { sessionId, parentSessionId } = runtime.systemRuntime;
  if (parentSessionId !== "") {
    throw new TypeError("child session test identity requires an explicit envelope identity");
  }
  return createTestEnvelopeIdentity(runtime.systemRuntime, {
    rootSessionId: sessionId,
    runId,
    presentationMessageId,
  });
}

export function bindTestIdentityToRuntime(runtime, identity) {
  if (!isPlainObject(runtime.systemRuntime) || !isPlainObject(runtime.runConfig)) {
    throw new TypeError("test runtime requires plain systemRuntime and runConfig objects");
  }
  assertExactFields(identity, ENVELOPE_IDENTITY_FIELDS, "test turn identity");
  const conflicts = SHARED_IDENTITY_FIELDS.filter(
    (field) => runtime.systemRuntime[field] !== identity[field],
  );
  if (conflicts.length > 0) {
    throw new TypeError(
      `test turn identity conflicts with runtime identity: ${conflicts.join(", ")}; pass it via createTestRuntimeContext({ identity })`,
    );
  }
  const preset = RUN_CONFIG_IDENTITY_KEYS.filter((key) => key in runtime.runConfig);
  if (preset.length > 0) {
    throw new TypeError(`run identity must not be preset on runConfig: ${preset.join(", ")}`);
  }
  runtime.runConfig = {
    ...runtime.runConfig,
    executionId: identity.runId,
    presentationMessageId: identity.presentationMessageId,
  };
  return identity;
}
