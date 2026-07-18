/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMessageEntity,
  normalizeTaskEntity,
  normalizeSessionTreeEntity,
  normalizeSelectedConnectors
} from '../../src/system-core/session/entities.js';

// ========== 2. 字段对齐测试 ==========
describe('2. 字段对齐测试', () => {
  describe('normalizeMessageEntity 字段对齐', () => {
    it('应包含 role, content, type, ts 等核心字段', () => {
      const raw = { role: 'user', content: 'hello', type: 'text' };
      const normalized = normalizeMessageEntity(raw);
      assert.ok('role' in normalized, '应包含 role');
      assert.ok('content' in normalized, '应包含 content');
      assert.ok('type' in normalized, '应包含 type');
      assert.ok('ts' in normalized, '应包含 ts');
    });

    it('ts 应为字符串类型（ISO 时间或传入值转字符串）', () => {
      const raw = { role: 'user', content: 'test', ts: 1234567890 };
      const normalized = normalizeMessageEntity(raw);
      assert.equal(typeof normalized.ts, 'string', 'ts 应为字符串');
      assert.equal(normalized.ts, '1234567890', '数值 ts 应转为字符串');
    });

    it('缺失 ts 时应自动生成 ISO 时间字符串', () => {
      const raw = { role: 'assistant', content: 'hi' };
      const normalized = normalizeMessageEntity(raw);
      assert.ok(typeof normalized.ts === 'string' && normalized.ts.length > 0, '应自动生成 ts');
    });

    it('tool_calls 字段在 type=tool_call 时应保证为数组', () => {
      const raw = { role: 'assistant', type: 'tool_call', content: '' };
      const normalized = normalizeMessageEntity(raw);
      assert.ok(Array.isArray(normalized.tool_calls), 'tool_call 类型应保证 tool_calls 为数组');
    });

    it('summarized 字段默认应为 false', () => {
      const raw = { role: 'user', content: 'test' };
      const normalized = normalizeMessageEntity(raw);
      assert.equal(normalized.summarized, false, 'summarized 默认应为 false');
    });

    it('rawModelContent 不落盘（由 execution 日志保留完整信息）', () => {
      const raw1 = { role: 'user', content: 'test', rawModelContent: 'raw text' };
      const n1 = normalizeMessageEntity(raw1);
      assert.ok(!('rawModelContent' in n1), 'string rawModelContent 默认不落盘');

      const rawSig = {
        role: 'assistant',
        content: 'test',
        rawModelContent: [{ type: 'text', text: 'x', thought_signature: 'sig-1' }],
      };
      const nSig = normalizeMessageEntity(rawSig);
      assert.ok(!('rawModelContent' in nSig), 'thought_signature array 也不落盘');

      const raw2 = { role: 'user', content: 'test', rawModelContent: 123 };
      const n2 = normalizeMessageEntity(raw2);
      assert.ok(!('rawModelContent' in n2), '非 string/array rawModelContent 不应保留');
    });

    it('modelAdditionalKwargs 不落盘', () => {
      const raw1 = {
        role: 'user',
        content: 'test',
        modelAdditionalKwargs: { key: 'val', tool_calls: [{ id: 'c1' }] },
      };
      const n1 = normalizeMessageEntity(raw1);
      assert.ok(!('modelAdditionalKwargs' in n1), 'modelAdditionalKwargs 不落盘');

      const raw2 = { role: 'user', content: 'test', modelAdditionalKwargs: [1, 2] };
      const n2 = normalizeMessageEntity(raw2);
      assert.ok(!('modelAdditionalKwargs' in n2), 'array modelAdditionalKwargs 不应保留');
    });
  });

  describe('normalizeTaskEntity 字段对齐', () => {
    it('应包含 taskId, taskName, taskStatus, startedAt, endedAt, result, meta 字段', () => {
      const raw = { taskId: 'task-1', taskName: 'test task', taskStatus: 'completed' };
      const normalized = normalizeTaskEntity(raw);
      const requiredFields = ['taskId', 'taskName', 'taskStatus', 'startedAt', 'endedAt', 'result', 'meta'];
      for (const field of requiredFields) {
        assert.ok(field in normalized, `应包含 ${field}`);
      }
    });

    it('taskStatus 仅 start/completed 有效，其他为空字符串', () => {
      const n1 = normalizeTaskEntity({ taskId: 't1', taskStatus: 'start' });
      assert.equal(n1.taskStatus, 'start');

      const n2 = normalizeTaskEntity({ taskId: 't2', taskStatus: 'completed' });
      assert.equal(n2.taskStatus, 'completed');

      const n3 = normalizeTaskEntity({ taskId: 't3', taskStatus: 'running' });
      assert.equal(n3.taskStatus, '', 'running 应转为空字符串');
    });

    it('meta 字段缺失时默认为空对象', () => {
      const normalized = normalizeTaskEntity({ taskId: 't1' });
      assert.deepEqual(normalized.meta, {}, 'meta 默认应为空对象');
    });
  });

  describe('normalizeSessionTreeEntity 字段对齐', () => {
    it('应包含 roots, nodes, updatedAt 字段', () => {
      const raw = {
        roots: ['session-1'],
        nodes: { 'session-1': { sessionId: 'session-1', parentSessionId: '', children: [] } }
      };
      const normalized = normalizeSessionTreeEntity(raw);
      assert.ok('roots' in normalized, '应包含 roots');
      assert.ok('nodes' in normalized, '应包含 nodes');
      assert.ok('updatedAt' in normalized, '应包含 updatedAt');
    });

    it('roots 和 nodes 应为数组/对象类型', () => {
      const normalized = normalizeSessionTreeEntity({});
      assert.ok(Array.isArray(normalized.roots), 'roots 应为数组');
      assert.ok(typeof normalized.nodes === 'object', 'nodes 应为对象');
    });

    it('nodes 中每个节点应规范化 sessionId 和 parentSessionId', () => {
      const raw = {
        nodes: {
          's1': { parentSessionId: '', children: ['s2'] },
          's2': { parentSessionId: 's1', children: [] }
        }
      };
      const normalized = normalizeSessionTreeEntity(raw);
      assert.equal(normalized.nodes['s1'].sessionId, 's1');
      assert.equal(normalized.nodes['s1'].parentSessionId, '');
      assert.ok(Array.isArray(normalized.nodes['s1'].children));
    });
  });

  describe('normalizeSelectedConnectors 字段对齐', () => {
    it('应保留传入的 connector 键值对', () => {
      const raw = { database: 'pg-1', terminal: 'bash' };
      const normalized = normalizeSelectedConnectors(raw);
      assert.equal(normalized.database, 'pg-1');
      assert.equal(normalized.terminal, 'bash');
    });

    it('空对象应返回空对象', () => {
      const normalized = normalizeSelectedConnectors({});
      assert.deepEqual(normalized, {});
    });

    it('非对象输入应返回空对象', () => {
      assert.deepEqual(normalizeSelectedConnectors(null), {});
      assert.deepEqual(normalizeSelectedConnectors(undefined), {});
      assert.deepEqual(normalizeSelectedConnectors('invalid'), {});
    });
  });
});

