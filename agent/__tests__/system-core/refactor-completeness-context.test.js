/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const mockWorkspaceService = {
  getWorkspacePath: async (sessionId) => `/workspace/${sessionId}`
};

const { ContextBuilder } = await import('../../src/system-core/bot-manage/session/context-builder.js');

// ========== 1. Context 透传测试 ==========
describe('1. Context 透传测试', () => {
  describe('ContextBuilder.build()', () => {
    it('应正确透传 sessionId', async () => {
      const builder = new ContextBuilder(mockWorkspaceService);
      const sessionId = 'test-session-123';
      const context = await builder.build(sessionId, { name: 'programming' }, { allow: ['execute_script'] });
      assert.equal(context.sessionId, sessionId, 'sessionId 应正确透传');
    });

    it('应正确透传 scenario 配置', async () => {
      const builder = new ContextBuilder(mockWorkspaceService);
      const scenario = { name: 'programming', model: 'openai:gpt-4' };
      const context = await builder.build('sess-1', scenario, {});
      assert.deepEqual(context.scenario, scenario, 'scenario 应完整透传');
    });

    it('应正确透传 toolPolicy', async () => {
      const builder = new ContextBuilder(mockWorkspaceService);
      const toolPolicy = { allow: ['execute_script', 'call_service'], deny: [] };
      const context = await builder.build('sess-1', {}, toolPolicy);
      assert.deepEqual(context.toolPolicy, toolPolicy, 'toolPolicy 应完整透传');
    });

    it('workspacePath 应通过 workspaceService 动态获取', async () => {
      const builder = new ContextBuilder(mockWorkspaceService);
      const context = await builder.build('my-session', {}, {});
      assert.equal(context.workspacePath, '/workspace/my-session', 'workspacePath 应由 workspaceService 生成');
    });

    it('Context 应包含 timestamp 字段', async () => {
      const builder = new ContextBuilder(mockWorkspaceService);
      const context = await builder.build('sess-1', {}, {});
      assert.ok('timestamp' in context, 'Context 应包含 timestamp');
      assert.equal(typeof context.timestamp, 'string', 'timestamp 应为字符串');
    });
  });
});
