# Frontend 插件化重构执行文档（Step by Step）

> 目标：将前端插件能力从 `client/noobot-chat/src/plugins/*` 逐步演进到 `plugin/*/frontend/*`，并保持可回滚、可观测、不中断发布。

---

## 0. 现状基线（已完成）

- [x] `ChatMessageItem` 已通过 frontend registry 动态渲染（message cards/actions）。
- [x] 内置能力（status/thinking/workflow/assets/copy actions）已注册化。
- [x] 前端构建可通过（`npm run build`）。

---

## 1. 目标结构

```txt
plugin/
  noobot-plugin-workflow/
    frontend/
      index.js
      components/
  noobot-plugin-harness/
    frontend/
      index.js

client/noobot-chat/src/plugins/
  core/
    frontend-plugin-registry.js
    auto-register.js          # 新增：自动加载外部前端插件
```

---

## 2. 执行阶段

### Phase A：定义协议（先定标准）

- [x] A1. 定义插件前端入口协议：
  - `export function registerFrontendPlugin(ctx) {}`
  - `ctx.registerFrontendPlugin(...)`
- [x] A2. 增加 `apiVersion` 约定（建议 `"1"`）。
- [x] A3. 输出一份最小示例模板到 `docs/`。
- [x] A4. 产出协议文档：`docs/frontend-plugin-contract.md`（含示例与校验建议）。

**验收标准**
- 协议文档可被插件开发者直接复制使用。

---

### Phase B：引入自动聚合加载器

- [x] B1. 新增 `src/plugins/auto-register.js`。
- [x] B2. 维护“外部插件前端入口映射”（改为 generated 自动产物）。
- [x] B3. `main.js` 启动时执行：
  1) `registerExternalFrontendPlugins()`
- [x] B4. 单插件加载失败需隔离（不影响主应用启动）。
- [x] B5. registry 增加重复注册防护（同 id / 同 capability + slot 冲突告警）。

**验收标准**
- 关闭某个插件前端入口后，应用仍可启动。
- 控制台能看到加载成功/失败信息。

---

### Phase B-Compile：前端编译链路接入（新增）

- [x] BC1. 在插件 manifest 增加前端入口字段（建议）：
  - `frontend.apiVersion`
  - `frontend.entry`
- [x] BC2. 新增生成脚本：`scripts/generate-frontend-plugin-entries.mjs`
  - 扫描 `plugin/*/manifest.json`
  - 读取 `frontend.entry`
  - 生成 `src/plugins/generated/external-entries.js`
- [x] BC3. 在 `client/noobot-chat/package.json` 增加：
  - `prebuild`: 先执行 entries 生成脚本
  - `pretest`: 与 `build` 共用生成脚本（避免测试环境缺入口映射）
- [x] BC4. `main.js` 先注册 builtins，再注册 generated external entries。
- [x] BC5. 调整 `vite.config.js`（如需要）允许读取 workspace 上级 `plugin/*` 路径。
- [x] BC6. 插件前端入口缺失/无效时，仅告警且跳过，不阻断编译。

**验收标准**
- `npm run build` 在存在/不存在插件前端入口时都可完成。
- 产物中仅包含已声明且可加载的插件前端能力。

---

### Phase C：迁移 workflow 前端能力（首个试点）

- [x] C1. 创建 `plugin/noobot-plugin-workflow/frontend/index.js`。
- [x] C2. 将 workflow message card 注册逻辑迁移到该入口。
- [x] C3. client 侧保留 builtins fallback（短期双轨）。
- [x] C4. 验证无重复渲染（同能力仅注册一次）。

**验收标准**
- workflow UI 行为与迁移前一致。
- `npm run build` 与关键页面联调通过。

---

### Phase D：迁移 harness/其它能力

- [x] D1. 迁移 harness 前端相关能力（若有）。
- [x] D2. 迁移 message action / assets 等通用能力（按插件归属拆分）。
- [x] D3. 清理 client 侧 builtins 中已迁移条目（保留 fallback-only 兜底路径）。

**验收标准**
- 内置 fallback 逻辑已移除，全部由 `plugin/*/frontend` 入口提供。

---

### Phase E：收口与去兼容

- [x] E1. 增加 deprecation 提示（旧路径/旧别名）。
- [x] E2. 约定一个移除窗口（如 2~3 个版本）。
- [x] E3. 移除过时 fallback 配置与 dead code。

> 原约定：fallback 兼容层预计在 **v1.3.0**（不晚于 **2026-09-30**）后移除；当前已提前完成移除。

**验收标准**
- 文档与代码一致，无隐式兼容分支。

---

## 3. 风险与应对

1. **跨目录导入受限（Vite）**
   - 方案：在 `vite.config.js` 中配置 `server.fs.allow`。
2. **插件前端依赖冲突**
   - 方案：插件前端尽量只用 host 依赖，避免重复打包框架依赖。
3. **重复注册导致重复渲染**
   - 方案：registry 按 `id` 去重，重复注册时警告并忽略后者。
4. **插件加载失败影响主流程**
   - 方案：try/catch 隔离 + 控制台诊断 + fallback 保底。

---

## 4. 每阶段执行命令（建议）

```bash
cd client/noobot-chat
npm run build
npm test
```

如执行了 Phase B-Compile，还需验证生成链路：

```bash
cd client/noobot-chat
node scripts/generate-frontend-plugin-entries.mjs
npm run build
```

如涉及 service/agent 协同改动，再执行：

```bash
cd ../../service && npm test -- --runInBand
cd ../agent && npm test -- --runInBand
```

---

## 5. 回滚策略

- 任一阶段异常时：
  1) 关闭 `auto-register` 调用；
  2) 回退 plugin frontend 迁移提交（恢复到 fallback 历史版本）；
  3) 重新执行 build/test 验证。

---

## 6. 本文维护规则

- 每完成一个任务，勾选 checklist 并写一句变更摘要（含 commit id）。
- 仅保留“可执行、可验证”的步骤，不写泛化目标。

## 7. 变更摘要（执行记录）

- 2026-06-05：完成 Phase A（协议文档与示例），新增 `docs/frontend-plugin-contract.md`。
- 2026-06-05：完成 Phase B + Phase B-Compile（auto-register、entries 生成脚本、prebuild/pretest、vite fs allow、失败隔离与重复注册告警）。
- 2026-06-05：完成 Phase C（workflow 前端入口迁移到 `plugin/noobot-plugin-workflow/frontend/index.js`，并保留 builtins fallback）。
- 2026-06-05：完成 Phase D（harness 前端入口承接 status/thinking/actions/assets 注册，builtins 调整为 fallback-only）。
- 2026-06-05：完成 Phase E 的 E1/E2（新增 fallback deprecation 警告与移除窗口 v1.3.0 / 2026-09-30）。
- 2026-06-05：完善 fallback-only 兜底策略（message-status/thinking/actions/assets/workflow 全部按“外部优先，内置兜底”执行）。
- 2026-06-05：完成 Phase E 的 E3（移除 builtins fallback 与 deprecation 兼容代码，前端插件能力全部由 `plugin/*/frontend` 提供）。
