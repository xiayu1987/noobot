/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const TOOL_EVENT_TYPES = new Set(["tool_call", "tool_result"]);

function createLlmDeltaVisibilityFilter() {
  const openTags = ["<think>", "<thinking>"];
  const closeTags = ["</think>", "</thinking>"];
  const maxTagLength = Math.max(
    ...openTags.map((tagText) => tagText.length),
    ...closeTags.map((tagText) => tagText.length),
  );
  const state = {
    inThinkBlock: false,
    carryText: "",
  };

  const findEarliestTag = (sourceText = "") => {
    let earliest = null;
    for (const tagText of [...openTags, ...closeTags]) {
      const tagIndex = sourceText.indexOf(tagText);
      if (tagIndex < 0) continue;
      if (!earliest || tagIndex < earliest.index) {
        earliest = { tagText, index: tagIndex };
      }
    }
    return earliest;
  };

  return {
    push(chunkText = "") {
      const inputChunk = String(chunkText || "");
      if (!inputChunk) return "";
      const mergedText = `${state.carryText}${inputChunk}`;
      const tailSize = Math.max(0, maxTagLength - 1);
      const processableLength = Math.max(0, mergedText.length - tailSize);
      let remainingText = mergedText.slice(0, processableLength);
      state.carryText = mergedText.slice(processableLength);
      let visibleText = "";

      while (remainingText) {
        const matchedTag = findEarliestTag(remainingText);
        if (!matchedTag) {
          if (!state.inThinkBlock) visibleText += remainingText;
          break;
        }

        const beforeTagText = remainingText.slice(0, matchedTag.index);
        if (!state.inThinkBlock) visibleText += beforeTagText;
        if (openTags.includes(matchedTag.tagText)) {
          state.inThinkBlock = true;
        } else if (closeTags.includes(matchedTag.tagText)) {
          state.inThinkBlock = false;
        }
        remainingText = remainingText.slice(
          matchedTag.index + matchedTag.tagText.length,
        );
      }

      return visibleText;
    },
  };
}

export function emitEvent(eventListener, event, data = {}) {
  try {
    eventListener?.onEvent?.({ event, data, ts: new Date().toISOString() });
  } catch {
    // ignore listener errors
  }
}

export function classifyExecutionEvent(event = "") {
  if (event === "tool_call_start")
    return { category: "tool", type: "tool_call" };
  if (event === "tool_call_end")
    return { category: "tool", type: "tool_result" };
  return { category: "system", type: "system" };
}

export function createExecutionEventListener({
  sessionManager = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
  upstream = null,
}) {
  const dialogProcessId = upstream?.dialogProcessId || "";
  const llmDeltaVisibilityFilter = createLlmDeltaVisibilityFilter();
  const enrichEventData = (rawData = {}) => {
    const eventData = rawData && typeof rawData === "object" ? rawData : {};
    const resolvedDialogProcessId = String(
      eventData?.dialogProcessId || dialogProcessId || "",
    );
    const resolvedSessionId = String(eventData?.sessionId || sessionId || "");
    const resolvedParentSessionId = String(
      eventData?.parentSessionId || parentSessionId || "",
    );
    return {
      ...eventData,
      dialogProcessId: resolvedDialogProcessId,
      sessionId: resolvedSessionId,
      parentSessionId: resolvedParentSessionId,
    };
  };
  return {
    onEvent: (evt = {}) => {
      const event = evt?.event || "";
      const data = evt?.data || {};
      const ts = evt?.ts || new Date().toISOString();
      if (event === "llm_delta") {
        const normalizedData = data?.subAgentCall
          ? { ...data }
          : {
              ...data,
              text: llmDeltaVisibilityFilter.push(String(data?.text || "")),
            };
        if (!normalizedData?.subAgentCall && !String(normalizedData?.text || "")) {
          return;
        }
        try {
          upstream?.onEvent?.({
            event,
            data: enrichEventData(normalizedData),
            ts,
          });
        } catch {
          // ignore upstream listener errors
        }
        return;
      }

      const { category, type } = classifyExecutionEvent(event);
      try {
        const maybePromise = sessionManager?.appendExecutionLog?.({
          userId,
          sessionId,
          parentSessionId,
          dialogProcessId,
          event,
          category,
          type,
          data,
          ts,
        });
        if (maybePromise?.catch) maybePromise.catch(() => {});
      } catch {
        // ignore log write errors
      }

      try {
        upstream?.onEvent?.({
          event,
          data: enrichEventData(data),
          ts,
        });
      } catch {
        // ignore upstream listener errors
      }
    },
  };
}

export function normalizeSseLogEvent(evt = {}) {
  const rawEvent = String(evt?.event || "");
  const data = evt?.data || {};
  const ts = evt?.ts || new Date().toISOString();

  if (rawEvent === "tool_call_start") {
    return {
      event: "thinking",
      data: {
        category: "tool",
        type: "tool_call",
        event: "tool_call",
        rawEvent,
        dialogProcessId: data.dialogProcessId || "",
        ts,
        turn: data.turn || 0,
        tool: data.tool || "",
        args: data.args || {},
        text: `${data.tool || ""} ${JSON.stringify(data.args || {})}`,
      },
    };
  }

  if (rawEvent === "tool_call_end") {
    return {
      event: "thinking",
      data: {
        category: "tool",
        type: "tool_result",
        event: "tool_result",
        rawEvent,
        dialogProcessId: data.dialogProcessId || "",
        ts,
        turn: data.turn || 0,
        tool: data.tool || "",
        result: data.result || "",
        text: `${data.tool || ""} ${String(data.result || "")}`,
      },
    };
  }

  return {
    event: "thinking",
    data: {
      category: TOOL_EVENT_TYPES.has(String(data.type || ""))
        ? "tool"
        : "system",
      type: String(data.type || "system"),
      event: String(data.event || "system"),
      rawEvent: rawEvent || "system",
      ts,
      ...data,
      text: `${rawEvent || "system"} ${JSON.stringify(data)}`,
    },
  };
}
