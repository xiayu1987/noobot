/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Build execution context for session.
 */
export class ContextBuilder {
  /**
   * @param {Object} workspaceService - Workspace service instance
   */
  constructor(workspaceService) {
    this.workspaceService = workspaceService;
  }

  /**
   * Build context for session execution.
   * @param {string} sessionId - Session identifier
   * @param {Object} scenario - Resolved scenario configuration
   * @param {Object} toolPolicy - Tool policy object
   * @returns {Object} Execution context
   */
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
