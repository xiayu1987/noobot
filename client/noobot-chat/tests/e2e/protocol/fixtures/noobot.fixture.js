/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { artifactTest } from "./artifacts.fixture.js";
import { connectThroughUi, readE2eCredentials } from "./auth.fixture.js";
import { createSessionThroughUi } from "./session.fixture.js";
import { assertModelInvocationTraceSet } from "../helpers/model-message-assertions.js";
import {
  MODEL_CALL_EXPECTATION,
  modelObservationPolicyForTitle,
} from "../helpers/model-observation-policy.js";
import {
  modelInvocationTraces,
  readSessionExecutionEventTree,
} from "../helpers/persistence-audit.js";

async function writeJsonLines(filePath, records) {
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
}

async function auditModelObservation({ userId, sessionId, policy, testInfo }) {
  const outputDir = testInfo.outputPath("protocol-evidence");
  await fs.mkdir(outputDir, { recursive: true });

  let traces = [];
  const deadline = Date.now() + (policy.expectation === MODEL_CALL_EXPECTATION.REQUIRED ? 15_000 : 0);
  do {
    traces = modelInvocationTraces(await readSessionExecutionEventTree(userId, sessionId));
    if (traces.length > 0 || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (true);

  let validationError = null;
  try {
    if (traces.length > 0) assertModelInvocationTraceSet(traces, { rootSessionId: sessionId });
    if (policy.expectation === MODEL_CALL_EXPECTATION.REQUIRED) {
      expect(traces.length, `${policy.caseId} requires an observed provider model invocation`).toBeGreaterThan(0);
    } else if (policy.expectation === MODEL_CALL_EXPECTATION.FORBIDDEN) {
      expect(traces, `${policy.caseId} forbids provider model invocations`).toEqual([]);
    }
  } catch (error) {
    validationError = error;
  }

  const audit = Object.freeze({
    protocolVersion: 1,
    authority: "model_invoke_port",
    caseId: policy.caseId,
    expectation: policy.expectation,
    status: validationError ? "failed" : "passed",
    failure: validationError ? String(validationError.message || validationError) : null,
    rootSessionId: sessionId,
    invocationCount: traces.length,
    invocationIdsUnique: new Set(traces.map((record) => record.data.invocationId)).size === traces.length,
    modelInstanceCount: new Set(traces.map((record) => record.data.modelInstanceId)).size,
    sessionIds: [...new Set(traces.map((record) => record.sessionId))],
    purposes: [...new Set(traces.map((record) => record.data?.invocation?.purpose).filter(Boolean))],
    domains: [...new Set(traces.map((record) => record.data?.invocation?.domain).filter(Boolean))],
  });
  const tracesPath = path.join(outputDir, "model-invocations.jsonl");
  const auditPath = path.join(outputDir, "model-observation-audit.json");
  await writeJsonLines(tracesPath, traces);
  await fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  await testInfo.attach("model-invocations.jsonl", {
    path: tracesPath,
    contentType: "application/x-ndjson",
  });
  await testInfo.attach("model-observation-audit.json", {
    path: auditPath,
    contentType: "application/json",
  });
  if (validationError) throw validationError;
}

export const test = artifactTest.extend({
  noobot: async ({ page }, use, testInfo) => {
    const credentials = readE2eCredentials();
    const policy = modelObservationPolicyForTitle(testInfo.title);
    await page.goto("/");
    await connectThroughUi(page, credentials);
    const sessionId = await createSessionThroughUi(page);
    try {
      await use(Object.freeze({ page, sessionId, userId: credentials.userId }));
    } finally {
      await auditModelObservation({
        userId: credentials.userId,
        sessionId,
        policy,
        testInfo,
      });
    }
  },
});

export { expect };