// ========== 3. Session 字段完整性测试 ==========
describe('3. Session 字段完整性测试', () => {
  describe('Session 运行时实体结构验证', () => {
    it('Session 应包含 sessionId, userId, scenario, status, createdAt, updatedAt', () => {
      const session = {
        sessionId: 'sess-1',
        userId: 'primary-user',
        scenario: 'programming',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        parentSessionId: '',
        children: [],
        messages: [],
        tasks: [],
        config: {},
        metadata: {}
      };

      const requiredFields = [
        'sessionId', 'userId', 'scenario', 'status',
        'createdAt', 'updatedAt', 'parentSessionId',
        'children', 'messages', 'tasks', 'config', 'metadata'
      ];

      for (const field of requiredFields) {
        assert.ok(field in session, `Session 应包含字段: ${field}`);
      }
    });

    it('Task 实体应包含 taskId, taskName, taskStatus, startedAt, endedAt, result, meta', () => {
      const task = normalizeTaskEntity({
        taskId: 'task-1',
        taskName: 'execute script',
        taskStatus: 'completed',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        result: 'success',
        meta: { exitCode: 0 }
      });

      const requiredFields = ['taskId', 'taskName', 'taskStatus', 'startedAt', 'endedAt', 'result', 'meta'];
      for (const field of requiredFields) {
        assert.ok(field in task, `Task 应包含字段: ${field}`);
      }
    });

    it('Message 实体应包含 role, content, type, ts, summarized', () => {
      const message = normalizeMessageEntity({
        role: 'user',
        content: 'hello',
        type: 'text',
        ts: Date.now()
      });

      const requiredFields = ['role', 'content', 'type', 'ts', 'summarized'];
      for (const field of requiredFields) {
        assert.ok(field in message, `Message 应包含字段: ${field}`);
      }
    });
  });
});

// ========== 4. 落盘字段完整性测试 ==========
describe('4. 落盘字段完整性测试', () => {
  describe('session.json 落盘结构', () => {
    it('落盘 session.json 应包含完整字段', () => {
      const diskSession = {
        sessionId: 'sess-1',
        userId: 'primary-user',
        scenario: 'programming',
        status: 'completed',
        parentSessionId: '',
        children: [],
        config: {
          model: 'openai:gpt-4',
          maxContextTurns: 50,
          selectedConnectors: { database: '', terminal: '', email: '' }
        },
        metadata: {
          totalTurns: 10,
          totalTokens: 5000,
          startTime: Date.now(),
          endTime: Date.now()
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const requiredFields = [
        'sessionId', 'userId', 'scenario', 'status',
        'parentSessionId', 'children', 'config', 'metadata',
        'createdAt', 'updatedAt'
      ];

      for (const field of requiredFields) {
        assert.ok(field in diskSession, `session.json 应包含字段: ${field}`);
      }
    });
  });

  describe('task.json 落盘结构', () => {
    it('落盘 task.json 应包含完整字段', () => {
      const diskTask = {
        taskId: 'task-1',
        taskName: 'execute script',
        taskStatus: 'completed',
        skillName: 'default',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        result: 'success',
        meta: { exitCode: 0, duration: 150 }
      };

      const requiredFields = [
        'taskId', 'taskName', 'taskStatus', 'skillName',
        'startedAt', 'endedAt', 'result', 'meta'
      ];

      for (const field of requiredFields) {
        assert.ok(field in diskTask, `task.json 应包含字段: ${field}`);
      }
    });
  });

  describe('execution.json 落盘结构', () => {
    it('落盘 execution.json 应包含完整字段', () => {
      const diskExecution = {
        sessionId: 'sess-1',
        turnId: 'turn-1',
        status: 'completed',
        model: 'openai:gpt-4',
        inputMessages: [{ role: 'user', content: 'hello' }],
        outputMessage: { role: 'assistant', content: 'hi' },
        toolCalls: [],
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 2000
      };

      const requiredFields = [
        'sessionId', 'turnId', 'status', 'model',
        'inputMessages', 'outputMessage', 'toolCalls',
        'tokenUsage', 'startTime', 'endTime', 'duration'
      ];

      for (const field of requiredFields) {
        assert.ok(field in diskExecution, `execution.json 应包含字段: ${field}`);
      }
    });
  });
});
