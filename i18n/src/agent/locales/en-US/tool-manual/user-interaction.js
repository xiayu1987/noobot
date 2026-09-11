/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const USER_INTERACTION_MANUAL = {
  user_interaction: {
    summary: "Ask the user for information or an explicit confirmation.",
    usage: ["user_interaction({ content, fields, timeoutMs })"],
    params: {
      content:
        "Body of the request. Explain background, options, and impact so the user can decide directly.",
      fields:
        "Field definitions, an object or JSON string. Each field carries name, displayName, required, and description.",
      timeoutMs:
        "Wait limit, optional. Report a timeout as a failure; never fabricate a user reply.",
    },
    notes: [
      "Destructive or irreversible work needs explicit confirmation through this tool first, and high-risk actions cannot be silently downgraded.",
      "When a requirement has several reasonable readings and the choice shapes architecture, one clarification here is cheaper than rework.",
      "Field names are the keys of the returned object, so keep them aligned with the code that consumes them.",
    ],
    pitfalls: [
      "Minor choices such as naming, formatting, and default values should be decided and noted rather than interrupting the user.",
      "A timeout or a user cancellation must be reported as such, not treated as approval to continue.",
      "Availability follows the runtime allowUserInteraction setting; when it is off, do not assume confirmation is obtainable.",
    ],
  },
};
