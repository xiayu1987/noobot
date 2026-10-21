/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { collectNoobotPluginScopedSessionRootDeclarations } from "@noobot/plugin-runtime";
import { resolveScopedSessionRoots } from "@noobot/workspace-protocol";

export const TEST_SCOPED_SESSION_ROOTS = resolveScopedSessionRoots(
  await collectNoobotPluginScopedSessionRootDeclarations(),
);
