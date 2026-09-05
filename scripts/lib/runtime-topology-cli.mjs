#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Shell-facing adapter over @noobot/runtime-topology-protocol.
 *
 * The protocol package stays pure; this thin CLI is the only place that reads
 * process.env and writes to stdout, so start/restart/stop/close scripts can
 * `eval "$(node scripts/lib/runtime-topology-cli.mjs --shell)"`.
 */
import {
  listeningPorts,
  resolveRuntimeTopology,
  shellExports,
} from "@noobot/runtime-topology-protocol/ports";

const mode = process.argv[2] ?? "--json";

if (mode === "--shell") {
  process.stdout.write(shellExports(process.env));
} else if (mode === "--ports") {
  process.stdout.write(`${listeningPorts(process.env).join("\n")}\n`);
} else if (mode === "--json") {
  process.stdout.write(`${JSON.stringify(resolveRuntimeTopology(process.env), null, 2)}\n`);
} else {
  process.stderr.write(`Unknown mode: ${mode}\n`);
  process.exit(2);
}
