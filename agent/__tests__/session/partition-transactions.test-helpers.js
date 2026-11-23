/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function request(
  journal,
  sequence,
  mutations = [{ collection: "messages", key: "m", owner: null, value: "x" }],
) {
  return {
    epoch: journal.head.epoch,
    sequence,
    expectedGeneration: sequence - 1,
    operationId: `test-operation-${sequence - 1}`,
    input: { fixtureGeneration: sequence - 1 },
    mutations,
    result: { accepted: true },
  };
}

function createAt(journal, sequence) {
  return request(journal, sequence, [
    { collection: "messages", key: `m${sequence}`, owner: null, value: sequence },
  ]);
}

export { request, createAt };
