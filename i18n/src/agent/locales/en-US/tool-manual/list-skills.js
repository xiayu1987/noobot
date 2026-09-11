/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const LIST_SKILLS_MANUAL = {
  list_skills: {
    summary: "Inspect the skill directory structure, listing available skills by level.",
    usage: ["list_skills({ parentSkill })"],
    params: {
      parentSkill:
        "Parent skill name, optional. Omit for the top-level list; pass one to get its child level.",
    },
    notes: [
      "The skill directory lives under skills in the user workspace, isolated per user and user-writable.",
      "Skill content is plain files. Once the level is known, read a specific skill document with read_file.",
    ],
    pitfalls: [
      "Skills and tool manuals are different things. Look up tool usage with help, not in the skill directory.",
    ],
  },
};
