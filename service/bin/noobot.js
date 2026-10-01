#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const invocationCwd = process.cwd();
const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(serviceRoot);
const { config: loadDotenv } = await import("dotenv");
loadDotenv({ quiet: true });
const { runCli } = await import("../cli/noobot.js");

const exitCode = await runCli({ argv: process.argv.slice(2), cwd: invocationCwd, serviceRoot });
process.exit(exitCode);
