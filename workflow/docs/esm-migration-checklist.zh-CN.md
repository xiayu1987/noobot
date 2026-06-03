# workflow ESM 改造清单（单轨版）

> 当前状态（2026-06-04）：`workflow` 已切到**源码单轨 ESM**，不再维护 `src/esm/*` 双轨包装层。

---

## 1. 已完成项（Done）

- [x] `workflow/package.json` 切换为：
  - `"type": "module"`
  - `exports["."] = "./src/index.js"`
  - `exports["./extension"] = "./src/extension/index.js"`
- [x] 入口统一 ESM：`src/index.js`
- [x] 扩展入口统一 ESM：`src/extension/index.js`
- [x] 核心 facade 统一 ESM：
  - `src/lib/compiler.js`
  - `src/lib/runtime.js`
- [x] 测试改为 ESM import：
  - `__tests__/workflow.test.js`
  - `__tests__/helpers/model-builders.js`
- [x] 删除重复实现目录：`src/esm/`
- [x] 清理遗留 CommonJS（`require/module.exports`）

---

## 2. 对外使用方式（最新）

### 2.1 使用 workflow

```js
import workflow from 'workflow';
// 或
import {
  compileWorkflowSemantic,
  startWorkflowInstanceById,
  advanceWorkflowInstanceById,
} from 'workflow';
```

### 2.2 使用 extension API

```js
import workflowExtension from 'workflow/extension';
// 或
import { registerModelBoxFactory } from 'workflow/extension';
```

---

## 3. 兼容性说明

- `workflow` 包本身不再保证 `require('workflow')`。
- 如旧调用方仍是 CommonJS，请在调用方侧做桥接（例如动态 `import()`），不要在 `workflow` 内回退双轨。

---

## 4. 验证命令

```bash
npm run -w workflow test
npm run -w plugin/noobot-plugin-workflow check
node -e "import('workflow').then(m=>console.log(Object.keys(m)))"
node -e "import('workflow/extension').then(m=>console.log(Object.keys(m)))"
```

---

## 5. 后续建议

1. 若 monorepo 内仍有对 `workflow` 的 CJS 调用，逐步迁移到 ESM import。  
2. `workflow` 新增代码统一按 ESM 规范提交（含显式 `.js` 后缀）。  
3. 保持“插件扩展、内核最小改动”边界：扩展逻辑优先放 `noobot-plugin-workflow`。
