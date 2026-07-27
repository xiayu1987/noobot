/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export class ContextBuilder {
  constructor(workspaceService) {
    this.workspaceService = workspaceService;
  }

  async build(sessionId, scenario, toolPolicy) {
    const workspacePath = await this.workspaceService.getWorkspacePath(
      sessionId,
    );

    return {
      sessionId,
      workspacePath,
      scenario,
      toolPolicy,
      model: scenario?.model || "default",
      timestamp: new Date().toISOString(),
    };
  }
}
