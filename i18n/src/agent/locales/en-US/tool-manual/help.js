/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const HELP_MANUAL = {
  help: {
    summary:
      "Look up your own runtime documentation, command-line style. Each command returns tool manuals, memory catalogs, runtime, context, attachments, or isolation facts.",
    usage: [
      "help()",
      "help({ command: '--tools' })",
      "help({ command: '--tools --name read_file' })",
      "help({ command: '--models' })",
      "help({ command: '--experience' })",
      "help({ command: '--memory' })",
      "help({ command: '--runtime' })",
      "help({ command: '--context' })",
      "help({ command: '--attachs' })",
      "help({ command: '--attachs --id <attachmentId>' })",
      "help({ command: '--attachs --source model' })",
      "help({ command: '--isolation' })",
    ],
    params: {
      command:
        "Command-line string. The first token must be --command, the rest are --option value pairs. Omit or pass empty to list available commands.",
    },
    notes: [
      "There are eight commands: --tools, --models, --experience, --memory, --runtime, --context, --attachs, --isolation.",
      "--tools without options lists queryable tool names; --name returns the full manual for one tool. Tool schemas keep only the minimal purpose statement, while full parameter semantics, usage combinations, notes, and pitfalls live behind --tools --name.",
      "--models returns the model in use plus the models available to this session, including each model's multimodal generation and parsing capabilities. Check it before handing images, documents, audio or video to a model.",
      "--experience returns experience memory paths and --memory returns long and short memory plus daily, weekly, monthly and yearly summary paths; read both with read_file or search.",
      "--runtime returns the current path view, relative path base, working directories, allowed roots, and sandbox shape. Check it before assuming a path is reachable by file tools.",
      "--context returns the current turn identity (userId, sessionId, dialogProcessId, turnScopeId and more), the caller and a timestamp. It carries no configuration and no secrets.",
      "--attachs without options returns the current session attachments grouped by source; --id returns one attachment detail and --source filters by user, model, email or subtask.",
      "--isolation returns the isolation mode list and the execution class of every tool. Check it to tell whether a tool runs on the host or in a sandbox.",
      "Every directory and attachment path is projected through the path-resolver and execution-isolation-protocol contracts before being returned. The view is decided by the runtime, never by the caller.",
      "When a tool's parameters or capability boundary are unclear, read the manual before calling. It is faster than trial and error.",
    ],
    pitfalls: [
      "Commands need the -- prefix and only one command is allowed per call; multiple commands are rejected.",
      "Use the registered tool name for --name, not a description or an alias.",
      "Options are bound to commands. Passing an unsupported option is rejected; see usage for valid combinations.",
      "--attachs depends on session identity and the attachment service; when either is missing it fails instead of returning an empty list.",
      "Returned attachment paths are projected references. Pass them to later tools as-is and never concatenate or rewrite them.",
      "This tool only reads documentation. It performs no domain action and does not count as having called the tool it describes.",
    ],
  },
};
