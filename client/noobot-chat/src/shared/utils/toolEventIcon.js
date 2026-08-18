/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  ChatDotRound,
  CircleCheck,
  CircleClose,
  Clock,
  Collection,
  Connection,
  DataAnalysis,
  Document,
  EditPen,
  Finished,
  Headset,
  Link,
  MagicStick,
  Message,
  Monitor,
  Picture,
  Promotion,
  Refresh,
  Search,
  Share,
  Switch,
  Tickets,
  Tools,
} from "@element-plus/icons-vue";

const TOOL_CALL_ICONS = Object.freeze({
  read_file: Document,
  write_file: EditPen,
  patch_file: EditPen,
  search: Search,
  execute_script: Monitor,
  execute_native_script: Tools,
  list_skills: Collection,
  call_service: Connection,
  call_mcp_task: Share,
  delegate_task_async: Promotion,
  wait_async_task_result: Clock,
  plan_multi_task_collaboration: Tickets,
  switch_model: Switch,
  user_interaction: ChatDotRound,
  process_connector_tool: Link,
  access_connector: Link,
  inspect_connectors: Connection,
  web_search: Search,
  multimodal_generate: MagicStick,
  multimodal_parse: Picture,
  task_summary: Document,
  task_check: Finished,
  request_help: Headset,
  final_answer: Message,
  database_connect_connector: DataAnalysis,
  terminal_connect_connector: Monitor,
  email_connect_connector: Message,
});

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function resolveToolEventVisual({ event = "", toolName = "", tone = "" } = {}) {
  const eventName = normalize(event);
  if (eventName === "tool_result") {
    return normalize(tone) === "error"
      ? { icon: CircleClose, key: "result-error" }
      : { icon: CircleCheck, key: "result-success" };
  }
  if (eventName === "tool_call") {
    const normalizedToolName = normalize(toolName);
    return {
      icon: TOOL_CALL_ICONS[normalizedToolName] || Tools,
      key: normalizedToolName || "tool",
    };
  }
  return { icon: Refresh, key: "event" };
}
