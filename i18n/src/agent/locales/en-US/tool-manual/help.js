/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const HELP_MANUAL = {
  help: {
    summary: "Look up usage documentation. Returns detailed guidance for the requested help type.",
    usage: ["help({ helpType, toolName })", "help({ helpType })"],
    params: {
      helpType:
        "Help type. tool returns the full manual for a given tool; experience returns the memory catalog for follow-up lookups.",
      toolName: "Tool name, required when helpType is tool. Use the registered tool name.",
    },
    notes: [
      "Tool schemas keep only the minimal purpose statement; full parameter semantics, usage combinations, notes, and pitfalls live here.",
      "When a tool's parameters or capability boundary are unclear, read the manual before calling. It is faster than trial and error.",
      "With helpType tool and no toolName, the response lists the tool names available for lookup.",
      "With helpType experience, the response gives memory catalog paths; read the content with read_file or search.",
      "Help types are extensible, so guidance beyond tools can be added later.",
    ],
    pitfalls: [
      "Use the registered tool name, not a description or an alias.",
      "This tool only reads documentation. It performs no domain action and does not count as having called the tool it describes.",
    ],
  },
};
