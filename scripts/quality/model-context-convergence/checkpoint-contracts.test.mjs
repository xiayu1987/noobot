/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_CONTRACTS } from "./agent-contracts.mjs";
import { addContractHits } from "../boundary-hits.mjs";
import { readRepositoryText } from "../repository-files.mjs";
import { emptyRuleMeasurements } from "../check-protocol.mjs";
import { CHECK } from "../../check-model-context-convergence.mjs";

const ROOT = "agent/src/session/";
const CASES = [
  {
    file: `${ROOT}services/session-message-service/turn-summary-checkpoint.js`,
    marker: "commit: commitChanges,",
  },
  {
    file: `${ROOT}session-artifact-session/commit-session-changes.js`,
    marker: "prepareImmutableSummaryCheckpoint({",
  },
  {
    file: `${ROOT}session-artifact-session/immutable-summary-changes.js`,
    marker: "applyTurnSummaryCheckpoint(session, request, committedAt)",
  },
];

function measure(contract, source) {
  const measured = emptyRuleMeasurements(CHECK);
  addContractHits({ measured, file: contract.file, source, contract });
  return measured;
}

for (const { file, marker } of CASES) {
  test(`checkpoint contract rejects a broken delegation in ${file}`, async () => {
    const contract = AGENT_CONTRACTS.find((entry) => entry.file === file);
    assert.ok(contract);
    const source = await readRepositoryText(file);
    assert.equal(measure(contract, source).missingMarker.total, 0);
    assert.ok(source.includes(marker));
    const broken = source.replaceAll(marker, "bypassedCheckpointDelegation");
    assert.ok(measure(contract, broken).missingMarker.total > 0);
  });
}
