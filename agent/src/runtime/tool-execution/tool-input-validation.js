/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import { recoverableToolError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { tTool } from "../../tools/core/tool-i18n.js";

const TOOL_INPUT_ROOT_FIELD = "input";

function issueField(issue) {
  return issue.path?.length ? issue.path.join(".") : TOOL_INPUT_ROOT_FIELD;
}

function isMissingValue(issue) {
  return issue.code !== "unrecognized_keys" && issue.input === undefined;
}

function localizeIssue(runtime, issue) {
  const field = issueField(issue);
  if (isMissingValue(issue)) return tTool(runtime, "tools.input.fieldRequired", { field });
  if (issue.code === "unrecognized_keys") {
    return tTool(runtime, "tools.input.unknownFields", { keys: issue.keys.join(", ") });
  }
  if (issue.code === "invalid_value") {
    return tTool(runtime, "tools.input.invalidOption", {
      field,
      values: issue.values.map((value) => JSON.stringify(value)).join(", "),
    });
  }
  if (issue.code === "invalid_type") {
    return tTool(runtime, "tools.input.invalidType", { field, expected: issue.expected });
  }
  return tTool(runtime, "tools.input.invalidValue", { field, code: issue.code });
}

function issueDetail(issue) {
  return {
    code: issue.code,
    field: issueField(issue),
    ...(issue.code === "unrecognized_keys" ? { keys: [...issue.keys] } : {}),
  };
}

export function assertToolInputMatchesSchema(tool, args, runtime) {
  if (!isFunction(tool?.schema?.safeParse)) return;
  const parsed = tool.schema.safeParse(args, { reportInput: true });
  if (parsed.success) return;
  const { issues } = parsed.error;
  throw recoverableToolError(issues.map((issue) => localizeIssue(runtime, issue)).join("\n"), {
    code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
    details: { issues: issues.map(issueDetail) },
  });
}
