# Noobot 浏览器协议 E2E

本目录是 Noobot 浏览器协议闭环测试的唯一实现入口。完整验收定义见
[`../../../../../docs/browser-protocol-e2e-test-plan.zh-CN.md`](../../../../../docs/browser-protocol-e2e-test-plan.zh-CN.md)。

目录职责：

- `fixtures/`：浏览器、认证、Session、协议捕获及证据输出生命周期。
- `helpers/`：浏览器操作和各协议域断言，不产生业务状态。
- `specs/`：PBE-001～PBE-026、PBE-099 的浏览器业务场景。
- `playwright.protocol.config.js`：协议测试唯一 Playwright 配置。

运行前必须提供：

```bash
export NOOBOT_E2E_USER_ID='...'
export NOOBOT_E2E_CONNECT_CODE='...'
export NOOBOT_E2E_BASE_URL='http://127.0.0.1:10060'
export NOOBOT_E2E_WORKSPACE_ROOT='/absolute/path/to/noobot/workspace'
export NOOBOT_PLUGIN_DEBUG='1'
```

服务应由测试外部启动。测试不使用模拟后端，也不通过文件系统或内部接口创建业务事实。

```bash
npx playwright install chromium
npm run test:e2e:protocol:smoke
npm run test:e2e:protocol:core
npm run test:e2e:protocol:full
```

证据默认写入仓库根目录的 `test-results/protocol/`。凭证禁止进入日志、trace、截图或报告。

## 实现状态

基础配置、证据捕获、认证和 Session fixture、协议断言入口已经建立。新增用例必须从
`fixtures/noobot.fixture.js` 导入 `test` 和 `expect`，从而保证所有用例使用同一套捕获和审计链。
PBE-001～PBE-026 与 PBE-099 已全部落地。所有场景从统一 fixture 运行，禁止用
`test.skip` 或无业务断言的占位测试伪装覆盖率。
