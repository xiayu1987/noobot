/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeToolCallArgs(rawArgs = null) {
  if (isPlainObject(rawArgs)) return rawArgs;
  const rawText = String(rawArgs || "").trim();
  if (!rawText) return {};
  try {
    const parsed = JSON.parse(rawText);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function resolveRawToolCalls(ai = {}) {
  const directCandidates = [
    ai?.tool_calls,
    ai?.toolCalls,
    ai?.additional_kwargs?.tool_calls,
    ai?.additional_kwargs?.toolCalls,
    ai?.lc_kwargs?.tool_calls,
    ai?.response_metadata?.tool_calls,
    ai?.response_metadata?.toolCalls,
  ];
  for (const candidate of directCandidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }

  const functionCall =
    ai?.additional_kwargs?.function_call && isPlainObject(ai.additional_kwargs.function_call)
      ? ai.additional_kwargs.function_call
      : null;
  if (functionCall?.name) {
    return [
      {
        id: String(functionCall?.id || "").trim(),
        type: "function",
        function: {
          name: String(functionCall?.name || "").trim(),
          arguments: String(functionCall?.arguments || ""),
        },
      },
    ];
  }
  return [];
}

export function normalizeToolCalls(ai = {}) {
  const rawCalls = resolveRawToolCalls(ai);
  const calls = rawCalls
    .map((call = {}) => {
      const fn = isPlainObject(call?.function) ? call.function : {};
      const name = String(
        call?.name ??
          call?.tool_name ??
          call?.toolName ??
          fn?.name ??
          "",
      ).trim();
      if (!name) return null;
      return {
        ...call,
        id: String(
          call?.id ??
            call?.tool_call_id ??
            call?.toolCallId ??
            call?.call_id ??
            "",
        ).trim(),
        name,
        args: normalizeToolCallArgs(
          call?.args ??
            call?.arguments ??
            fn?.arguments ??
            {},
        ),
      };
    })
    .filter(Boolean);
  return { rawCalls, calls };
}

