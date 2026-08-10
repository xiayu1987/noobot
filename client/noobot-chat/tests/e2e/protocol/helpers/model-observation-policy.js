/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";

export const MODEL_CALL_EXPECTATION = Object.freeze({
  REQUIRED: "required",
  FORBIDDEN: "forbidden",
});

const requiredCases = [
  2,
  6, 7, 8, 13, 14, 15, 16, 17,
  21, 22, 23, 24, 25,
  27, 28, 29,
  31,
  32,
  34, 35, 36, 37, 38,
];

export const MODEL_OBSERVATION_POLICY = Object.freeze(Object.fromEntries([
  ...requiredCases.map((number) => [
    `PBE-${String(number).padStart(3, "0")}`,
    MODEL_CALL_EXPECTATION.REQUIRED,
  ]),
  ["PBE-026", MODEL_CALL_EXPECTATION.FORBIDDEN],
  ["PBE-030", MODEL_CALL_EXPECTATION.FORBIDDEN],
]));

function pbeIds(text) {
  return [...String(text).matchAll(/\bPBE-\d{3}\b/g)].map((match) => match[0]);
}

export function modelObservationPolicyForTitle(title) {
  const ids = [...new Set(pbeIds(title))];
  if (ids.length !== 1) {
    throw new Error(`protocol E2E title must contain exactly one PBE id: ${title}`);
  }
  const [caseId] = ids;
  const expectation = MODEL_OBSERVATION_POLICY[caseId];
  if (!expectation) throw new Error(`missing model observation policy for ${caseId}`);
  return Object.freeze({ caseId, expectation });
}

export function validateModelObservationPolicyCoverage(specsDirectory) {
  const discovered = new Map();
  const filesWithoutUnifiedFixture = [];
  for (const name of fs.readdirSync(specsDirectory).filter((entry) => entry.endsWith(".spec.js"))) {
    const source = fs.readFileSync(path.join(specsDirectory, name), "utf8");
    if (!/from\s+["']\.\.\/fixtures\/noobot\.fixture\.js["']/.test(source)) {
      filesWithoutUnifiedFixture.push(name);
    }
    for (const caseId of pbeIds(source)) {
      const files = discovered.get(caseId) || [];
      files.push(name);
      discovered.set(caseId, files);
    }
  }

  const duplicateCases = [...discovered.entries()]
    .filter(([, files]) => files.length !== 1)
    .map(([caseId, files]) => `${caseId} (${files.join(", ")})`);
  const missingPolicies = [...discovered.keys()].filter((caseId) => !MODEL_OBSERVATION_POLICY[caseId]);
  const stalePolicies = Object.keys(MODEL_OBSERVATION_POLICY).filter((caseId) => !discovered.has(caseId));
  if (filesWithoutUnifiedFixture.length || duplicateCases.length || missingPolicies.length || stalePolicies.length) {
    throw new Error([
      "model observation policy coverage is not closed",
      `specs outside unified fixture: ${filesWithoutUnifiedFixture.join(", ") || "none"}`,
      `duplicate PBE ids: ${duplicateCases.join("; ") || "none"}`,
      `missing policies: ${missingPolicies.join(", ") || "none"}`,
      `stale policies: ${stalePolicies.join(", ") || "none"}`,
    ].join("\n"));
  }
}
