/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  modelObservationPolicyForTitle,
  validateModelObservationPolicyCoverage,
} from "../../e2e/protocol/helpers/model-observation-policy.js";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";

describe("protocol case audit contracts", () => {
  it.each([
    ["PBE-002", "required", "required"],
    ["PBE-026", "forbidden", "forbidden"],
    ["PBE-030", "forbidden", "forbidden"],
    ["PBE-054", "optional", "required"],
  ])(
    "%s declares model and summary requirements independently",
    (caseId, expectation, summaryExpectation) => {
      expect(modelObservationPolicyForTitle(`@core ${caseId} test`)).toEqual({
        caseId,
        expectation,
        summaryExpectation,
      });
    },
  );
  it("covers every real spec without stale or duplicate cases", () => {
    expect(() =>
      validateModelObservationPolicyCoverage(
        path.resolve(process.cwd(), "tests/e2e/protocol/specs"),
      ),
    ).not.toThrow();
  });
});
