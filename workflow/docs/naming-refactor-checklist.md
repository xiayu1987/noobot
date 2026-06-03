# WorkFlow1-js 命名重构清单（Java 风格 -> Node.js 风格）

## 目标
- 文件命名统一为 `kebab-case`
- 接口文件保留语义前缀，改为 `i-*`
- 枚举文件保留语义前缀，改为 `e-*`
- 修正 `*Controler*` 拼写为 `*Controller*`
- 所有 `require(...)` 路径同步修正
- 示例与测试可运行（`npm test` 通过）

## 规则
1. 普通文件：`BizinstFlowEngine.js -> bizinst-flow-engine.js`
2. 接口文件：`IModel.js -> i-model.js`
3. 枚举文件：`ENodeType.js -> e-node-type.js`
4. 特例拼写：`Controler -> Controller`
5. 目录结构保持不变（仅改文件名）

## 执行清单
- [x] 编写命名重构方案文档
- [x] 扫描并生成重命名映射
- [x] 批量重命名 `.js` 文件
- [x] 批量修正 `require(...)` 引用路径
- [x] 更新 `package.json` 中脚本路径
- [x] 执行 `npm test` 验证

## 结果
- 已完成本轮自动化重构（全项目 JS 文件按规则重命名并更新引用）
- 测试通过后可继续按需进行“类名/变量名”层面的风格统一（本次未改类名）
