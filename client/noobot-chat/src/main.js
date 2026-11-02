/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { activateRuntimeParams, RUNTIME_PARAMS_SNAPSHOT_API } from "@noobot/shared/runtime-params";

const response = await fetch(`/api${RUNTIME_PARAMS_SNAPSHOT_API}`, { cache: "no-store" });
if (!response.ok) throw new Error(`runtime parameters initialization failed: ${response.status}`);
activateRuntimeParams(await response.json());
await import("./app-runtime.js");
